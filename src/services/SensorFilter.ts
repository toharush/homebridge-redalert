import _ from 'lodash';
import { OrefRealtimeAlert, AlertState, EVENT_ENDED_TITLE } from '../types';
import { DebugLogger } from '../utils/debugLogger';

export interface AlertListener {
  handleAlerts(alerts: OrefRealtimeAlert[]): void;
}

export interface AlertAccessory {
  updateAlertState(state: AlertState): void;
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

  handleAlerts(alerts: OrefRealtimeAlert[]): void {
    const isEventEnded = (alert: OrefRealtimeAlert) => alert.title === EVENT_ENDED_TITLE;

    const endedAlerts = _.filter(alerts, isEventEnded);
    const relevantAlerts = _.filter(alerts, (alert) => {
      const categoryId = _.toInteger(alert.cat);
      return categoryId > 0 && !isEventEnded(alert) && this.allowedCategories.has(categoryId);
    });

    _(endedAlerts)
      .flatMap((alert) => alert.data)
      .filter((city) => this.activeCities.has(city))
      .forEach((city) => {
        this.activeCities.delete(city);
        this.log.info(`[${this.name}] Event ended: ${city}`);
      });

    _(relevantAlerts)
      .flatMap((alert) => _.map(alert.data, (city) => ({ city, title: alert.title })))
      .filter(({ city }) => this.matchesCity(city))
      .forEach(({ city, title }) => {
        const isNew = !this.activeCities.has(city);
        this.activeCities.set(city, Date.now());
        if (isNew) {
          this.log.info(`[${this.name}] ALERT: ${title} - ${city}`);
        }
      });

    this.expireStaleAlerts();
    this.broadcastState();
  }

  private matchesCity(alertCity: string): boolean {
    if (this.citySet.has(alertCity)) {
      return true;
    }
    if (!this.prefixMatching) {
      return false;
    }
    return _.some([...this.citySet], (configured) =>
      alertCity.startsWith(configured) || configured.startsWith(alertCity),
    );
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
