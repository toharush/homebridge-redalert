import { OrefRealtimeAlert, OrefCategory } from '../types';
import { PipelineStage } from './PipelineStage';
import crypto from 'crypto';

export class ExpiryStage implements PipelineStage {
  private readonly maxAgeMs: number;
  private readonly scanIntervalMs: number;
  private lastExpiryScan = 0;
  private seenRef: Map<string, Map<string, number>> | null = null;

  constructor(maxAgeMs: number) {
    this.maxAgeMs = maxAgeMs;
    this.scanIntervalMs = Math.min(maxAgeMs >>> 2, 30000);
  }

  attachSeen(seen: Map<string, Map<string, number>>): void {
    this.seenRef = seen;
  }

  process(alerts: OrefRealtimeAlert[]): OrefRealtimeAlert[] {
    if (!this.seenRef) {
      return alerts;
    }

    const now = Date.now();
    if (now - this.lastExpiryScan < this.scanIntervalMs) {
      return alerts;
    }
    this.lastExpiryScan = now;

    let expired: string[] | null = null;
    for (const catMap of this.seenRef.values()) {
      for (const [city, timestamp] of catMap) {
        if (now - timestamp > this.maxAgeMs) {
          (expired ??= []).push(city);
          catMap.delete(city);
        }
      }
    }

    if (!expired) {
      return alerts;
    }

    const syntheticEnded: OrefRealtimeAlert = {
      id: `expiry-${crypto.randomUUID()}`,
      cat: String(OrefCategory.EventEnded),
      title: 'האירוע הסתיים',
      data: expired,
      desc: '',
    };

    return [...alerts, syntheticEnded];
  }
}
