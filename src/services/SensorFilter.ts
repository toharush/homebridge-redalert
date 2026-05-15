import { OrefRealtimeAlert, AlertState, OrefCategory } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { NATIONWIDE_CITY } from '../settings';
import { AlertHistory } from '../pipeline/AlertHistory';
import { WebhookService } from './WebhookService';

export interface CityAlert {
  categoryId: number;
  title: string;
}

export interface ParsedAlerts {
  endedCities: Set<string>;
  relevantCities: Map<string, CityAlert[]>;
}

export interface AlertListener {
  handleAlerts(parsed: ParsedAlerts): void;
}

export interface AlertAccessory {
  updateAlertState(state: AlertState): void;
}

export function parseAlerts(alerts: OrefRealtimeAlert[]): ParsedAlerts {
  const endedCities = new Set<string>();
  const relevantCities = new Map<string, CityAlert[]>();

  for (const alert of alerts) {
    const categoryId = Number(alert.cat) | 0;
    if (categoryId === OrefCategory.EventEnded) {
      for (const city of alert.data) {
        if (city) {
          endedCities.add(city);
        }
      }
    } else if (categoryId > 0) {
      const entry: CityAlert = { categoryId, title: alert.title };
      for (const city of alert.data) {
        if (city) {
          const existing = relevantCities.get(city);
          if (existing) {
            existing.push(entry);
          } else {
            relevantCities.set(city, [entry]);
          }
        }
      }
    }
  }

  return { endedCities, relevantCities };
}

export class SensorFilter implements AlertListener {
  private readonly citySet: Set<string>;
  private readonly activeCities = new Map<string, number>();
  private readonly maxActiveAgeMs: number;
  private readonly history: AlertHistory | null;
  private readonly webhook: WebhookService | null;

  constructor(
    private readonly name: string,
    private readonly log: DebugLogger,
    private readonly accessory: AlertAccessory,
    cities: string[],
    private readonly allowedCategories: Set<number>,
    alertTimeoutMs: number,
    private readonly prefixMatching: boolean = false,
    history?: AlertHistory,
    webhook?: WebhookService,
  ) {
    this.citySet = new Set(cities);
    this.maxActiveAgeMs = alertTimeoutMs;
    this.history = history ?? null;
    this.webhook = webhook ?? null;
  }

  handleAlerts(parsed: ParsedAlerts): void {
    const { endedCities, relevantCities } = parsed;

    const nationwideEnd = endedCities.has(NATIONWIDE_CITY);
    const nationwideAlert = this.findNationwideAlert(relevantCities);

    for (const configured of this.citySet) {
      if ((nationwideEnd || this.findMatchInSet(configured, endedCities)) && this.activeCities.delete(configured)) {
        this.log.info(`[${this.name}] Event ended: ${configured}`);
        this.history?.markEnded(this.name, configured);
        this.webhook?.fire({
          event: 'ended', sensor: this.name, city: configured, title: 'Event Ended', timestamp: Date.now(),
        });
      }

      const title = nationwideAlert ?? this.findMatchingAlert(configured, relevantCities);
      if (title) {
        const isNew = !this.activeCities.has(configured);
        this.activeCities.set(configured, Date.now());
        if (isNew) {
          this.log.info(`[${this.name}] ALERT: ${title} - ${configured}`);
          this.webhook?.fire({
            event: 'alert', sensor: this.name, city: configured, title, timestamp: Date.now(),
          });
        }
      }
    }

    this.expireStaleAlerts();
    this.broadcastState();
  }

  private findNationwideAlert(relevantCities: Map<string, CityAlert[]>): string | undefined {
    return this.tryMatchCategory(relevantCities.get(NATIONWIDE_CITY));
  }

  private findMatchInSet(configured: string, alertCities: Set<string>): boolean {
    if (alertCities.has(configured)) {
      return true;
    }
    if (!this.prefixMatching) {
      return false;
    }
    for (const alertCity of alertCities) {
      if (alertCity.startsWith(configured) || configured.startsWith(alertCity)) {
        return true;
      }
    }
    return false;
  }

  private findMatchingAlert(configured: string, relevantCities: Map<string, CityAlert[]>): string | undefined {
    const exact = this.tryMatchCategory(relevantCities.get(configured));
    if (exact) {
      return exact;
    }
    if (!this.prefixMatching) {
      return undefined;
    }
    for (const [alertCity, entries] of relevantCities) {
      if (alertCity.startsWith(configured) || configured.startsWith(alertCity)) {
        const match = this.tryMatchCategory(entries);
        if (match) {
          return match;
        }
      }
    }
    return undefined;
  }

  private tryMatchCategory(entries: CityAlert[] | undefined): string | undefined {
    if (!entries) {
      return undefined;
    }
    for (const { categoryId, title } of entries) {
      if (this.allowedCategories.has(categoryId)) {
        return title;
      }
    }
    return undefined;
  }

  private expireStaleAlerts(): void {
    const now = Date.now();
    for (const [city, timestamp] of this.activeCities) {
      if (now - timestamp > this.maxActiveAgeMs) {
        this.activeCities.delete(city);
        this.history?.markEnded(this.name, city);
        this.log.warn(`[${this.name}] Alert for ${city} expired after ${this.maxActiveAgeMs / 1000}s (safety fallback)`);
      }
    }
  }

  private broadcastState(): void {
    const state: AlertState = {
      isActive: this.activeCities.size > 0,
      activeCities: this.activeCities,
    };
    this.accessory.updateAlertState(state);
  }
}
