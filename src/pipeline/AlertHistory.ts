import * as fs from 'fs';
import { ParsedAlerts, AlertListener } from '../services/SensorFilter';

export interface AlertHistoryEntry {
  timestamp: number;
  source: string;
  cat: string;
  title: string;
  city: string;
  status: 'active' | 'ended';
}

export class AlertHistory implements AlertListener {
  private readonly entries = new Map<string, AlertHistoryEntry>();
  private readonly maxSize: number;
  private readonly filePath: string | null;

  constructor(maxSize: number = 1000, filePath?: string) {
    this.maxSize = maxSize;
    this.filePath = filePath ?? null;
  }

  handleAlerts(parsed: ParsedAlerts): void {
    const { endedCities } = parsed;
    if (endedCities.size > 0) {
      for (const city of endedCities) {
        this.markEnded(city);
      }
    }
  }

  add(source: string, cat: string, title: string, cities: string[]): void {
    const now = Date.now();
    for (const city of cities) {
      const key = `${cat}:${city}`;
      this.entries.set(key, { timestamp: now, source, cat, title, city, status: 'active' });
    }
    if (this.entries.size > this.maxSize) {
      const overflow = this.entries.size - this.maxSize;
      const iter = this.entries.keys();
      for (let i = 0; i < overflow; i++) {
        this.entries.delete(iter.next().value!);
      }
    }
    this.persist();
  }

  markEnded(city: string): boolean {
    let found = false;
    for (const [, entry] of this.entries) {
      if (entry.status === 'active' && entry.city === city) {
        entry.status = 'ended';
        found = true;
      }
    }
    if (found) {
      this.persist();
    }
    return found;
  }

  getAll(): AlertHistoryEntry[] {
    return [...this.entries.values()].reverse();
  }

  clear(): void {
    this.entries.clear();
    this.persist();
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    const tmp = this.filePath + '.tmp';
    const data = [...this.entries.values()];
    fs.promises.writeFile(tmp, JSON.stringify(data))
      .then(() => fs.promises.rename(tmp, this.filePath!))
      .catch(() => {});
  }
}
