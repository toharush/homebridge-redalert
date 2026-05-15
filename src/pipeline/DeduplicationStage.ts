import { OrefRealtimeAlert, OrefCategory } from '../types';
import { PipelineStage } from './PipelineStage';
import { ParsedAlerts, CityAlert } from '../services/SensorFilter';
import { AlertHistory } from './AlertHistory';

export class DeduplicationStage implements PipelineStage {
  readonly seen = new Map<string, Map<string, number>>();
  private readonly windowMs: number;
  private readonly history: AlertHistory | null;
  private lastCleanup = 0;
  private _parsed: ParsedAlerts | null = null;

  constructor(windowMs: number = 30000, _log?: unknown, history?: AlertHistory) {
    this.windowMs = windowMs;
    this.history = history ?? null;
  }

  get parsed(): ParsedAlerts | null {
    return this._parsed;
  }

  process(alerts: OrefRealtimeAlert[], sourceName?: string): OrefRealtimeAlert[] {
    const now = Date.now();

    if (now - this.lastCleanup > this.windowMs * 2) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    let result: OrefRealtimeAlert[] | null = null;
    let endedCities: Set<string> | null = null;
    let relevantCities: Map<string, CityAlert[]> | null = null;

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const catId = Number(alert.cat) | 0;

      if (catId === OrefCategory.EventEnded) {
        (result ??= []).push(alert);
        const data = alert.data;
        for (let j = 0; j < data.length; j++) {
          const city = data[j];
          if (city) {
            (endedCities ??= new Set()).add(city);
            for (const catMap of this.seen.values()) {
              catMap.delete(city);
            }
          }
        }
        continue;
      }

      const cat = alert.cat;
      let catMap = this.seen.get(cat);
      if (!catMap) {
        catMap = new Map();
        this.seen.set(cat, catMap);
      }

      const data = alert.data;
      let uniqueCities: string[] | null = null;

      for (let j = 0; j < data.length; j++) {
        const city = data[j];
        if (!city) {
          continue;
        }
        const lastSeen = catMap.get(city);
        if (lastSeen === undefined || now - lastSeen >= this.windowMs) {
          catMap.set(city, now);
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
        this.history?.add(sourceName ?? 'unknown', cat, alert.title, uniqueCities);
        if (uniqueCities.length === data.length) {
          (result ??= []).push(alert);
        } else {
          (result ??= []).push({ id: alert.id, cat, title: alert.title, data: uniqueCities, desc: alert.desc });
        }
      }
    }

    this._parsed = result ? {
      endedCities: endedCities ?? new Set(),
      relevantCities: relevantCities ?? new Map(),
    } : null;

    return result ?? [];
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs * 2;
    for (const [cat, catMap] of this.seen) {
      for (const [city, timestamp] of catMap) {
        if (timestamp < cutoff) {
          catMap.delete(city);
        }
      }
      if (catMap.size === 0) {
        this.seen.delete(cat);
      }
    }
  }
}
