// Render worker: one long-lived thread that owns @napi-rs/canvas, the fonts and
// the base map. The main thread only posts plain card data and receives JPEG
// bytes, so drawing and encoding never block HomeKit, webhooks or the ring.
import { parentPort, workerData } from 'node:worker_threads';
import * as fs from 'fs';
import { CardPainter, CanvasLib, registerFonts } from './cardPainter';
import { toCityPoints } from './alertCard';
import type { RenderRequest, WorkerInit, WorkerMessage } from './AlertImageRenderer';

// A variable specifier keeps tsc from resolving the optional package at build time.
const CANVAS_MODULE = '@napi-rs/canvas';
const port = parentPort!;
const init = workerData as WorkerInit;

function post(msg: WorkerMessage, transfer?: ArrayBuffer[]): void {
  port.postMessage(msg, transfer ?? []);
}

async function start(): Promise<CardPainter | null> {
  let lib: CanvasLib;
  try {
    const mod = await import(CANVAS_MODULE);
    lib = (mod.createCanvas ? mod : mod.default) as CanvasLib;
  } catch (err) {
    // No prebuilt binary for this platform (e.g. armv6) or the package is missing.
    post({ type: 'unavailable', reason: err instanceof Error ? err.message : String(err) });
    return null;
  }
  try {
    registerFonts(lib, init.fontsDir);
    const cities = toCityPoints(JSON.parse(fs.readFileSync(init.citiesPath, 'utf-8')));
    const painter = new CardPainter(lib, cities);
    post({ type: 'ready' });
    return painter;
  } catch (err) {
    post({ type: 'unavailable', reason: `failed to load assets: ${err instanceof Error ? err.message : String(err)}` });
    return null;
  }
}

const ready = start();

port.on('message', async (req: RenderRequest) => {
  const painter = await ready;
  if (!painter) {
    return;
  }
  try {
    const jpeg = await painter.render(req.data, req.width, req.height);
    // The encoder's buffer is native memory and can't be transferred, so copy it
    // once here, off the main thread, and hand the copy over without another copy.
    const out = new Uint8Array(jpeg.byteLength);
    out.set(jpeg);
    post({ type: 'result', id: req.id, jpeg: out.buffer }, [out.buffer]);
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
});
