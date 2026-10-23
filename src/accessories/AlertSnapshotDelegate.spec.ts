import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { AlertSnapshotDelegate } from './AlertSnapshotDelegate';
import { DoorbellSnapshot } from '../notifiers/DoorbellNotifier';
import { AlertRenderer } from '../render/AlertImageRenderer';
import { WebhookPayload } from '../services/WebhookService';

const FALLBACK = Buffer.from('fallback');
const IDLE = Buffer.from('idle');

function source() {
  const state: DoorbellSnapshot & { active: Map<string, WebhookPayload> } = { version: 0, active: new Map() };
  return {
    state,
    snapshot: () => state,
    add(city: string) {
      state.active.set(`Home|${city}`, { event: 'alert', sensor: 'Home', city, title: 't', timestamp: Date.now(), category: 1 });
      state.version++;
    },
    clear() {
      state.active.clear();
      state.version++;
    },
  };
}

function stubRenderer(impl?: (s: DoorbellSnapshot, w: number, h: number) => Promise<Buffer>) {
  const render = mock.fn(impl ?? (async (s: DoorbellSnapshot, w: number, h: number) => Buffer.from(`v${s.version}:${w}x${h}`)));
  const renderer: AlertRenderer = {
    fallback: FALLBACK,
    idle: IDLE,
    render,
    warmUp: async () => {},
    destroy: () => {},
  };
  return { renderer, render };
}

function snapshot(d: AlertSnapshotDelegate, width = 1280, height = 720): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    d.handleSnapshotRequest({ width, height } as any, (err, buf) => (err ? reject(err) : resolve(buf!)));
  });
}

describe('AlertSnapshotDelegate', () => {
  it('renders the same version and size once, and again after a version bump', async () => {
    const src = source();
    const { renderer, render } = stubRenderer();
    const d = new AlertSnapshotDelegate(src, renderer);
    src.add('A');

    const [a, b] = await Promise.all([snapshot(d), snapshot(d)]);
    assert.strictEqual(render.mock.calls.length, 1, 'concurrent requests share one render');
    assert.strictEqual(a, b);

    src.add('B');
    assert.strictEqual((await snapshot(d)).toString(), 'v2:1280x720');
    assert.strictEqual(render.mock.calls.length, 2);
  });

  it('renders each requested size separately', async () => {
    const src = source();
    const { renderer, render } = stubRenderer();
    const d = new AlertSnapshotDelegate(src, renderer);
    src.add('A');
    await snapshot(d, 1280, 720);
    await snapshot(d, 640, 360);
    assert.strictEqual(render.mock.calls.length, 2);
  });

  it('answers immediately with the "no active alerts" picture when nothing is active, without rendering', () => {
    const src = source();
    const { renderer, render } = stubRenderer();
    const d = new AlertSnapshotDelegate(src, renderer);
    const cb = mock.fn();

    d.handleSnapshotRequest({ width: 1280, height: 720 } as any, cb);
    assert.strictEqual(cb.mock.calls.length, 1, 'synchronous answer');
    assert.deepStrictEqual(cb.mock.calls[0].arguments, [undefined, IDLE]);

    src.add('A');
    src.clear();
    d.handleSnapshotRequest({ width: 640, height: 360 } as any, cb);
    assert.strictEqual(cb.mock.calls[1].arguments[1], IDLE);
    assert.strictEqual(render.mock.calls.length, 0, 'renderer never called');
  });

  it('keeps only the last 4 alert images', async () => {
    const src = source();
    const { renderer, render } = stubRenderer();
    const d = new AlertSnapshotDelegate(src, renderer);
    src.add('A');
    const first = src.state.version;
    for (const c of ['B', 'C', 'D', 'E']) {
      await snapshot(d);
      src.add(c);
    }
    await snapshot(d);
    assert.strictEqual(render.mock.calls.length, 5);

    src.state.version = first; // ask for the evicted version again
    await snapshot(d);
    assert.strictEqual(render.mock.calls.length, 6, 'oldest entry was evicted');
  });

  it('serves the fallback when the renderer fails, and retries on the next request', async () => {
    const src = source();
    let fail = true;
    const { renderer, render } = stubRenderer(async () => {
      if (fail) {
        throw new Error('boom');
      }
      return Buffer.from('ok');
    });
    const d = new AlertSnapshotDelegate(src, renderer);
    src.add('A');

    assert.strictEqual(await snapshot(d), FALLBACK);
    fail = false;
    assert.strictEqual((await snapshot(d)).toString(), 'ok');
    assert.strictEqual(render.mock.calls.length, 2);
  });

  it('rejects the stream: snapshot-only', () => {
    const { renderer } = stubRenderer();
    const d = new AlertSnapshotDelegate(source(), renderer);
    const cb = mock.fn();
    d.prepareStream({} as any, cb);
    assert.strictEqual(cb.mock.calls.length, 1);
    assert.match((cb.mock.calls[0].arguments[0] as unknown as Error).message, /snapshot-only/);
  });

  it('prewarm fills the cache for the last requested size', async () => {
    const src = source();
    const { renderer, render } = stubRenderer();
    const d = new AlertSnapshotDelegate(src, renderer);
    src.add('A');
    await snapshot(d, 1920, 1080);

    src.add('B');
    d.prewarm();
    assert.strictEqual(render.mock.calls.length, 2);
    assert.deepStrictEqual(render.mock.calls[1].arguments.slice(1), [1920, 1080]);

    await snapshot(d, 1920, 1080);
    assert.strictEqual(render.mock.calls.length, 2, 'the snapshot was already rendered');
  });

  it('prewarm does nothing when idle', () => {
    const { renderer, render } = stubRenderer();
    new AlertSnapshotDelegate(source(), renderer).prewarm();
    assert.strictEqual(render.mock.calls.length, 0);
  });

  it('a renderer that throws synchronously becomes the fallback, and prewarm never throws', async () => {
    const src = source();
    src.add('A');
    const { renderer } = stubRenderer(() => {
      throw new Error('sync boom');
    });
    const d = new AlertSnapshotDelegate(src, renderer);
    assert.doesNotThrow(() => d.prewarm());
    assert.strictEqual(await snapshot(d), FALLBACK);
  });
});

