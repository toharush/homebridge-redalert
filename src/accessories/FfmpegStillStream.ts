import { ChildProcess, spawn as nodeSpawn, SpawnOptions } from 'child_process';
import { createSocket, Socket } from 'dgram';
import * as os from 'os';
import type {
  PrepareStreamCallback, PrepareStreamRequest, StreamingRequest, StreamRequestCallback,
} from 'homebridge';
import { DebugLogger } from '../utils/debugLogger';

/** Where stream frames come from: the current alert card, rendered at the stream's size. */
export interface FrameSource {
  version(): number;
  frameFor(width: number, height: number): Promise<Buffer>;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface StillStreamOptions {
  ffmpegPath: string;
  /** Frames per second sent to the viewer. The card changes rarely, so a low rate is enough. */
  fps?: number;
  /** Stop a session after this long without RTCP from the viewer (it can vanish without STOP). */
  idleTimeoutMs?: number;
  spawn?: SpawnFn;
  now?: () => number;
}

export const STREAM_FPS = 5;
const IDLE_TIMEOUT_MS = 30000;
const KILL_GRACE_MS = 2000;
const STDERR_TAIL = 600;

/** The START request's video parameters we use. */
interface StartVideo {
  width: number;
  height: number;
  fps: number;
  pt: number;
  max_bit_rate: number;
  mtu: number;
}

interface Session {
  id: string;
  address: string;
  ipv6: boolean;
  port: number;
  ssrc: number;
  srtp: string;
  socket: Socket;
  proc: ChildProcess | null;
  timer: NodeJS.Timeout | null;
  frame: Buffer | null;
  frameVersion: number;
  pending: boolean;
  lastRtcp: number;
  stderr: string;
  stopping: boolean;
}

/**
 * Live video for the doorbell camera: a slowly changing still image (the alert
 * card) encoded by an ffmpeg child process and sent to the viewer as SRTP.
 *
 * Cost is kept low: ffmpeg only runs while a device is watching, at a few
 * frames per second, with x264's still-image tuning so unchanged frames encode
 * to almost nothing, and at a lower OS priority than Homebridge. The card is
 * re-rendered (in the render worker) only when the alert set changes. Nothing
 * here runs on the alert path: a stream only starts when a viewer asks for one.
 */
export class FfmpegStillStream {
  private readonly sessions = new Map<string, Session>();
  private readonly fps: number;
  private readonly idleTimeoutMs: number;
  private readonly spawn: SpawnFn;
  private readonly now: () => number;
  private forceStop: (sessionId: string) => void = () => {};
  private readonly ffmpegPath: string;
  private probed: Promise<boolean> | null = null;
  private ok = false;

  constructor(
    private readonly log: DebugLogger,
    private readonly frames: FrameSource,
    private readonly ssrcFn: () => number,
    options: StillStreamOptions,
  ) {
    this.ffmpegPath = options.ffmpegPath;
    this.fps = options.fps ?? STREAM_FPS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.spawn = options.spawn ?? nodeSpawn;
    this.now = options.now ?? Date.now;
  }

  /** True once ffmpeg was found with libx264 and SRTP support. */
  get available(): boolean {
    return this.ok;
  }

  /** Lets the stream end a session itself (viewer gone, ffmpeg died). */
  attach(forceStop: (sessionId: string) => void): void {
    this.forceStop = forceStop;
  }

  /** Checks once, in the background, that ffmpeg can encode H.264 and send SRTP. */
  probe(): Promise<boolean> {
    this.probed ??= Promise.all([
      this.capture(['-hide_banner', '-encoders']),
      this.capture(['-hide_banner', '-protocols']),
    ]).then(([encoders, protocols]) => {
      this.ok = /\blibx264\b/.test(encoders) && /\bsrtp\b/.test(protocols);
      if (this.ok) {
        this.log.easyDebug(`[AppleTV] Live stream enabled (ffmpeg: ${this.ffmpegPath})`);
      } else {
        this.log.warn(
          `[AppleTV] Live stream disabled: "${this.ffmpegPath}" not found or lacks libx264/SRTP. `
          + 'Reinstall the plugin or set apple_tv_ffmpeg_path. Snapshots still work.',
        );
      }
      return this.ok;
    });
    return this.probed;
  }

  prepare(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    const ipv6 = request.addressVersion === 'ipv6';
    const socket = createSocket(ipv6 ? 'udp6' : 'udp4');
    const { srtp_key: key, srtp_salt: salt } = request.video;
    const session: Session = {
      id: request.sessionID,
      address: request.targetAddress,
      ipv6,
      port: request.video.port,
      ssrc: this.ssrcFn(),
      srtp: Buffer.concat([key, salt]).toString('base64'),
      socket,
      proc: null,
      timer: null,
      frame: null,
      frameVersion: -1,
      pending: false,
      lastRtcp: this.now(),
      stderr: '',
      stopping: false,
    };
    let answered = false;
    socket.on('error', (err) => {
      if (!answered) {
        answered = true;
        callback(err);
        return;
      }
      this.log.easyDebug(`[AppleTV] Stream socket error: ${err.message}`);
      this.end(session.id, true);
    });
    // The viewer sends RTCP receiver reports here; they prove it is still watching.
    socket.on('message', () => {
      session.lastRtcp = this.now();
    });
    socket.bind(0, () => {
      answered = true;
      this.sessions.set(session.id, session);
      callback(undefined, {
        video: { port: socket.address().port, ssrc: session.ssrc, srtp_key: key, srtp_salt: salt },
      });
    });
  }

