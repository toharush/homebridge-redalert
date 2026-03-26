import _ from 'lodash';
import { OrefRealtimeAlert, AlertState, OrefCategory } from '../types';
import { DebugLogger } from '../utils/debugLogger';

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

  _.forEach(
    alerts,
    (alert) => {
      const categoryId = _.toInteger(alert.cat);
      if (categoryId === OrefCategory.EventEnded) {
        _.forEach(
          alert.data,
          (city) => {
            if (city) {
              endedCities.add(city);
            }
          });
      } else if (categoryId > 0) {
        const entry: CityAlert = { categoryId, title: alert.title };
        _.forEach(
          alert.data,
          (city) => {
            if (city) {
              const existing = relevantCities.get(city);
              if (existing) {
                existing.push(entry);
              } else {
                relevantCities.set(city, [entry]);
              }
            }
          });
      }
    });

  return { endedCities, relevantCities };
}

export class SensorFilter implements AlertListener {
  private readonly citySet: Set<string>;
  private readonly activeCities = new Map<string, number>();
  private readonly maxActiveAgeMs: number;

  constructor(
    private readonly name: string,
    private readonly log: DebugLogger,
    private readonly accessory: AlertAccessory,
    cities: string[],
    private readonly allowedCategories: Set<number>,
    alertTimeoutMs: number,
    private readonly prefixMatching: boolean = false,
  ) {
    this.citySet = new Set(cities);
    this.maxActiveAgeMs = alertTimeoutMs;
  }

  handleAlerts(parsed: ParsedAlerts): void {
    const { endedCities, relevantCities } = parsed;

    this.citySet.forEach(
      (configured) => {
        if (this.findMatchInSet(configured, endedCities) && this.activeCities.delete(configured)) {
          this.log.info(`[${this.name}] Event ended: ${configured}`);
        }
      });

    this.citySet.forEach(
      (configured) => {
        const title = this.findMatchingAlert(configured, relevantCities);
        if (!title) {
          return;
        }
        const isNew = !this.activeCities.has(configured);
        this.activeCities.set(configured, Date.now());
        if (isNew) {
          this.log.info(`[${this.name}] ALERT: ${title} - ${configured}`);
        }
      });

    this.expireStaleAlerts();
    this.broadcastState();
  }

  private findMatchInSet(configured: string, alertCities: Set<string>): boolean {
    if (alertCities.has(configured)) {
      return true;
    }
    if (!this.prefixMatching) {
      return false;
    }
    for (const alertCity of alertCities) {
      if (_.startsWith(alertCity, configured) || _.startsWith(configured, alertCity)) {
        return true;
      }
    }
    return false;
  }

  private findMatchingAlert(configured: string, relevantCities: Map<string, CityAlert[]>): string | undefined {
    const tryMatch = (entries: CityAlert[] | undefined): string | undefined => {
      if (!entries) {
        return undefined;
      }
      for (const { categoryId, title } of entries) {
        if (this.allowedCategories.has(categoryId)) {
          return title;
        }
      }
      return undefined;
    };

    const exact = tryMatch(relevantCities.get(configured));
    if (exact) {
      return exact;
    }
    if (!this.prefixMatching) {
      return undefined;
    }
    for (const [alertCity, entries] of relevantCities) {
      if (_.startsWith(alertCity, configured) || _.startsWith(configured, alertCity)) {
        const match = tryMatch(entries);
        if (match) {
          return match;
        }
      }
    }
    return undefined;
  }

  private expireStaleAlerts(): void {
    const now = Date.now();
    for (const [city, timestamp] of this.activeCities) {
      if (now - timestamp > this.maxActiveAgeMs) {
        this.activeCities.delete(city);
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
