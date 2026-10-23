import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { performance } from 'perf_hooks';
import { AlertImageRenderer } from './AlertImageRenderer';
import { CardPainter, CanvasLib, outputSize } from './cardPainter';
import { WebhookPayload } from '../services/WebhookService';
import cities from '../data/cities.json';

function hasCanvasModule(): boolean {
  try {
    // Loading (not just resolving) proves the native binary exists for this platform.
    createRequire(__filename)('@napi-rs/canvas');
    return true;
  } catch {
    return false;
  }
}
const hasCanvas = hasCanvasModule();

function createMockLogger() {
  return { info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn(), easyDebug: mock.fn() } as any;
}

function snapshotOf(names: string[], category = 1) {
  const active = new Map<string, WebhookPayload>();
  for (const city of names) {
    active.set(`Home|${city}`, { event: 'alert', sensor: 'Home', city, title: 'Threat 0', category, timestamp: Date.now() });
  }
  return { version: 1, active };
}

const CITY_NAMES = (cities as { name: string }[]).map((c) => c.name);

// Throwaway worker scripts that stand in for the real one to exercise failure handling.
let scriptDir: string;
function script(name: string, body: string): string {
  const file = path.join(scriptDir, name);
  fs.writeFileSync(file, `const { parentPort } = require("node:worker_threads");\n${body}\n`);
  return file;
}

describe('AlertImageRenderer: failure handling (no canvas needed)', () => {
  before(() => {
    scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redalert-worker-'));
  });

  after(() => {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  });

  it('respawns a crashed worker once, then switches to the fallback for good', async () => {
    const log = createMockLogger();
    const crash = script('crash.js', 'parentPort.on("message", () => { throw new Error("boom"); });');
    const r = new AlertImageRenderer(log, { maxCities: 12, workerPath: crash });

    await assert.rejects(r.render(snapshotOf(['A']), 1280, 720), /exited/);
    assert.strictEqual(r.usingFallback, false, 'first crash: will respawn');
    await assert.rejects(r.render(snapshotOf(['A']), 1280, 720), /exited/);
    assert.strictEqual(r.usingFallback, true, 'second crash: gives up');

    assert.strictEqual(await r.render(snapshotOf(['A']), 1280, 720), r.fallback);
    assert.strictEqual(await r.render(snapshotOf([]), 1280, 720), r.fallback);
    r.destroy();
  });

  it('serves the fallback and warns once when canvas is unavailable', async () => {
    const log = createMockLogger();
    const unavailable = script('unavailable.js', 'parentPort.postMessage({ type: "unavailable", reason: "no binary" });');
    const r = new AlertImageRenderer(log, { maxCities: 12, workerPath: unavailable });

    await assert.rejects(r.render(snapshotOf(['A']), 1280, 720), /unavailable/);
    assert.strictEqual(await r.render(snapshotOf(['A']), 1280, 720), r.fallback);
    assert.strictEqual(log.warn.mock.calls.filter((c: any) => /not available/.test(c.arguments[0])).length, 1);
    r.destroy();
  });

  it('times out a render that never answers, without killing the worker', async () => {
    const silent = script('silent.js', 'parentPort.on("message", () => {});');
    const r = new AlertImageRenderer(createMockLogger(), { maxCities: 12, workerPath: silent, timeoutMs: 50 });

    await assert.rejects(r.render(snapshotOf(['A']), 1280, 720), /timed out/);
    assert.strictEqual(r.usingFallback, false);
    r.destroy();
  });

  it('destroy() rejects in-flight renders', async () => {
    const silent = script('silent2.js', 'parentPort.on("message", () => {});');
    const r = new AlertImageRenderer(createMockLogger(), { maxCities: 12, workerPath: silent });
    const p = r.render(snapshotOf(['A']), 1280, 720);
    r.destroy();
    await assert.rejects(p, /destroyed/);
    assert.strictEqual(await r.render(snapshotOf(['A']), 1280, 720), r.fallback, 'no new worker after destroy');
  });

  it('ships the fallback and "no active alerts" images as distinct JPEGs', () => {
    const r = new AlertImageRenderer(createMockLogger(), { maxCities: 12 });
    for (const buf of [r.fallback, r.idle]) {
      assert.ok(buf.length > 1000);
      assert.deepStrictEqual([buf[0], buf[1]], [0xff, 0xd8]);
    }
    assert.notDeepStrictEqual(r.idle, r.fallback);
  });

  it('never starts a worker for an empty snapshot', async () => {
    const r = new AlertImageRenderer(createMockLogger(), { maxCities: 12, workerPath: '/nonexistent/worker.js' });
    assert.strictEqual(await r.render(snapshotOf([]), 1280, 720), r.fallback);
    assert.strictEqual(r.usingFallback, false, 'no worker was attempted');
    r.destroy();
  });
});

