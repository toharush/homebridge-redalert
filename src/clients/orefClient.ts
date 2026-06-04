import _ from 'lodash';
import { OrefRealtimeAlert, OrefCategory, EVENT_ENDED_PATTERN } from '../types';
import { OREF_ALERTS_URL, OREF_HEADERS } from '../settings';

export interface AlertClient {
  fetchAlerts(): Promise<OrefRealtimeAlert[]>;
}

export class OrefClient implements AlertClient {
  constructor(
    private readonly requestTimeout: number,
  ) {}

  async fetchAlerts(): Promise<OrefRealtimeAlert[]> {
    const res = await fetch(OREF_ALERTS_URL, {
      headers: OREF_HEADERS,
      signal: AbortSignal.timeout(this.requestTimeout),
    });

    if (!res.ok) {
      throw new Error(`OREF API returned ${res.status}`);
    }

    const raw = await res.text();
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1).trim() : raw.trim();

    if (!cleaned) {
      return [];
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      if (cleaned.length < 20) {
        return [];
      }
      throw new Error(`Unexpected response (${cleaned.length} bytes)`);
    }

    const alerts: OrefRealtimeAlert[] = _.isArray(parsed) ? parsed : [parsed];
    return _.map(
      alerts,
      (alert) =>
        _.toInteger(alert.cat) === OrefCategory.HeadsUpNotice &&
        EVENT_ENDED_PATTERN.test(alert.title)
          ? { ...alert, cat: String(OrefCategory.EventEnded) }
          : alert,
    );
  }
}
