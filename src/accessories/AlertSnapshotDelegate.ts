import type {
  CameraStreamingDelegate, PrepareStreamCallback, PrepareStreamRequest,
  SnapshotRequest, SnapshotRequestCallback, StreamingRequest, StreamRequestCallback,
} from 'homebridge';
import type { DoorbellSnapshot } from '../notifiers/DoorbellNotifier';
import type { AlertRenderer } from '../render/AlertImageRenderer';

const ALERT_CACHE_SIZE = 4;

interface SnapshotSource {
  snapshot(): DoorbellSnapshot;
}

/**
 * Serves the doorbell's camera snapshot: the alert card for the current set of
 * active alerts. Snapshot-only; the live stream is rejected.
 *
 * Requests never wait on each other: the same (version, size) shares one cached
 * promise, so a burst of requests after a ring costs one render; the last 4 are
 * kept. With nothing active the static fallback picture is returned at once,
 * without touching the renderer.
 */
export class AlertSnapshotDelegate implements CameraStreamingDelegate {
  private readonly cache = new Map<string, Promise<Buffer>>();
  /** Size of the last alert snapshot HomeKit asked for; prewarm renders that one. */
  private lastSize = { width: 1280, height: 720 };

  constructor(private readonly notifier: SnapshotSource, private readonly renderer: AlertRenderer) {}

  handleSnapshotRequest(req: SnapshotRequest, cb: SnapshotRequestCallback): void {
    if (this.notifier.snapshot().active.size === 0) {
      cb(undefined, this.renderer.fallback);
      return;
    }
    this.snapshotFor(req.width, req.height).then((b) => cb(undefined, b), (e) => cb(e));
  }

  prepareStream(_req: PrepareStreamRequest, cb: PrepareStreamCallback): void {
    cb(new Error('snapshot-only'));
  }

  handleStreamRequest(_req: StreamingRequest, cb: StreamRequestCallback): void {
    cb();
  }

  /** Starts rendering the current card in the background, so it is ready when HomeKit asks. */
  prewarm(): void {
    if (this.notifier.snapshot().active.size > 0) {
      void this.snapshotFor(this.lastSize.width, this.lastSize.height);
    }
  }

  private snapshotFor(width: number, height: number): Promise<Buffer> {
    const s = this.notifier.snapshot();
    this.lastSize = { width, height };
    const key = `${s.version}:${width}x${height}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.startRender(s, width, height).catch(() => {
        // Don't keep a failure: the next request for this key renders again.
        if (this.cache.get(key) === p) {
          this.cache.delete(key);
        }
        return this.renderer.fallback;
      });
      this.cache.set(key, p);
      if (this.cache.size > ALERT_CACHE_SIZE) {
        this.cache.delete(this.cache.keys().next().value!);
      }
    }
    return p;
  }

  // A renderer that throws synchronously must still end up as a rejected promise:
  // prewarm() runs from setImmediate, where a throw would crash Homebridge.
  private startRender(s: DoorbellSnapshot, width: number, height: number): Promise<Buffer> {
    try {
      return this.renderer.render(s, width, height);
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
