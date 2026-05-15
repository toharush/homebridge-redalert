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
  private readonly entries = new Map<string, Map<string, AlertHistoryEntry>>();
  private entryCount = 0;
  private readonly maxSize: number;
  private readonly filePath: string | null;
  private dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;

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
    let catMap = this.entries.get(cat);
    if (!catMap) {
      catMap = new Map();
      this.entries.set(cat, catMap);
    }

    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      const existing = catMap.get(city);
      if (existing) {
        existing.timestamp = now;
        existing.source = source;
        existing.title = title;
        existing.status = 'active';
      } else {
        catMap.set(city, { timestamp: now, source, cat, title, city, status: 'active' });
        this.entryCount++;
      }
    }

    this.trimIfNeeded();
    this.schedulePersist();
  }

  private trimIfNeeded(): void {
    if (this.entryCount <= this.maxSize) {
      return;
    }
    const overflow = this.entryCount - this.maxSize;
    let removed = 0;
    for (const [cat, catMap] of this.entries) {
      for (const [city] of catMap) {
        catMap.delete(city);
        removed++;
        if (removed >= overflow) {
          break;
        }
      }
      if (catMap.size === 0) {
        this.entries.delete(cat);
      }
      if (removed >= overflow) {
        break;
      }
    }
    this.entryCount -= removed;
  }

  markEnded(city: string): boolean {
    let found = false;
    for (const catMap of this.entries.values()) {
      const entry = catMap.get(city);
      if (entry && entry.status === 'active') {
        entry.status = 'ended';
        found = true;
      }
    }
    if (found) {
      this.schedulePersist();
    }
    return found;
  }

  getAll(): AlertHistoryEntry[] {
    const result: AlertHistoryEntry[] = [];
    for (const catMap of this.entries.values()) {
      for (const entry of catMap.values()) {
        result.push(entry);
      }
    }
    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  }

  clear(): void {
    this.entries.clear();
    this.entryCount = 0;
    this.schedulePersist();
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persistTimer || !this.filePath) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flush();
    }, 500);
  }

  private flush(): void {
    if (!this.dirty || !this.filePath || this.writing) {
      return;
    }
    this.dirty = false;
    this.writing = true;
    const tmp = this.filePath + '.tmp';
    const all = this.getAll();
    const data = JSON.stringify(all);
    fs.promises.writeFile(tmp, data)
      .then(() => fs.promises.rename(tmp, this.filePath!))
      .catch(() => {})
      .finally(() => {
        this.writing = false;
        if (this.dirty) {
          this.schedulePersist();
        }
      });
  }
}
