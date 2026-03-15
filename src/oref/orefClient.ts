import https from 'https';
import _ from 'lodash';
import { OrefRealtimeAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { OREF_ALERTS_URL, OREF_HEADERS } from '../settings';

export class OrefClient {
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly log: DebugLogger,
    private readonly pollingInterval: number,
    private readonly onRealtimeAlerts: (alerts: OrefRealtimeAlert[]) => void,
  ) {}

  start() {
    this.polling = true;
    this.log.info(`Pikud HaOref polling started (every ${this.pollingInterval}ms)`);
    this.poll();
  }

  stop() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private poll() {
    if (!this.polling) {
      return;
    }

    this.fetchJson<OrefRealtimeAlert>(OREF_ALERTS_URL)
      .then((alerts) => {
        if (!_.isEmpty(alerts)) {
          this.log.easyDebug(() => `Raw alerts: ${JSON.stringify(alerts)}`);
        }
        this.onRealtimeAlerts(alerts);
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

  private fetchJson<T>(url: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: OREF_HEADERS }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            const cleaned = _.trim(raw.replace(/^\uFEFF/, ''));
            if (_.isEmpty(cleaned)) {
              resolve([]);
              return;
            }
            const parsed = JSON.parse(cleaned);
            resolve(_.isArray(parsed) ? parsed as T[] : [parsed as T]);
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }
}
