import { OrefRealtimeAlert, OrefCategory } from '../types';
import { PipelineStage } from './PipelineStage';
import { ParsedAlerts, CityAlert } from '../services/SensorFilter';
import { AlertHistory } from './AlertHistory';

export class DeduplicationStage implements PipelineStage {
  readonly seen = new Map<string, Map<string, number>>();
  private readonly windowMs: number;
  private readonly history: AlertHistory | null;
  private lastCleanup = 0;
  private cleanupRetentionMs: number;
  private _parsed: ParsedAlerts | null = null;

  constructor(windowMs: number = 30000, _log?: unknown, history?: AlertHistory) {
    this.windowMs = windowMs;
    this.history = history ?? null;
    this.cleanupRetentionMs = windowMs * 2;
  }

  /**
   * Raises the floor on how long `seen` entries are retained before cleanup
   * purges them. A downstream consumer that shares this map (e.g. ExpiryStage)
   * needs entries to outlive the dedup window, otherwise cleanup deletes the
   * entries it depends on before it can act on them. Dedup's pass/drop logic is
   * unaffected — it always compares against the `windowMs` cutoff.
   */
  setMinRetention(ms: number): void {
    if (ms > this.cleanupRetentionMs) {
      this.cleanupRetentionMs = ms;
    }
  }

  get parsed(): ParsedAlerts | null {
    return this._parsed;
  }

  process(alerts: OrefRealtimeAlert[], sourceName?: string): OrefRealtimeAlert[] {
    if (alerts.length === 0) {
      this._parsed = null;
      return alerts;
    }

    const now = Date.now();
    const cutoff = now - this.windowMs;

    if (now - this.lastCleanup > this.cleanupRetentionMs) {
      this.cleanup(now - this.cleanupRetentionMs);
      this.lastCleanup = now;
    }

    let result: OrefRealtimeAlert[] | null = null;
    let endedCities: Set<string> | null = null;
    let relevantCities: Map<string, CityAlert[]> | null = null;

    let prevCat = '';
    let catMap: Map<string, number> | undefined;

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const catId = +alert.cat | 0;

      if (catId === OrefCategory.EventEnded) {
        (result ??= []).push(alert);
        const data = alert.data;
        for (let j = 0; j < data.length; j++) {
          const city = data[j];
          if (city) {
            (endedCities ??= new Set()).add(city);
            for (const cm of this.seen.values()) {
              cm.delete(city);
            }
          }
        }
        continue;
      }

      const cat = alert.cat;
      if (cat !== prevCat) {
        catMap = this.seen.get(cat);
        if (!catMap) {
          catMap = new Map();
          this.seen.set(cat, catMap);
        }
        prevCat = cat;
      }

      const data = alert.data;
      let uniqueCities: string[] | null = null;

      for (let j = 0; j < data.length; j++) {
        const city = data[j];
        if (!city) {
          continue;
        }
        const lastSeen = catMap!.get(city);
        if (lastSeen === undefined || lastSeen <= cutoff) {
          catMap!.set(city, now);
          (uniqueCities ??= []).push(city);

          const entry: CityAlert = { categoryId: catId, title: alert.title };
          const rc = (relevantCities ??= new Map());
          const arr = rc.get(city);
          if (arr) {
            arr.push(entry);
          } else {
            rc.set(city, [entry]);
          }
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

    if (result && this.history) {
      for (let i = 0; i < result.length; i++) {
        const a = result[i];
        if ((+a.cat | 0) !== OrefCategory.EventEnded) {
          this.history.add(sourceName ?? 'unknown', a.cat, a.title, a.data);
        }
      }
    }

    this._parsed = result ? {
      endedCities: endedCities ?? new Set(),
      relevantCities: relevantCities ?? new Map(),
    } : null;

    return result ?? [];
  }

  private cleanup(cutoff: number): void {
    for (const [cat, catMap] of this.seen) {
      for (const [city, timestamp] of catMap) {
        if (timestamp <= cutoff) {
          catMap.delete(city);
        }
      }
      if (catMap.size === 0) {
        this.seen.delete(cat);
      }
    }
  }
}
