import { OrefRealtimeAlert, OrefCategory } from '../types';
import { PipelineStage } from './PipelineStage';
import { DebugLogger } from '../utils/debugLogger';
import { AlertHistory } from './AlertHistory';

export class DeduplicationStage implements PipelineStage {
  private readonly seen = new Map<string, number>();
  private readonly seenSource = new Map<string, string>();
  private readonly windowMs: number;
  private readonly log: DebugLogger | null;
  private readonly history: AlertHistory | null;
  private lastCleanup = 0;

  constructor(windowMs: number = 30000, log?: DebugLogger, history?: AlertHistory) {
    this.windowMs = windowMs;
    this.log = log ?? null;
    this.history = history ?? null;
  }

  process(alerts: OrefRealtimeAlert[], sourceName?: string): OrefRealtimeAlert[] {
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
        this.log?.easyDebug(`[Dedup] PASS event-ended from ${sourceName ?? 'unknown'}: ${alert.data.join(', ')}`);
        (result ??= []).push(alert);
        continue;
      }

      const cat = alert.cat;
      const data = alert.data;
      let uniqueCities: string[] | null = null;
      let droppedCities: string[] | null = null;

      for (let j = 0; j < data.length; j++) {
        const city = data[j];
        if (!city) {
          continue;
        }
        const key = city + '|' + cat + '|' + window;
        if (!this.seen.has(key)) {
          this.seen.set(key, now);
          this.seenSource.set(key, sourceName ?? 'unknown');
          (uniqueCities ??= []).push(city);
        } else {
          (droppedCities ??= []).push(city);
        }
      }

      if (uniqueCities) {
        this.log?.easyDebug(
          `[Dedup] WINNER ${sourceName ?? 'unknown'} for cat=${cat}: ${uniqueCities.join(', ')}`,
        );
        this.history?.add({
          timestamp: now, source: sourceName ?? 'unknown',
          cat, title: alert.title, cities: uniqueCities, dedupResult: 'passed',
        });
        if (uniqueCities.length === data.length) {
          (result ??= []).push(alert);
        } else {
          (result ??= []).push({ id: alert.id, cat, title: alert.title, data: uniqueCities, desc: alert.desc });
        }
      }

      if (droppedCities) {
        const key = droppedCities[0] + '|' + cat + '|' + window;
        const firstSource = this.seenSource.get(key) ?? 'unknown';
        this.log?.easyDebug(
          `[Dedup] DROP duplicate from ${sourceName ?? 'unknown'} ` +
          `for cat=${cat}: ${droppedCities.join(', ')} (first seen from ${firstSource})`,
        );
        this.history?.add({
          timestamp: now, source: sourceName ?? 'unknown',
          cat, title: alert.title, cities: droppedCities, dedupResult: 'dropped',
        });
      }
    }

    if (result) {
      this.log?.easyDebug(`[Dedup] Result: ${result.length} alert(s) passed from ${sourceName ?? 'unknown'}`);
    }

    return result ?? [];
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs * 2;
    for (const [key, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(key);
        this.seenSource.delete(key);
      }
    }
  }
}
