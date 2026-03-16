import _ from 'lodash';
import { OrefCategory, OrefRealtimeAlert, AlertState } from '../types';
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
    alertTimeoutMinutes: number,
  ) {
    this.citySet = new Set(cities);
    this.maxActiveAgeMs = alertTimeoutMinutes * 60 * 1000;
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

    this.client.fetchAlerts()
      .then((alerts) => {
        this.handleAlerts(alerts);
      })
      .catch((err) => {
        this.log.error(`Failed to fetch alerts: ${err}`);
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

    const endedAlerts = _.filter(alerts, (alert) => alert.cat === String(OrefCategory.EventEnded));
    const relevantAlerts = _.filter(alerts, (alert) => {
      const categoryId = _.toInteger(alert.cat);
      return categoryId > 0 && categoryId !== OrefCategory.EventEnded && this.allowedCategories.has(categoryId);
    });

    // Clear cities from ended events
    _(endedAlerts)
      .flatMap((alert) => alert.data)
      .filter((city) => this.activeCities.has(city))
      .forEach((city) => {
        this.activeCities.delete(city);
        this.log.info(`Event ended: ${city}`);
      });

    // Add newly alerted cities
    _(relevantAlerts)
      .flatMap((alert) => _.map(alert.data, (city) => ({ city, title: alert.title })))
      .filter(({ city }) => this.citySet.has(city) && !this.activeCities.has(city))
      .forEach(({ city, title }) => {
        this.activeCities.set(city, Date.now());
        this.log.info(`ALERT: ${title} - ${city}`);
      });

    this.expireStaleAlerts();
    this.broadcastState();
  }

  private expireStaleAlerts(): void {
    const now = Date.now();
    for (const [city, timestamp] of this.activeCities) {
      if (now - timestamp > this.maxActiveAgeMs) {
        this.activeCities.delete(city);
        this.log.warn(`Alert for ${city} expired after ${this.maxActiveAgeMs / 60000} minutes (safety fallback)`);
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
