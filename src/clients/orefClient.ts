import _ from 'lodash';
import { OrefRealtimeAlert } from '../types';
import { OREF_ALERTS_URL, OREF_HEADERS } from '../settings';

export interface AlertClient {
  fetchAlerts(): Promise<OrefRealtimeAlert[]>;
}

export class OrefClient implements AlertClient {
  async fetchAlerts(): Promise<OrefRealtimeAlert[]> {
    const res = await fetch(OREF_ALERTS_URL, {
      headers: OREF_HEADERS,
      signal: AbortSignal.timeout(5000),
    });

    const raw = await res.text();
    const cleaned = _.trim(raw.replace(/^\uFEFF/, ''));

    if (_.isEmpty(cleaned)) {
      return [];
    }

    try {
      const parsed = JSON.parse(cleaned);
      return _.isArray(parsed) ? parsed as OrefRealtimeAlert[] : [parsed as OrefRealtimeAlert];
    } catch {
      return [];
    }
  }
}
