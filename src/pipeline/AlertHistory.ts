export interface AlertHistoryEntry {
  timestamp: number;
  source: string;
  cat: string;
  title: string;
  cities: string[];
  dedupResult: 'passed' | 'dropped';
  status?: 'active' | 'ended';
}

export class AlertHistory {
  private readonly entries: AlertHistoryEntry[] = [];
  private readonly maxSize: number;
  private dirty = false;

  constructor(maxSize: number = 20) {
    this.maxSize = maxSize;
  }

  add(entry: AlertHistoryEntry): void {
    if (entry.status === 'active') {
      for (const existing of this.entries) {
        if (existing.status === 'active' && existing.cat === entry.cat
          && entry.cities.every((c) => existing.cities.includes(c))) {
          existing.timestamp = entry.timestamp;
          this.dirty = true;
          return;
        }
      }
    }
    this.entries.unshift(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.length = this.maxSize;
    }
    this.dirty = true;
  }

  markEnded(_source: string, city: string, cat?: string): boolean {
    let found = false;
    for (const entry of this.entries) {
      if (entry.status === 'active' && entry.cities.includes(city)
        && (cat === undefined || entry.cat === cat)) {
        entry.status = 'ended';
        found = true;
      }
    }
    if (found) {
      this.dirty = true;
    }
    return found;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty = false;
  }

  getAll(): AlertHistoryEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
    this.dirty = true;
  }
}
