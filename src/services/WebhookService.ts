import { DebugLogger } from '../utils/debugLogger';

export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
}

export interface WebhookPayload {
  event: 'alert' | 'ended';
  sensor: string;
  city: string;
  title: string;
  timestamp: number;
}

export class WebhookService {
  private readonly configs: WebhookConfig[];
  private readonly log: DebugLogger;

  constructor(configs: WebhookConfig[], log: DebugLogger) {
    this.configs = configs.filter((c) => c.url && c.url.trim().length > 0);
    this.log = log;
  }

  fire(payload: WebhookPayload): void {
    for (const config of this.configs) {
      this.send(config, payload);
    }
  }

  private send(config: WebhookConfig, payload: WebhookPayload): void {
    const method = config.method ?? 'POST';
    fetch(config.url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    }).catch((err) => {
      this.log.error(`[Webhook] Failed to send to ${config.url}: ${err.message}`);
    });
  }
}
