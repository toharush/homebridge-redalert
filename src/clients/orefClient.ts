import _ from 'lodash';
import { OrefRealtimeAlert, OrefCategory, EVENT_ENDED_PATTERN } from '../types';
import { OREF_ALERTS_URL, OREF_HEADERS } from '../settings';

export interface AlertClient {
  fetchAlerts(): Promise<OrefRealtimeAlert[]>;
}

export class OrefClient implements AlertClient {
  constructor(private readonly requestTimeout: number) {}

  async fetchAlerts(): Promise<OrefRealtimeAlert[]> {
    const res = await fetch(OREF_ALERTS_URL, {
      headers: OREF_HEADERS,
      signal: AbortSignal.timeout(this.requestTimeout),
    });

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
