import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { createSocket } from 'dgram';
import * as fs from 'fs';
import * as path from 'path';
import { FfmpegStillStream, FrameSource, SpawnFn, STREAM_FPS, resolveFfmpegPath } from './FfmpegStillStream';
import { AlertSnapshotDelegate } from './AlertSnapshotDelegate';

const KEY = Buffer.alloc(16, 1);
const SALT = Buffer.alloc(14, 2);

function logger() {
  return { info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn(), easyDebug: mock.fn() } as any;
}

class FakeProc extends EventEmitter {
  pid = undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  written: Buffer[] = [];
  stdin = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableNeedDrain: false,
    write: (b: Buffer) => {
      this.written.push(b);
      return true;
    },
    end: mock.fn(),
  });

  kill = mock.fn((signal: string) => {
    this.signalCode = signal;
    return true;
  });
}

/** A fake spawn: probe calls answer like a full ffmpeg build, stream calls return a FakeProc. */
function fakeSpawn(probeOutput = ' V....D libx264\n srtp\n') {
  const procs: FakeProc[] = [];
  const calls: string[][] = [];
  const spawn: SpawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    const proc = new FakeProc();
    if (args.includes('-encoders') || args.includes('-protocols')) {
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from(probeOutput));
        proc.emit('exit', 0, null);
      });
    } else {
      procs.push(proc);
    }
    return proc as any;
  }) as SpawnFn;
  return { spawn, procs, calls };
}

function frames(): FrameSource & { v: number; on: boolean; frameFor: ReturnType<typeof mock.fn> } {
  const src = {
    v: 1,
    on: true,
    version: () => src.v,
    active: () => src.on,
    frameFor: mock.fn(async (w: number, h: number) => Buffer.from(`v${src.v}:${w}x${h}`)),
  };
  return src;
}

