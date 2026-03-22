import _ from 'lodash';
import { OrefRealtimeAlert, AlertState, OrefCategory, getRelatedCategories } from '../types';
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
  private readonly relatedCategories: Set<number>;

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
    const related = new Set<number>();
    for (const cat of allowedCategories) {
      for (const r of getRelatedCategories(cat)) {
        related.add(r);
      }
    }
    this.relatedCategories = related;
  }

  handleAlerts(alerts: OrefRealtimeAlert[]): void {
    const isEventEnded = (alert: OrefRealtimeAlert) => _.toInteger(alert.cat) === OrefCategory.EventEnded;

    const endedAlerts = _.filter(alerts, isEventEnded);
    const allActiveAlerts = _.filter(alerts, (alert) => {
      const categoryId = _.toInteger(alert.cat);
      return categoryId > 0 && !isEventEnded(alert);
    });
    const relevantAlerts = _.filter(allActiveAlerts, (alert) => {
      const categoryId = _.toInteger(alert.cat);
      return this.allowedCategories.has(categoryId);
    });

    _(endedAlerts)
      .flatMap((alert) => alert.data)
      .forEach((city) => {
        const matched = this.findConfiguredCity(city);
        if (matched && this.activeCities.delete(matched)) {
          this.log.info(`[${this.name}] Event ended: ${matched}`);
        }
      });

    // Refresh timestamps for already-active cities from related categories.
    // e.g. rockets and notices are related, so a notice keeps a rocket sensor alive.
    const relatedAlerts = _.filter(allActiveAlerts, (alert) =>
      this.relatedCategories.has(_.toInteger(alert.cat)),
    );

    _(relatedAlerts)
      .flatMap((alert) => alert.data)
      .forEach((city) => {
        const matched = this.findConfiguredCity(city);
        if (matched && this.activeCities.has(matched)) {
          this.activeCities.set(matched, Date.now());
        }
      });

    _(relevantAlerts)
      .flatMap((alert) => _.map(alert.data, (city) => ({ city, title: alert.title })))
      .forEach(({ city, title }) => {
        const matched = this.findConfiguredCity(city);
        if (!matched) {
          return;
        }
        const isNew = !this.activeCities.has(matched);
        this.activeCities.set(matched, Date.now());
        if (isNew) {
          this.log.info(`[${this.name}] ALERT: ${title} - ${city}`);
        }
      });

    this.expireStaleAlerts();
    this.broadcastState();
  }

  private findConfiguredCity(alertCity: string): string | undefined {
    if (!alertCity) {
      return undefined;
    }
    if (this.citySet.has(alertCity)) {
      return alertCity;
    }
    if (!this.prefixMatching) {
      return undefined;
    }
    for (const configured of this.citySet) {
      if (_.startsWith(alertCity, configured) || _.startsWith(configured, alertCity)) {
        return configured;
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
