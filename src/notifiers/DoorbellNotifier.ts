import type { AlertNotifier } from '../services/AlertNotifier';
import type { WebhookPayload } from '../services/WebhookService';

/** What the snapshot delegate reads: a version that changes whenever the active set does. */
export interface DoorbellSnapshot {
  version: number;
  /** Active alerts keyed by `sensor|city`, in arrival order. */
  active: ReadonlyMap<string, WebhookPayload>;
}

/**
 * Rings one doorbell for every sensor that opted in.
 *
 * Leading-edge ring: the first new city rings immediately. Cities added within
 * `minRingMs` of the last ring only bump the version (so the next snapshot shows
 * them) and earn exactly one follow-up ring when the cooldown ends. "Ended"
 * events change the image but never ring.
 *
 * fire() is O(1) and never rings synchronously: it runs right after the HomeKit
 * update and must not hold up the sensors or webhooks queued behind it.
 */
export class DoorbellNotifier implements AlertNotifier {
  private readonly active = new Map<string, WebhookPayload>();
  private version = 0;
  private lastRing = -Infinity;
  private queued: NodeJS.Immediate | null = null;
  private added = false;
  private followUp: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    private readonly ring: () => void,
    private readonly minRingMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  fire(p: WebhookPayload): void {
    const key = `${p.sensor}|${p.city}`;
    if (p.event === 'alert') {
      if (this.active.has(key)) {
        return;
      }
      this.active.set(key, p);
      this.added = true;
    } else if (!this.active.delete(key)) {
      return;
    }
    this.version++;
    if (!this.queued && !this.destroyed) {
      this.queued = setImmediate(this.flush);
    }
  }

  snapshot(): DoorbellSnapshot {
    return { version: this.version, active: this.active };
  }

  destroy(): void {
    // A ring still queued (setImmediate) or waiting out the cooldown must not go
    // out after shutdown.
    this.destroyed = true;
    if (this.queued) {
      clearImmediate(this.queued);
      this.queued = null;
    }
    if (this.followUp) {
      clearTimeout(this.followUp);
      this.followUp = null;
    }
  }

  private readonly flush = (): void => {
    this.queued = null;
    if (!this.added) {
      return; // ended-only batch: the image changes, nothing rings
    }
    this.added = false;
    const t = this.now();
    const since = t - this.lastRing;
    if (since >= this.minRingMs) {
      this.lastRing = t;
      this.safeRing();
      return;
    }
    // Exactly one follow-up ring per cooldown, however many cities arrive in it.
    if (!this.followUp) {
      this.followUp = setTimeout(() => {
        this.followUp = null;
        if (this.active.size > 0) {
          this.lastRing = this.now();
          this.safeRing();
        }
      }, this.minRingMs - since);
      this.followUp.unref?.();
    }
  };

  // Runs from setImmediate / setTimeout, where a throw would be an uncaught
  // exception and take Homebridge down with it.
  private safeRing(): void {
    try {
      this.ring();
    } catch {
      // The next alert rings again; nothing to retry here.
    }
  }
}
