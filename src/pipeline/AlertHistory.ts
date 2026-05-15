export interface AlertHistoryEntry {
  timestamp: number;
  source: string;
  cat: string;
  title: string;
  cities: string[];
  dedupResult: 'passed' | 'dropped';
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

  getAll(): AlertHistoryEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
