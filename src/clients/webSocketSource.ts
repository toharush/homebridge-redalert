import WebSocket from 'ws';
import { OrefRealtimeAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertSource } from './AlertSource';
import { CategoryMapping, ResponseFormat, DEFAULT_RESPONSE_FORMAT, normalizeAlerts, extractAlerts } from './categoryMapper';

export interface WebSocketSourceConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  reconnectInterval: number;
  maxReconnectInterval?: number;
  failureThreshold: number;
  categoryMapping?: CategoryMapping;
  responseFormat?: ResponseFormat;
  pingInterval?: number;
  pongTimeout?: number;
  messageType?: string;
  messageDataField?: string;
  parseFn?: (message: any) => OrefRealtimeAlert[];
}

export class WebSocketSource implements AlertSource {
  readonly name: string;
  readonly type = 'websocket' as const;

  private ws: WebSocket | null = null;
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private healthy = true;

  private alertCallback: ((alerts: OrefRealtimeAlert[]) => void) | null = null;
  private healthCallback: ((healthy: boolean) => void) | null = null;

  private readonly responseFormat: ResponseFormat;
  private readonly maxReconnectInterval: number;

  constructor(
    private readonly log: DebugLogger,
    private readonly config: WebSocketSourceConfig,
  ) {
    this.name = config.name;
    this.responseFormat = config.responseFormat ?? DEFAULT_RESPONSE_FORMAT;
    this.maxReconnectInterval = config.maxReconnectInterval ?? 60000;
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
    this.running = true;
    this.log.info(`[${this.name}] WebSocket connecting to ${this.config.url}`);
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  private connect(): void {
    if (!this.running) {
      return;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws.terminate();
      this.ws = null;
    }

    this.ws = new WebSocket(this.config.url, {
      headers: this.config.headers,
    });

    this.ws.on('open', () => {
      this.log.info(`[${this.name}] WebSocket connected`);
      this.onSuccess();
      this.startPing();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.resetPongTimeout();
      try {
        const raw = data.toString();
        if (!raw.length) {
          return;
        }
        this.log.easyDebug(() => `[${this.name}] Message received (${raw.length} bytes)`);
        const message = JSON.parse(raw);
        this.handleMessage(message);
      } catch (err) {
        this.log.error(`[${this.name}] Failed to parse message: ${err}`);
      }
    });

    this.ws.on('pong', () => {
      this.resetPongTimeout();
    });

    this.ws.on('error', (err: Error) => {
      this.log.error(`[${this.name}] WebSocket error: ${err.message}`);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.log.warn(`[${this.name}] WebSocket closed (code=${code}, reason=${reason.toString()})`);
      this.stopPing();
      this.onFailure();
      this.scheduleReconnect();
    });
  }

  private handleMessage(message: any): void {
    if (this.config.parseFn) {
      const alerts = this.config.parseFn(message);
      if (alerts.length > 0) {
        this.log.easyDebug(() => `[${this.name}] Parsed ${alerts.length} alert(s) from message type="${message.type}"`);
        this.alertCallback?.(alerts);
      }
      return;
    }

    let alertData: any;

    if (this.config.messageType) {
      if (message.type !== this.config.messageType) {
        return;
      }
      alertData = this.config.messageDataField
        ? message[this.config.messageDataField]
        : message.data;
    } else {
      alertData = message;
    }

    if (!alertData) {
      return;
    }

    const rawAlerts = extractAlerts(alertData, this.responseFormat.alerts_path);
    const alerts = normalizeAlerts(rawAlerts, this.config.categoryMapping ?? {}, this.responseFormat);
    if (alerts.length > 0) {
      this.alertCallback?.(alerts);
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) {
      return;
    }
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.consecutiveFailures - 1),
      this.maxReconnectInterval,
    );
    this.log.info(`[${this.name}] Reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    const interval = this.config.pingInterval ?? 60000;
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, interval);
    this.resetPongTimeout();
  }

  private resetPongTimeout(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
    }
    const timeout = this.config.pongTimeout ?? 420000;
    this.pongTimer = setTimeout(() => {
      this.log.warn(`[${this.name}] Pong timeout, terminating connection`);
      this.ws?.terminate();
    }, timeout);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws.terminate();
      this.ws = null;
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
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.healthy && this.consecutiveFailures >= this.config.failureThreshold) {
      this.healthy = false;
      this.healthCallback?.(false);
    }
  }
}
