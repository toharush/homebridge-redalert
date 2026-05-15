import { OrefRealtimeAlert, OrefCategory } from '../types';
import { PipelineStage } from './PipelineStage';
import { DebugLogger } from '../utils/debugLogger';
import { AlertHistory } from './AlertHistory';

export class DeduplicationStage implements PipelineStage {
  private readonly seen = new Map<string, Map<string, number>>();
  private readonly seenSource = new Map<string, Map<string, string>>();
  private readonly seenIds = new Map<string, number>();
  private readonly windowMs: number;
  private readonly log: DebugLogger | null;
  private readonly history: AlertHistory | null;
  private readonly debug: boolean;
  private lastCleanup = 0;

  constructor(windowMs: number = 30000, log?: DebugLogger, history?: AlertHistory) {
    this.windowMs = windowMs;
    this.log = log ?? null;
    this.history = history ?? null;
    this.debug = log !== null;
  }

  process(alerts: OrefRealtimeAlert[], sourceName?: string): OrefRealtimeAlert[] {
    const now = Date.now();

    if (now - this.lastCleanup > this.windowMs * 2) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    let result: OrefRealtimeAlert[] | null = null;

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const catId = (alert.cat as unknown as number) | 0 || Number(alert.cat) | 0;

      if (catId === OrefCategory.EventEnded) {
        this.log?.easyDebug(`[Dedup] PASS event-ended from ${sourceName ?? 'unknown'}: ${alert.data.join(', ')}`);
        (result ??= []).push(alert);
        continue;
      }

      // Fast path: if we've seen this exact alert ID recently, skip entirely
      const idLastSeen = this.seenIds.get(alert.id);
      if (idLastSeen !== undefined && now - idLastSeen < this.windowMs) {
        this.history?.add({
          timestamp: now, source: sourceName ?? 'unknown',
          cat: alert.cat, title: alert.title, cities: alert.data, dedupResult: 'dropped',
        });
        continue;
      }
      this.seenIds.set(alert.id, now);

      const cat = alert.cat;
      const data = alert.data;
      let uniqueCities: string[] | null = null;
      let droppedCities: string[] | null = null;

      let catMap = this.seen.get(cat);
      if (!catMap) {
        catMap = new Map();
        this.seen.set(cat, catMap);
      }

      for (let j = 0; j < data.length; j++) {
        const city = data[j];
        if (!city) {
          continue;
        }
        const lastSeen = catMap.get(city);
        if (lastSeen === undefined || now - lastSeen >= this.windowMs) {
          catMap.set(city, now);
          if (this.debug) {
            let srcMap = this.seenSource.get(cat);
            if (!srcMap) {
              srcMap = new Map();
              this.seenSource.set(cat, srcMap);
            }
            srcMap.set(city, sourceName ?? 'unknown');
          }
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
          cat, title: alert.title, cities: uniqueCities, dedupResult: 'passed', status: 'active',
        });
        if (uniqueCities.length === data.length) {
          (result ??= []).push(alert);
        } else {
          (result ??= []).push({ id: alert.id, cat, title: alert.title, data: uniqueCities, desc: alert.desc });
        }
      }

      if (droppedCities) {
        const firstSource = this.debug
          ? (this.seenSource.get(cat)?.get(droppedCities[0]) ?? 'unknown')
          : 'unknown';
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
    for (const [cat, catMap] of this.seen) {
      for (const [city, timestamp] of catMap) {
        if (timestamp < cutoff) {
          catMap.delete(city);
          this.seenSource.get(cat)?.delete(city);
        }
      }
      if (catMap.size === 0) {
        this.seen.delete(cat);
        this.seenSource.delete(cat);
      }
    }
    for (const [id, timestamp] of this.seenIds) {
      if (timestamp < cutoff) {
        this.seenIds.delete(id);
      }
    }
  }
}
