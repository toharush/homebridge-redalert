import _ from 'lodash';
import { OrefRealtimeAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertClient } from '../clients/orefClient';
import { AlertListener, parseAlerts } from './SensorFilter';

export class AlertService {
  private readonly listeners: AlertListener[] = [];

  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly log: DebugLogger,
    private readonly client: AlertClient,
    private readonly pollingInterval: number,
  ) {}

  registerListener(listener: AlertListener): void {
    this.listeners.push(listener);
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
        if (!this.polling) {
          return;
        }
        const elapsed = Date.now() - start;
        if (elapsed > 2000) {
          this.log.warn(`Slow API response: ${elapsed}ms`);
        }
        this.broadcast(alerts);
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

  private broadcast(alerts: OrefRealtimeAlert[]): void {
    if (!_.isEmpty(alerts)) {
      this.log.easyDebug(() => `Raw alerts: ${JSON.stringify(alerts)}`);
    }

    const parsed = parseAlerts(alerts);
    for (const listener of this.listeners) {
      listener.handleAlerts(parsed);
    }
  }
}
