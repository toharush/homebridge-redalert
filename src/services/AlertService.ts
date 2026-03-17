import _ from 'lodash';
import { OrefRealtimeAlert, AlertState, EVENT_ENDED_TITLE } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertClient } from '../clients/orefClient';

export interface AlertAccessory {
  updateAlertState(state: AlertState): void;
}

export class AlertService {
  private readonly citySet: Set<string>;
  private readonly activeCities = new Map<string, number>();
  private readonly maxActiveAgeMs: number;
  private readonly accessories: AlertAccessory[] = [];

  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly log: DebugLogger,
    private readonly client: AlertClient,
    cities: string[],
    private readonly allowedCategories: Set<number>,
    private readonly pollingInterval: number,
    private readonly alertTimeoutMs: number,
    private readonly prefixMatching: boolean = false,
  ) {
    this.citySet = new Set(cities);
    this.maxActiveAgeMs = alertTimeoutMs;
  }

  registerAccessory(accessory: AlertAccessory): void {
    this.accessories.push(accessory);
  }

  start(): void {
    this.polling = true;
    this.log.info(`Pikud HaOref polling started (every ${this.pollingInterval}ms)`);
    this.poll();
  }

  stop(): void {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private poll(): void {
    if (!this.polling) {
      return;
    }

    const start = Date.now();
    this.client.fetchAlerts()
      .then((alerts) => {
        const elapsed = Date.now() - start;
        if (elapsed > 2000) {
          this.log.warn(`Slow API response: ${elapsed}ms`);
        }
        this.handleAlerts(alerts);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') {
          return;
        }
        this.log.error(`Failed to fetch alerts (${Date.now() - start}ms): ${err}`);
      })
      .finally(() => {
        if (this.polling) {
          this.pollTimer = setTimeout(() => this.poll(), this.pollingInterval);
        }
      });
  }

  // --- Alert processing ---

  private handleAlerts(alerts: OrefRealtimeAlert[]): void {
    if (!_.isEmpty(alerts)) {
      this.log.easyDebug(() => `Raw alerts: ${JSON.stringify(alerts)}`);
    }

    const isEventEnded = (alert: OrefRealtimeAlert) => alert.title === EVENT_ENDED_TITLE;

    const endedAlerts = _.filter(alerts, isEventEnded);
    const relevantAlerts = _.filter(alerts, (alert) => {
      const categoryId = _.toInteger(alert.cat);
      return categoryId > 0 && !isEventEnded(alert) && this.allowedCategories.has(categoryId);
    });

    // Clear cities from ended events
    _(endedAlerts)
      .flatMap((alert) => alert.data)
      .filter((city) => this.activeCities.has(city))
      .forEach((city) => {
        this.activeCities.delete(city);
        this.log.info(`Event ended: ${city}`);
      });

    // Add newly alerted cities or reset timeout for already active ones
    _(relevantAlerts)
      .flatMap((alert) => _.map(alert.data, (city) => ({ city, title: alert.title })))
      .filter(({ city }) => this.matchesCity(city))
      .forEach(({ city, title }) => {
        const isNew = !this.activeCities.has(city);
        this.activeCities.set(city, Date.now());
        if (isNew) {
          this.log.info(`ALERT: ${title} - ${city}`);
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
        this.log.warn(`Alert for ${city} expired after ${this.maxActiveAgeMs / 1000}s (safety fallback)`);
      }
    }
  }

  private broadcastState(): void {
    const state: AlertState = {
      isActive: this.activeCities.size > 0,
      activeCities: this.activeCities,
    };

    for (const accessory of this.accessories) {
      accessory.updateAlertState(state);
    }
  }
}
