import https from 'https';
import _ from 'lodash';
import { OrefAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { OREF_ALERTS_URL, OREF_HEADERS } from '../settings';

export class OrefClient {
  private polling = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly log: DebugLogger,
    private readonly pollingInterval: number,
    private readonly onAlerts: (alerts: OrefAlert[]) => void,
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

    this.fetchAlerts()
      .then((alerts) => {
        this.onAlerts(alerts);
      })
      .catch((err) => {
        this.log.easyDebug(() => `Oref poll error: ${err}`);
      })
      .finally(() => {
        if (this.polling) {
          this.pollTimer = setTimeout(() => this.poll(), this.pollingInterval);
        }
      });
  }

  private fetchAlerts(): Promise<OrefAlert[]> {
    return new Promise((resolve, reject) => {
      const req = https.get(OREF_ALERTS_URL, { headers: OREF_HEADERS }, (res) => {
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
            resolve(_.isArray(parsed) ? parsed as OrefAlert[] : []);
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Oref request timeout'));
      });
    });
  }
}