  handle(request: StreamingRequest, callback: StreamRequestCallback): void {
    const session = this.sessions.get(request.sessionID);
    const type = request.type as string;
    if (type === 'stop') {
      this.end(request.sessionID, false);
      callback();
      return;
    }
    if (!session) {
      callback(new Error('unknown stream session'));
      return;
    }
    if (type === 'start') {
      this.start(session, request as unknown as { video: StartVideo });
    }
    // RECONFIGURE only changes bitrate/size hints; a still image doesn't need them.
    callback();
  }

  destroy(): void {
    for (const id of [...this.sessions.keys()]) {
      this.end(id, false);
    }
  }

  private start(s: Session, request: { video: StartVideo }): void {
    const { width, height, pt, max_bit_rate: kbps, mtu } = request.video;
    const fps = Math.max(1, Math.min(this.fps, request.video.fps || this.fps));
    const host = s.ipv6 ? `[${s.address}]` : s.address;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      // Start encoding on the first frame instead of probing the input for seconds.
      '-fflags', 'nobuffer', '-probesize', '32', '-analyzeduration', '0',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-an', '-sn', '-dn',
      '-vf', `scale=${width}:${height}:flags=fast_bilinear,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage,zerolatency',
      '-profile:v', 'baseline', '-level:v', '3.1', '-threads', '1',
      '-r', String(fps), '-g', String(fps * 2),
      '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-payload_type', String(pt), '-ssrc', String(s.ssrc),
      '-f', 'rtp', '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80', '-srtp_out_params', s.srtp,
      `srtp://${host}:${s.port}?rtcpport=${s.port}&pkt_size=${mtu}`,
    ];

    let proc: ChildProcess;
    try {
      proc = this.spawn(this.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      this.log.warn(`[AppleTV] Could not start ffmpeg: ${err instanceof Error ? err.message : err}`);
      this.end(s.id, true);
      return;
    }
    s.proc = proc;
    s.lastRtcp = this.now();
    // Every stream error must be handled: an unhandled 'error' event crashes Homebridge.
    proc.on('error', (err) => {
      this.log.warn(`[AppleTV] ffmpeg error: ${err.message}`);
      this.end(s.id, true);
    });
    proc.stdin?.on('error', () => {
      // EPIPE when ffmpeg exits first; 'exit' below handles the session.
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      s.stderr = (s.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    proc.on('exit', (code, signal) => {
      if (!s.stopping) {
        this.log.warn(`[AppleTV] ffmpeg exited (${signal ?? code}) ${s.stderr.trim()}`);
        this.end(s.id, true);
      }
    });
    if (proc.pid !== undefined) {
      try {
        os.setPriority(proc.pid, 10); // behind Homebridge itself
      } catch {
        // Not permitted on some systems; the stream still works.
      }
    }

    this.log.easyDebug(`[AppleTV] Stream start ${width}x${height}@${fps} ${kbps}kbps -> ${s.address}:${s.port}`);
    this.tick(s, width, height);
    s.timer = setInterval(() => this.tick(s, width, height), Math.round(1000 / fps));
  }

  private tick(s: Session, width: number, height: number): void {
    if (this.now() - s.lastRtcp > this.idleTimeoutMs) {
      this.log.easyDebug('[AppleTV] Stream viewer gone, stopping');
      this.end(s.id, true);
      return;
    }
    // Re-render only when the alert set changed; the render is cached and runs in the worker.
    const version = this.frames.version();
    if (version !== s.frameVersion && !s.pending) {
      s.pending = true;
      this.frames.frameFor(width, height).then((frame) => {
        s.frame = frame;
        s.frameVersion = version;
      }, () => {
        // Keep sending the previous frame; the next tick tries again.
      }).finally(() => {
        s.pending = false;
      });
    }
    const stdin = s.proc?.stdin;
    // A full pipe means ffmpeg is behind: drop this frame instead of queueing it.
    if (s.frame && stdin && !stdin.destroyed && !stdin.writableNeedDrain) {
      stdin.write(s.frame);
    }
  }

  /** Ends a session; `notify` also tells HomeKit, for stops the viewer didn't ask for. */
  private end(id: string, notify: boolean): void {
    const s = this.sessions.get(id);
    if (!s) {
      return;
    }
    this.sessions.delete(id);
    s.stopping = true;
    if (s.timer) {
      clearInterval(s.timer);
    }
    const proc = s.proc;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.stdin?.end();
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGKILL');
        }
      }, KILL_GRACE_MS).unref();
    }
    try {
      s.socket.close();
    } catch {
      // Already closed.
    }
    if (notify) {
      try {
        this.forceStop(id);
      } catch {
        // HomeKit may already have dropped the session.
      }
    }
  }

  private capture(args: string[]): Promise<string> {
    return new Promise((resolve) => {
      let out = '';
      let proc: ChildProcess;
      try {
        proc = this.spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        resolve('');
        return;
      }
      proc.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      proc.on('error', () => resolve(''));
      proc.on('exit', (code) => resolve(code === 0 ? out : ''));
    });
  }
}

/** ffmpeg to use: the configured path, else the bundled ffmpeg-for-homebridge, else ffmpeg from PATH. */
export function resolveFfmpegPath(configured: string): string {
  if (configured) {
    return configured;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundled: unknown = require('ffmpeg-for-homebridge');
    if (typeof bundled === 'string' && bundled) {
      return bundled;
    }
  } catch {
    // Not installed.
  }
  return 'ffmpeg';
}
