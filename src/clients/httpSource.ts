import { OrefRealtimeAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertSource } from './AlertSource';
import { CategoryMapping, ResponseFormat, DEFAULT_RESPONSE_FORMAT, normalizeAlerts, extractAlerts } from './categoryMapper';

export interface HttpSourceConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  pollingInterval: number;
  requestTimeout: number;
  failureThreshold: number;
  categoryMapping?: CategoryMapping;
  responseFormat?: ResponseFormat;
  fetchFn?: () => Promise<OrefRealtimeAlert[]>;
  adaptiveTimeout?: boolean;
}

export class HttpSource implements AlertSource {
  readonly name: string;
  readonly type = 'http' as const;

  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private healthy = true;
  private abortController: AbortController | null = null;
  private currentTimeout: number;

  private alertCallback: ((alerts: OrefRealtimeAlert[]) => void) | null = null;
  private healthCallback: ((healthy: boolean) => void) | null = null;

  private readonly responseFormat: ResponseFormat;
  private readonly retryTimeout: number;

  constructor(
    private readonly log: DebugLogger,
    private readonly config: HttpSourceConfig,
  ) {
    this.name = config.name;
    this.responseFormat = config.responseFormat ?? DEFAULT_RESPONSE_FORMAT;
    this.currentTimeout = config.requestTimeout;
    this.retryTimeout = Math.min(config.requestTimeout, 1500);
  }

  onAlerts(callback: (alerts: OrefRealtimeAlert[]) => void): void {
    this.alertCallback = callback;
  }

  onHealthChange(callback: (healthy: boolean) => void): void {
    this.healthCallback = callback;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  start(): void {
    this.polling = true;
    this.log.info(`[${this.name}] HTTP polling started (every ${this.config.pollingInterval}ms)`);
    this.poll();
  }

  stop(): void {
    this.polling = false;
    this.abortController?.abort();
    this.abortController = null;
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

    const promise = this.config.fetchFn
      ? this.config.fetchFn()
      : this.fetchGeneric();

    promise
      .then((alerts) => {
        if (!this.polling) {
          return;
        }
        const elapsed = Date.now() - start;
        if (elapsed > 2000) {
          this.log.warn(`[${this.name}] Slow response: ${elapsed}ms`);
        }
        if (alerts.length > 0) {
          this.alertCallback?.(alerts);
        }
        this.onSuccess();
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') {
          return;
        }
        this.onFailure(err, Date.now() - start);
      })
      .finally(() => {
        if (this.polling) {
          this.pollTimer = setTimeout(() => this.poll(), this.config.pollingInterval);
        }
      });
  }

  private async fetchGeneric(): Promise<OrefRealtimeAlert[]> {
    this.abortController = new AbortController();
    const timeout = setTimeout(() => this.abortController?.abort(), this.currentTimeout);

    try {
      const res = await fetch(this.config.url, {
        headers: this.config.headers,
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const rawAlerts = extractAlerts(body, this.responseFormat.alerts_path);
      return normalizeAlerts(rawAlerts, this.config.categoryMapping ?? {}, this.responseFormat);
    } finally {
      clearTimeout(timeout);
    }
  }

  private onSuccess(): void {
    if (!this.healthy) {
      this.healthy = true;
      this.consecutiveFailures = 0;
      this.healthCallback?.(true);
    } else if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0;
    }
    if (this.config.adaptiveTimeout) {
      this.currentTimeout = this.config.requestTimeout;
    }
  }

  private onFailure(err: Error, elapsed: number): void {
    this.consecutiveFailures++;
    if (this.config.adaptiveTimeout && this.consecutiveFailures === 1) {
      this.currentTimeout = this.retryTimeout;
    }
    if (this.healthy && this.consecutiveFailures >= this.config.failureThreshold) {
      this.healthy = false;
      this.healthCallback?.(false);
    }
    this.log.error(`[${this.name}] Failed to fetch (${elapsed}ms): ${err}`);
  }
}
