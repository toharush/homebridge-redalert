import { OrefRealtimeAlert, OrefCategory } from '../types';
import { PipelineStage } from './PipelineStage';

export class DeduplicationStage implements PipelineStage {
  private readonly seen = new Map<string, number>();
  private readonly windowMs: number;
  private lastCleanup = 0;

  constructor(windowMs: number = 30000) {
    this.windowMs = windowMs;
  }

  process(alerts: OrefRealtimeAlert[]): OrefRealtimeAlert[] {
    const now = Date.now();

    // Only cleanup every 2 windows — not on every call
    if (now - this.lastCleanup > this.windowMs * 2) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    const window = (now / this.windowMs) | 0;
    let result: OrefRealtimeAlert[] | null = null;

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const catId = (alert.cat as unknown as number) | 0 || Number(alert.cat) | 0;

      if (catId === OrefCategory.EventEnded) {
        (result ??= []).push(alert);
        continue;
      }

      const cat = alert.cat;
      const data = alert.data;
      let uniqueCities: string[] | null = null;

      for (let j = 0; j < data.length; j++) {
        const city = data[j];
        if (!city) {
          continue;
        }
        const key = city + '|' + cat + '|' + window;
        if (!this.seen.has(key)) {
          this.seen.set(key, now);
          (uniqueCities ??= []).push(city);
        }
      }

      if (uniqueCities) {
        if (uniqueCities.length === data.length) {
          (result ??= []).push(alert);
        } else {
          (result ??= []).push({ id: alert.id, cat, title: alert.title, data: uniqueCities, desc: alert.desc });
        }
      }
    }

    return result ?? [];
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs * 2;
    for (const [key, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(key);
      }
    }
  }
}
