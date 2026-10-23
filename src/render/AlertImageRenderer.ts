import { Worker } from 'node:worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { DebugLogger } from '../utils/debugLogger';
import type { DoorbellSnapshot } from '../notifiers/DoorbellNotifier';
import { CardData, toCardData } from './alertCard';

// Both src/render (tsx) and dist/render (tsc) sit two levels below the package root.
export const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const CITIES_PATH = path.join(__dirname, '..', 'data', 'cities.json');
// tsx runs the .ts worker (workers inherit its loader through execArgv); dist runs the .js.
const WORKER_PATH = path.join(__dirname, `renderWorker${path.extname(__filename)}`);

// Answer before hap-nodejs warns that the snapshot handler is slow (8 s).
const DEFAULT_TIMEOUT_MS = 6000;

/** Data passed to the worker at startup. */
export interface WorkerInit {
  fontsDir: string;
  citiesPath: string;
}

export interface RenderRequest {
  id: number;
  data: CardData;
  width: number;
  height: number;
}

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'unavailable'; reason: string }
  | { type: 'result'; id: number; jpeg: ArrayBuffer }
  | { type: 'error'; id: number; message: string };

/** What the snapshot delegate needs from a renderer; tests inject stubs. */
export interface AlertRenderer {
  /** Static card served when a render fails or canvas isn't available. */
  readonly fallback: Buffer;
  /** Static "no active alerts" card, served once every alert has ended. */
  readonly idle: Buffer;
  render(snapshot: DoorbellSnapshot, width: number, height: number): Promise<Buffer>;
  warmUp(): Promise<void>;
  destroy(): void;
}

export interface AlertImageRendererOptions {
  maxCities: number;
  timeoutMs?: number;
  workerPath?: string;
}

interface Pending {
  resolve(buf: Buffer): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Main-thread facade over one long-lived render worker.
 *
 * The worker starts lazily on the first render (or warmUp), so nothing is loaded
 * unless the Apple TV doorbell is enabled. Main-thread cost per render is building
 * the card data and one postMessage; drawing and JPEG encoding happen in the worker.
 *
 * Failure handling: a crashed worker is respawned once, on the next render. A
 * second crash, or a platform without @napi-rs/canvas, switches to the static
 * fallback images for good. A render that takes longer than `timeoutMs` rejects
 * (the delegate then serves the fallback) without killing the worker.
 *
 * The worker is unref()'d while idle, so it never keeps Homebridge or a test
 * process alive; it is ref()'d only while a render is in flight.
 */
export class AlertImageRenderer implements AlertRenderer {
  readonly fallback: Buffer;
  readonly idle: Buffer;
  private readonly maxCities: number;
  private readonly timeoutMs: number;
  private readonly workerPath: string;
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private crashes = 0;
  private disabled = false;
  private destroyed = false;

  constructor(private readonly log: DebugLogger, options: AlertImageRendererOptions) {
    this.maxCities = options.maxCities;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workerPath = options.workerPath ?? WORKER_PATH;
    this.fallback = this.readAsset('fallback-alert.jpg');
    const idle = this.readAsset('no-alerts.jpg');
    this.idle = idle.length > 0 ? idle : this.fallback;
  }

  /** True once the renderer has given up on canvas and only serves fallbacks. */
  get usingFallback(): boolean {
    return this.disabled;
  }

  render(snapshot: DoorbellSnapshot, width: number, height: number): Promise<Buffer> {
    return this.renderCard(toCardData(snapshot, this.maxCities), width, height);
  }

  renderCard(data: CardData, width: number, height: number): Promise<Buffer> {
    const worker = data.alerts.length > 0 || data.generic || data.idle ? this.ensureWorker() : null;
    if (!worker) {
      return Promise.resolve(this.fallback);
    }
    const id = this.nextId++;
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          this.updateRef();
          reject(new Error(`render timed out after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.updateRef();
      const req: RenderRequest = { id, data, width, height };
      worker.postMessage(req);
    });
  }

  /** Starts the worker and renders one throwaway card, so the first real alert doesn't pay for loading. */
  async warmUp(): Promise<void> {
    await this.renderCard({ version: 0, alerts: [], maxCities: this.maxCities, generic: true }, 1280, 720).catch(() => undefined);
  }

  destroy(): void {
    this.destroyed = true;
    const worker = this.worker;
    this.worker = null;
    this.failPending(new Error('renderer destroyed'));
    void worker?.terminate();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) {
      return this.worker;
    }
    if (this.disabled || this.destroyed) {
      return null;
    }
    let worker: Worker;
    try {
      const init: WorkerInit = { fontsDir: path.join(ASSETS_DIR, 'fonts'), citiesPath: CITIES_PATH };
      worker = new Worker(this.workerPath, { workerData: init });
    } catch (err) {
      this.disable(`could not start the render worker: ${err}`);
      return null;
    }
    worker.unref();
    worker.on('message', (msg: WorkerMessage) => this.onMessage(worker, msg));
    // Without an 'error' listener an uncaught worker exception would crash the main thread.
    worker.on('error', (err) => this.log.warn(`[AppleTV] Render worker error: ${err instanceof Error ? err.message : err}`));
    worker.on('exit', (code) => this.onExit(worker, code));
    this.worker = worker;
    return worker;
  }

  private onMessage(worker: Worker, msg: WorkerMessage): void {
    switch (msg.type) {
      case 'ready':
        this.log.easyDebug('[AppleTV] Render worker ready');
        return;
      case 'unavailable':
        this.disable(`@napi-rs/canvas is not available (${msg.reason})`);
        this.worker = null;
        this.failPending(new Error('canvas unavailable'));
        void worker.terminate();
        return;
      case 'result':
        this.settle(msg.id)?.resolve(Buffer.from(msg.jpeg));
        return;
      case 'error':
        this.settle(msg.id)?.reject(new Error(msg.message));
        return;
    }
  }

  private onExit(worker: Worker, code: number): void {
    if (this.worker !== worker) {
      return; // terminated on purpose (destroy or canvas unavailable)
    }
    this.worker = null;
    this.failPending(new Error(`render worker exited with code ${code}`));
    if (this.destroyed) {
      return;
    }
    this.crashes++;
    if (this.crashes > 1) {
      this.disable('the render worker crashed twice');
    } else {
      this.log.warn(`[AppleTV] Render worker exited (code ${code}); it will restart on the next alert`);
    }
  }

  private settle(id: number): Pending | undefined {
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      this.updateRef();
    }
    return p;
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  // Keep the process alive only while a render is in flight.
  private updateRef(): void {
    if (!this.worker) {
      return;
    }
    if (this.pending.size > 0) {
      this.worker.ref();
    } else {
      this.worker.unref();
    }
  }

  private disable(reason: string): void {
    if (!this.disabled) {
      this.disabled = true;
      this.log.warn(`[AppleTV] ${reason}. The doorbell will show a static image instead of the alert card.`);
    }
  }

  private readAsset(name: string): Buffer {
    try {
      return fs.readFileSync(path.join(ASSETS_DIR, name));
    } catch (err) {
      this.log.warn(`[AppleTV] Could not read ${name}: ${err}`);
      return Buffer.alloc(0);
    }
  }
}
