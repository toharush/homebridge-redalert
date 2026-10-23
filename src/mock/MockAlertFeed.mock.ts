// State behind `npm run mock` (mock-server.ts). Kept here, apart from the HTTP
// server, so tests can drive the exact /alerts bodies the mock serves. The
// `.mock.ts` suffix keeps it out of the published build (tsconfig excludes it).

export type DeliveryMode = 'both' | 'http' | 'ws';

export interface MockEntry {
  id: string;
  cat: string;
  title: string;
  data: string[];
  desc: string;
}

export const MOCK_CATEGORIES: Record<string, { threat: number; orefCat: number; title: string; emoji: string }> = {
  rockets:         { threat: 0, orefCat: 1, title: 'ירי רקטות וטילים', emoji: '🚀' },
  uav:             { threat: 5, orefCat: 6, title: 'חדירת כלי טיס עוין', emoji: '✈️' },
  terror:          { threat: 2, orefCat: 13, title: 'חדירת מחבלים', emoji: '⚠️' },
  nonconventional: { threat: 7, orefCat: 2, title: 'איום כימי', emoji: '☣️' },
  eventended:      { threat: 99, orefCat: 99, title: 'האירוע הסתיים', emoji: '✓' },
};

export const MOCK_ENDED_TITLE = 'האירוע הסתיים';

interface ActiveCity {
  category: string;
  mode: DeliveryMode;
  /** The fire() call that last set this city; its duration timer only ends cities it still owns. */
  batch: number;
}

export interface MockAlertFeedOptions {
  /** How long /alerts keeps listing a city in the Oref-style all-clear after it ends. */
  endedTtlMs: number;
  /** WebSocket broadcast (mode ws/both). */
  broadcast?: (entries: MockEntry[]) => void;
  now?: () => number;
}

export type FireResult = { ok: true; cities: string[]; mode: DeliveryMode; ended?: string[] } | { ok: false; error: string };

const isHttp = (m: DeliveryMode) => m === 'http' || m === 'both';
const isWs = (m: DeliveryMode) => m === 'ws' || m === 'both';

/**
 * Alerts are tracked per city, like Oref: firing a city adds it to (or refreshes
 * it in) the active set without touching the cities already active, and ending
 * a city puts only that city in the all-clear. /alerts lists every active city
 * (one entry per category) plus an Oref-format "event ended" entry (cat 10) for
 * cities that ended within `endedTtlMs`.
 */
export class MockAlertFeed {
  private readonly active = new Map<string, ActiveCity>();
  /** city -> time until which /alerts lists it as ended. */
  private readonly ended = new Map<string, number>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextBatch = 1;
  private readonly now: () => number;

  constructor(private readonly options: MockAlertFeedOptions) {
    this.now = options.now ?? Date.now;
  }

  fire(cities: string[], categoryKey: string, durationMs: number, mode: DeliveryMode = 'both'): FireResult {
    const list = clean(cities);
    if (list.length === 0) {
      return { ok: false, error: 'No cities provided' };
    }
    const category = MOCK_CATEGORIES[categoryKey];
    if (!category) {
      return { ok: false, error: `Unknown category: ${categoryKey}` };
    }
    if (categoryKey === 'eventended') {
      return { ok: true, cities: list, mode, ended: this.end(list, mode) };
    }

    const batch = this.nextBatch++;
    for (const city of list) {
      this.active.set(city, { category: categoryKey, mode, batch });
      this.ended.delete(city);
    }
    const timer = setTimeout(() => {
      this.timers.delete(batch);
      this.end(this.citiesOf(batch));
    }, durationMs);
    timer.unref?.();
    this.timers.set(batch, timer);
    this.pruneTimers();

    if (isWs(mode)) {
      this.options.broadcast?.([{
        id: `mock-ws-${this.now()}`, cat: String(category.orefCat), title: category.title, data: list, desc: '',
      }]);
    }
    return { ok: true, cities: list, mode };
  }

  /**
   * Ends `cities`, or every active city when none are given. A city that isn't
   * active is still sent as ended (with `mode`), so a plugin left with a stuck
   * sensor (e.g. after the mock restarted) can be cleared. Returns the cities ended.
   */
  end(cities?: string[], mode: DeliveryMode = 'both'): string[] {
    const list = cities === undefined ? [...this.active.keys()] : clean(cities);
    const wsCities: string[] = [];
    const until = this.now() + this.options.endedTtlMs;
    for (const city of list) {
      const m = this.active.get(city)?.mode ?? mode;
      this.active.delete(city);
      if (isHttp(m)) {
        this.ended.set(city, until);
      }
      if (isWs(m)) {
        wsCities.push(city);
      }
    }
    this.pruneTimers();
    if (wsCities.length > 0) {
      this.options.broadcast?.([{ id: `mock-ws-end-${this.now()}`, cat: '99', title: MOCK_ENDED_TITLE, data: wsCities, desc: '' }]);
    }
    return list;
  }

  /** The body of GET /alerts. */
  alerts(): MockEntry[] {
    const t = this.now();
    const byCategory = new Map<string, string[]>();
    for (const [city, a] of this.active) {
      if (!isHttp(a.mode)) {
        continue;
      }
      const arr = byCategory.get(a.category);
      if (arr) {
        arr.push(city);
      } else {
        byCategory.set(a.category, [city]);
      }
    }
    const out: MockEntry[] = [];
    for (const [key, data] of byCategory) {
      const c = MOCK_CATEGORIES[key];
      out.push({ id: `mock-${key}-${t}`, cat: String(c.orefCat), title: c.title, data, desc: '' });
    }
    const endedCities: string[] = [];
    for (const [city, until] of this.ended) {
      if (t < until) {
        endedCities.push(city);
      } else {
        this.ended.delete(city);
      }
    }
    if (endedCities.length > 0) {
      // Oref's own all-clear: category 10 with this title.
      out.push({ id: `mock-end-${t}`, cat: '10', title: MOCK_ENDED_TITLE, data: endedCities, desc: '' });
    }
    return out;
  }

  status(): { cities: string[]; categories: string[] } | null {
    if (this.active.size === 0) {
      return null;
    }
    return {
      cities: [...this.active.keys()],
      categories: [...new Set([...this.active.values()].map((a) => a.category))],
    };
  }

  destroy(): void {
    for (const t of this.timers.values()) {
      clearTimeout(t);
    }
    this.timers.clear();
  }

  private citiesOf(batch: number): string[] {
    const out: string[] = [];
    for (const [city, a] of this.active) {
      if (a.batch === batch) {
        out.push(city);
      }
    }
    return out;
  }

  // A batch whose cities were all re-fired or ended has nothing left to end.
  private pruneTimers(): void {
    for (const [batch, timer] of this.timers) {
      if (this.citiesOf(batch).length === 0) {
        clearTimeout(timer);
        this.timers.delete(batch);
      }
    }
  }
}

function clean(cities: unknown): string[] {
  if (!Array.isArray(cities)) {
    return [];
  }
  return [...new Set(cities.map((c) => String(c ?? '').trim()).filter(Boolean))];
}
