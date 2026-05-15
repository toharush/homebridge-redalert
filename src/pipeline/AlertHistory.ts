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

  constructor(maxSize: number = 20) {
    this.maxSize = maxSize;
  }

  add(entry: AlertHistoryEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.length = this.maxSize;
    }
  }

  markEnded(source: string, city: string): boolean {
    for (const entry of this.entries) {
      if (entry.source === source && entry.status === 'active' && entry.cities.includes(city)) {
        entry.status = 'ended';
        return true;
      }
    }
    return false;
  }

  getAll(): AlertHistoryEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