function prepare(stream: FfmpegStillStream, sessionID = 's1'): Promise<any> {
  return new Promise((resolve, reject) => {
    stream.prepare({
      sessionID, targetAddress: '127.0.0.1', addressVersion: 'ipv4',
      video: { port: 50000, srtpCryptoSuite: 0, srtp_key: KEY, srtp_salt: SALT },
    } as any, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

function start(stream: FfmpegStillStream, sessionID = 's1', video: Record<string, number> = {}) {
  const cb = mock.fn();
  stream.handle({
    sessionID, type: 'start',
    video: { width: 640, height: 360, fps: 15, pt: 99, max_bit_rate: 300, mtu: 1378, ...video },
  } as any, cb);
  return cb;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('FfmpegStillStream', () => {
  const streams: FfmpegStillStream[] = [];
  afterEach(() => {
    mock.timers.reset();
    for (const s of streams.splice(0)) {
      s.destroy();
    }
  });

  function make(opts: { spawn?: SpawnFn; fps?: number; idleTimeoutMs?: number; endedGraceMs?: number } = {}) {
    const src = frames();
    const { spawn, procs, calls } = fakeSpawn();
    const forceStop = mock.fn();
    const stream = new FfmpegStillStream(logger(), src, () => 1234, {
      ffmpegPath: 'ffmpeg', spawn: opts.spawn ?? spawn, fps: opts.fps, idleTimeoutMs: opts.idleTimeoutMs,
      endedGraceMs: opts.endedGraceMs,
    });
    stream.attach(forceStop);
    streams.push(stream);
    return { stream, src, procs, calls, forceStop };
  }

  it('is available only when ffmpeg has libx264 and SRTP', async () => {
    const good = make();
    assert.strictEqual(await good.stream.probe(), true);
    assert.strictEqual(good.stream.available, true);

    const noX264 = new FfmpegStillStream(logger(), frames(), () => 1, { ffmpegPath: 'ffmpeg', spawn: fakeSpawn(' srtp\n').spawn });
    assert.strictEqual(await noX264.probe(), false);

    const missing = new FfmpegStillStream(logger(), frames(), () => 1, {
      ffmpegPath: 'ffmpeg',
      spawn: (() => {
        throw new Error('ENOENT');
      }) as any,
    });
    assert.strictEqual(await missing.probe(), false);
  });

  it('prepare binds a local RTCP port and echoes the SRTP keys with our SSRC', async () => {
    const { stream } = make();
    const res = await prepare(stream);
    assert.ok(res.video.port > 0);
    assert.strictEqual(res.video.ssrc, 1234);
    assert.deepStrictEqual(res.video.srtp_key, KEY);
    assert.deepStrictEqual(res.video.srtp_salt, SALT);
  });

  it('starts ffmpeg with SRTP, the requested payload type, SSRC, MTU, size and a capped frame rate', async () => {
    const { stream, procs, calls } = make();
    await prepare(stream);
    const cb = start(stream);
    assert.strictEqual(cb.mock.calls.length, 1, 'START answers at once');
    assert.strictEqual(procs.length, 1);
    const args = calls[calls.length - 1];
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    assert.strictEqual(at('-srtp_out_params'), Buffer.concat([KEY, SALT]).toString('base64'));
    assert.strictEqual(at('-payload_type'), '99');
    assert.strictEqual(at('-ssrc'), '1234');
    assert.strictEqual(at('-r'), String(STREAM_FPS), 'frame rate capped for CPU');
    assert.strictEqual(at('-b:v'), '300k');
    assert.ok(at('-vf').startsWith('scale=640:360'));
    assert.strictEqual(args[args.length - 1], 'srtp://127.0.0.1:50000?rtcpport=50000&pkt_size=1378');
    assert.ok(args.includes('stillimage,zerolatency'));
  });

  it('sends the current frame every tick and re-renders only when the alert set changes', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const { stream, src, procs } = make({ fps: 5 });
    await prepare(stream);
    start(stream);
    await flush();
    mock.timers.tick(200);
    mock.timers.tick(200);
    const proc = procs[0];
    assert.ok(proc.written.length >= 2);
    assert.strictEqual(proc.written[proc.written.length - 1].toString(), 'v1:640x360');
    assert.strictEqual(src.frameFor.mock.calls.length, 1, 'same version: no new render');

    src.v = 2;
    mock.timers.tick(200);
    await flush();
    mock.timers.tick(200);
    assert.strictEqual(src.frameFor.mock.calls.length, 2);
    assert.strictEqual(proc.written[proc.written.length - 1].toString(), 'v2:640x360');
  });

  it('drops frames instead of queueing when ffmpeg is behind', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const { stream, procs } = make({ fps: 5 });
    await prepare(stream);
    start(stream);
    await flush();
    const proc = procs[0];
    proc.stdin.writableNeedDrain = true;
    const before = proc.written.length;
    mock.timers.tick(1000);
    assert.strictEqual(proc.written.length, before);
  });

  it('STOP kills ffmpeg and closes the session without telling HomeKit', async () => {
    const { stream, procs, forceStop } = make();
    await prepare(stream);
    start(stream);
    const cb = mock.fn();
    stream.handle({ sessionID: 's1', type: 'stop' } as any, cb);
    assert.strictEqual(cb.mock.calls.length, 1);
    assert.deepStrictEqual(procs[0].kill.mock.calls[0].arguments, ['SIGTERM']);
    assert.strictEqual(procs[0].stdin.end.mock.calls.length, 1);
    assert.strictEqual(forceStop.mock.calls.length, 0);
    procs[0].emit('exit', null, 'SIGTERM');
    assert.strictEqual(forceStop.mock.calls.length, 0, 'an expected exit is not reported');
  });

  it('an unexpected ffmpeg exit ends the HomeKit session', async () => {
    const { stream, procs, forceStop } = make();
    await prepare(stream);
    start(stream);
    procs[0].exitCode = 1;
    procs[0].emit('exit', 1, null);
    assert.deepStrictEqual(forceStop.mock.calls[0].arguments, ['s1']);
  });

  it('ffmpeg and pipe errors never throw', async () => {
    const { stream, procs, forceStop } = make();
    await prepare(stream);
    start(stream);
    procs[0].stdin.emit('error', new Error('EPIPE'));
    procs[0].emit('error', new Error('spawn failed'));
    assert.strictEqual(forceStop.mock.calls.length, 1);
  });

  it('stops a session whose viewer stopped sending RTCP', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const { stream, procs, forceStop } = make({ fps: 5, idleTimeoutMs: 1000 });
    await prepare(stream);
    start(stream);
    mock.timers.tick(1400);
    assert.deepStrictEqual(forceStop.mock.calls[0].arguments, ['s1']);
    assert.strictEqual(procs[0].kill.mock.calls[0].arguments[0], 'SIGTERM');
  });

  it('ends the stream a little after the last alert ends', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const { stream, src, forceStop } = make({ fps: 5, endedGraceMs: 1000 });
    // mock.timers moves Date to the end of a tick() before running timers, so step in ticks.
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += 200) {
        mock.timers.tick(200);
      }
    };
    await prepare(stream);
    start(stream);
    src.on = false;
    advance(800);
    assert.strictEqual(forceStop.mock.calls.length, 0, 'viewer still sees the alert clear');
    src.on = true;
    advance(2000);
    assert.strictEqual(forceStop.mock.calls.length, 0, 'a new alert keeps it running');
    src.on = false;
    advance(1600);
    assert.deepStrictEqual(forceStop.mock.calls[0].arguments, ['s1']);
  });

  it('runs two viewers independently', async () => {
    const { stream, procs } = make();
    await prepare(stream, 'a');
    await prepare(stream, 'b');
    start(stream, 'a');
    start(stream, 'b', { width: 1280, height: 720 });
    assert.strictEqual(procs.length, 2);
    stream.handle({ sessionID: 'a', type: 'stop' } as any, () => {});
    assert.strictEqual(procs[0].kill.mock.calls.length, 1);
    assert.strictEqual(procs[1].kill.mock.calls.length, 0);
  });

  it('resolveFfmpegPath prefers the configured path, then the bundled binary', () => {
    assert.strictEqual(resolveFfmpegPath('/opt/ffmpeg'), '/opt/ffmpeg');
    assert.ok(resolveFfmpegPath('').length > 0);
  });
});

