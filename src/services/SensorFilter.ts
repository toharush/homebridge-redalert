import { OrefRealtimeAlert, AlertState, OrefCategory } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { NATIONWIDE_CITY } from '../settings';
import { WebhookPayload } from './WebhookService';
import { AlertNotifier } from './AlertNotifier';

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

  for (let i = 0; i < alerts.length; i++) {
    const alert = alerts[i];
    const categoryId = Number(alert.cat) | 0;
    if (categoryId === OrefCategory.EventEnded) {
      const data = alert.data;
      for (let j = 0; j < data.length; j++) {
        if (data[j]) {
          endedCities.add(data[j]);
        }
      }
    } else if (categoryId > 0) {
      const entry: CityAlert = { categoryId, title: alert.title };
      const data = alert.data;
      for (let j = 0; j < data.length; j++) {
        const city = data[j];
        if (city) {
          const arr = relevantCities.get(city);
          if (arr) {
            arr.push(entry);
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
  private readonly notifier: AlertNotifier | null;
  private hasBroadcast = false;

  constructor(
    private readonly name: string,
    private readonly log: DebugLogger,
    private readonly accessory: AlertAccessory,
    cities: string[],
    private readonly allowedCategories: Set<number>,
    private readonly prefixMatching: boolean = false,
    notifier?: AlertNotifier | null,
  ) {
    this.citySet = new Set(cities);
    this.notifier = notifier ?? null;
  }

  handleAlerts(parsed: ParsedAlerts): void {
    const { endedCities, relevantCities } = parsed;

    const nationwideEnd = endedCities.has(NATIONWIDE_CITY);
    const nationwideAlert = this.findNationwideAlert(relevantCities);

    // Fast path: the common case (no prefix matching, no nationwide event).
    // Iterate the alert cities — usually a handful — and probe citySet, instead
    // of scanning every configured city. For a sensor monitoring many cities
    // hit by a small batch, this is O(alertCities) instead of O(configured).
    if (!this.prefixMatching && !nationwideEnd && !nationwideAlert) {
      this.handleScoped(endedCities, relevantCities);
      return;
    }

    if (this.hasBroadcast && !nationwideEnd && !nationwideAlert && !this.prefixMatching && this.activeCities.size === 0) {
      let hasRelevant = false;
      for (const alertCity of relevantCities.keys()) {
        if (this.citySet.has(alertCity)) {
          hasRelevant = true;
          break;
        }
      }
      if (!hasRelevant) {
        return;
      }
    }

    const events: WebhookPayload[] = [];
    for (const configured of this.citySet) {
      if ((nationwideEnd || this.findMatchInSet(configured, endedCities)) && this.activeCities.delete(configured)) {
        events.push(ended(this.name, configured));
      }

      const match = nationwideAlert ?? this.findMatchingAlert(configured, relevantCities);
      if (match) {
        const isNew = !this.activeCities.has(configured);
        this.activeCities.set(configured, Date.now());
        if (isNew) {
          events.push(alerted(this.name, configured, match));
        }
      }
    }

    this.broadcastState();
    this.emit(events);
  }

  private handleScoped(endedCities: Set<string>, relevantCities: Map<string, CityAlert[]>): void {
    const events: WebhookPayload[] = [];

    // Event-ended: walk the (small) ended set, not the whole configured set.
    if (endedCities.size > 0) {
      for (const city of endedCities) {
        if (this.citySet.has(city) && this.activeCities.delete(city)) {
          events.push(ended(this.name, city));
        }
      }
    }

    // Alerts: walk the (small) alert set, probing the configured set.
    for (const [city, entries] of relevantCities) {
      if (!this.citySet.has(city)) {
        continue;
      }
      const match = this.tryMatchCategory(entries);
      if (match) {
        const isNew = !this.activeCities.has(city);
        this.activeCities.set(city, Date.now());
        if (isNew) {
          events.push(alerted(this.name, city, match));
        }
      }
    }

    this.broadcastState();
    this.emit(events);
  }

  // Logging and notifiers run after the HomeKit update, off the hot path, so a
  // large salvo never delays this sensor or the sensors after it.
  private emit(events: WebhookPayload[]): void {
    if (events.length === 0) {
      return;
    }
    setImmediate(() => {
      for (const e of events) {
        this.log.info(e.event === 'alert' ? `[${this.name}] ALERT: ${e.title} - ${e.city}` : `[${this.name}] Event ended: ${e.city}`);
        // This runs in setImmediate: a throw here would be an uncaught exception
        // (crashing Homebridge) and would drop the rest of the batch.
        try {
          this.notifier?.fire(e);
        } catch (err) {
          this.log.warn(`[${this.name}] Notifier failed for ${e.city}: ${err instanceof Error ? err.message : err}`);
        }
      }
    });
  }

  private findNationwideAlert(relevantCities: Map<string, CityAlert[]>): CityAlert | undefined {
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

  private findMatchingAlert(configured: string, relevantCities: Map<string, CityAlert[]>): CityAlert | undefined {
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

  private tryMatchCategory(entries: CityAlert[] | undefined): CityAlert | undefined {
    if (!entries) {
      return undefined;
    }
    for (const entry of entries) {
      if (this.allowedCategories.has(entry.categoryId)) {
        return entry;
      }
    }
    return undefined;
  }

  private broadcastState(): void {
    this.hasBroadcast = true;
    const state: AlertState = {
      isActive: this.activeCities.size > 0,
      activeCities: this.activeCities,
    };
    this.accessory.updateAlertState(state);
  }
}

function alerted(sensor: string, city: string, match: CityAlert): WebhookPayload {
  return {
    event: 'alert', sensor, city, title: match.title || 'Alert', timestamp: Date.now(), category: match.categoryId,
  };
}

function ended(sensor: string, city: string): WebhookPayload {
  return { event: 'ended', sensor, city, title: 'Event Ended', timestamp: Date.now() };
}
