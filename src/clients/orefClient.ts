import _ from 'lodash';
import { OrefRealtimeAlert, OrefCategory, EVENT_ENDED_PATTERN } from '../types';
import { OREF_ALERTS_URL, OREF_HEADERS } from '../settings';
import { DebugLogger } from '../utils/debugLogger';

export interface AlertClient {
  fetchAlerts(): Promise<OrefRealtimeAlert[]>;
  useRetryTimeout?(): void;
  useNormalTimeout?(): void;
}

export class OrefClient implements AlertClient {
  private currentTimeout: number;

  constructor(
    private readonly requestTimeout: number,
    private readonly log?: DebugLogger,
    private readonly retryTimeout: number = Math.min(requestTimeout, 1500),
  ) {
    this.currentTimeout = requestTimeout;
  }

  useRetryTimeout(): void {
    this.currentTimeout = this.retryTimeout;
  }

  useNormalTimeout(): void {
    this.currentTimeout = this.requestTimeout;
  }

  async fetchAlerts(): Promise<OrefRealtimeAlert[]> {
    const res = await fetch(OREF_ALERTS_URL, {
      headers: OREF_HEADERS,
      signal: AbortSignal.timeout(this.currentTimeout),
    });

    if (!res.ok) {
      this.log?.error(`OREF API returned ${res.status}`);
      return [];
    }

    const raw = await res.text();
    const cleaned = _(raw).replace(/^\uFEFF/, '').trim();

    if (_.isEmpty(cleaned)) {
      return [];
    }

    try {
      const parsed = JSON.parse(cleaned);
      const alerts: OrefRealtimeAlert[] = _.isArray(parsed) ? parsed : [parsed];
      return _.map(
        alerts,
        (alert) =>
          _.toInteger(alert.cat) === OrefCategory.HeadsUpNotice &&
          EVENT_ENDED_PATTERN.test(alert.title)
            ? { ...alert, cat: String(OrefCategory.EventEnded) }
            : alert,
      );
    } catch {
      return [];
    }
  }
}