describe('CardPainter: city cap (recording canvas, no canvas needed)', () => {
  function recordingLib() {
    const texts: string[] = [];
    const ctx: any = new Proxy({}, {
      get(target: any, prop) {
        if (prop in target) {
          return target[prop];
        }
        if (prop === 'fillText') {
          return (t: string) => texts.push(t);
        }
        if (prop === 'measureText') {
          return (t: string) => ({ width: [...t].length * 20 });
        }
        if (prop === 'createRadialGradient') {
          return () => ({ addColorStop() {} });
        }
        return () => {};
      },
      set(target: any, prop, value) {
        target[prop] = value;
        return true;
      },
    });
    const lib: CanvasLib = {
      createCanvas: () => ({ getContext: () => ctx, encode: async () => Buffer.from([0xff, 0xd8]) }),
      GlobalFonts: { registerFromPath: () => true },
    };
    return { lib, texts };
  }

  it('draws at most maxCities names, then "ועוד N"', async () => {
    const { lib, texts } = recordingLib();
    const painter = new CardPainter(lib, []);
    const names = CITY_NAMES.slice(0, 20);
    const alerts = names.map((city, i) => ({ city, title: 't', category: 1, timestamp: 1000 - i }));
    await painter.render({ version: 1, alerts, maxCities: 12 }, 1280, 720);

    const drawnCities = texts.filter((t) => names.includes(t));
    assert.strictEqual(drawnCities.length, 12);
    assert.ok(texts.includes('ועוד 8'));
    assert.ok(texts.includes('ירי רקטות וטילים'));
    assert.ok(texts.includes('@toharush/homebridge-redalert'));
    assert.ok(!texts.some((t) => t.includes('פיקוד העורף')));
  });
});

describe('outputSize', () => {
  it('keeps normal sizes, fixes junk and shrinks oversized requests to 1080p, same shape', () => {
    assert.deepStrictEqual(outputSize(1280, 720), [1280, 720]);
    assert.deepStrictEqual(outputSize(1920, 1080), [1920, 1080]);
    assert.deepStrictEqual(outputSize(NaN, 0), [1280, 720]);
    assert.deepStrictEqual(outputSize(3840, 2160), [1920, 1080]);
    const [w, h] = outputSize(20000, 20000);
    assert.ok(w * h <= 1920 * 1080 && w === h);
  });
});

describe('AlertImageRenderer: real worker', { skip: !hasCanvas }, () => {
  it('renders a JPEG at the requested size', async () => {
    const r = new AlertImageRenderer(createMockLogger(), { maxCities: 12 });
    try {
      const jpeg = await r.render(snapshotOf(['תל אביב - מרכז העיר', 'רמת גן - מזרח']), 640, 360);
      assert.deepStrictEqual([jpeg[0], jpeg[1]], [0xff, 0xd8]);
      // SOF0 marker carries height then width.
      const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
      assert.ok(sof > 0);
      assert.strictEqual(jpeg.readUInt16BE(sof + 5), 360);
      assert.strictEqual(jpeg.readUInt16BE(sof + 7), 640);
    } finally {
      r.destroy();
    }
  });

  it('keeps the main thread idle while the worker draws', async () => {
    const r = new AlertImageRenderer(createMockLogger(), { maxCities: 20 });
    try {
      await r.warmUp();
      const salvo = snapshotOf(CITY_NAMES.slice(0, 400));
      const before = performance.eventLoopUtilization();
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) {
        await r.render({ ...salvo, version: i + 2 }, 1920, 1080);
      }
      const elapsed = performance.now() - t0;
      const elu = performance.eventLoopUtilization(before);
      // The main thread only builds card data and posts a message; drawing and
      // encoding run in the worker, so the main loop is idle most of the time.
      assert.ok(elu.utilization < 0.5, `main-thread utilization ${elu.utilization.toFixed(2)} over ${elapsed.toFixed(0)}ms`);
    } finally {
      r.destroy();
    }
  });
});