describe('AlertSnapshotDelegate with a stream', () => {
  const renderer = { fallback: Buffer.from('f'), render: async () => Buffer.from('x'), warmUp: async () => {}, destroy: () => {} };
  const notifier = { snapshot: () => ({ version: 0, active: new Map() }) };
  const alerting = { snapshot: () => ({ version: 1, active: new Map([['Home|A', {}]]) }) };

  it('rejects the stream while ffmpeg is unavailable and hands it over once available', () => {
    const d = new AlertSnapshotDelegate(alerting as any, renderer);
    const stream = { available: false, prepare: mock.fn(), handle: mock.fn() };
    d.stream = stream;
    const cb = mock.fn();
    d.prepareStream({} as any, cb);
    assert.match(String(cb.mock.calls[0].arguments[0]), /snapshot-only/);
    stream.available = true;
    d.prepareStream({} as any, cb);
    assert.strictEqual(stream.prepare.mock.calls.length, 1);
  });

  it('refuses to stream when no alert is active', () => {
    const d = new AlertSnapshotDelegate(notifier as any, renderer);
    const stream = { available: true, prepare: mock.fn(), handle: mock.fn() };
    d.stream = stream;
    const cb = mock.fn();
    d.prepareStream({} as any, cb);
    assert.match(String(cb.mock.calls[0].arguments[0]), /no active alert/);
    assert.strictEqual(stream.prepare.mock.calls.length, 0);
  });

  it('serves the static picture when nothing is active', async () => {
    const d = new AlertSnapshotDelegate(notifier as any, renderer);
    assert.strictEqual(await d.frameFor(640, 360), renderer.fallback);
  });
});

// End to end with the bundled ffmpeg: real SRTP packets reach a local "viewer".
const bundled = resolveFfmpegPath('');
const hasFfmpeg = bundled !== 'ffmpeg' && fs.existsSync(bundled);

describe('FfmpegStillStream with real ffmpeg', { skip: !hasFfmpeg }, () => {
  it('delivers RTP packets with the requested payload type and SSRC', async () => {
    const jpeg = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'fallback-alert.jpg'));
    const viewer = createSocket('udp4');
    await new Promise<void>((r) => viewer.bind(0, '127.0.0.1', () => r()));
    const port = viewer.address().port;
    const packets: Buffer[] = [];
    viewer.on('message', (m) => packets.push(m));

    const source = { version: () => 1, active: () => true, frameFor: async () => jpeg };
    const stream = new FfmpegStillStream(logger(), source, () => 4242, { ffmpegPath: bundled });
    assert.strictEqual(await stream.probe(), true);
    await new Promise((resolve, reject) => stream.prepare({
      sessionID: 'e2e', targetAddress: '127.0.0.1', addressVersion: 'ipv4',
      video: { port, srtpCryptoSuite: 0, srtp_key: KEY, srtp_salt: SALT },
    } as any, (err, res) => (err ? reject(err) : resolve(res))));
    start(stream, 'e2e');

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !packets.some((p) => (p[1] & 0x7f) === 99)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    stream.destroy();
    viewer.close();

    const rtp = packets.find((p) => (p[1] & 0x7f) === 99);
    assert.ok(rtp, `no RTP packet arrived (${packets.length} packets)`);
    assert.strictEqual(rtp.readInt32BE(8), 4242);
  });
});
