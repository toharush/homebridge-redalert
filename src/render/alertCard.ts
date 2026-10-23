// Pure data and layout code for the Apple TV alert card. No canvas here, so it
// runs (and is tested) anywhere; the worker's CardPainter does the drawing.
import { OrefCategory } from '../types';
import type { DoorbellSnapshot } from '../notifiers/DoorbellNotifier';

/** Card geometry is designed at 1280x720 and scaled uniformly to the requested size. */
export const BASE_W = 1280;
export const BASE_H = 720;

export const COLORS = {
  background: '#12141A',
  panel: '#1E212A',
  mapDot: 'rgb(70, 76, 90)',
  text: '#EBEBF0',
  muted: '#8C92A0',
  generic: '#E62828',
};

export const FOOTER_TEXT = '@toharush/homebridge-redalert';
export const GENERIC_TITLE = 'התרעה';
export const GENERIC_SUBTITLE = 'בדקו את ההתרעות באזורכם';
export const IDLE_TITLE = 'אין התרעות פעילות';
export const IDLE_SUBTITLE = 'המערכת מאזינה להתרעות';
export const IDLE_ACCENT = '#2DB45A';

interface CategoryStyle {
  title: string;
  color: string;
}

// Tzofar delivers generic titles such as "Threat 0", so the card always derives
// its Hebrew title and color from the category and only falls back to the title.
const CATEGORY_STYLES = new Map<number, CategoryStyle>([
  [OrefCategory.Rockets, { title: 'ירי רקטות וטילים', color: '#E62828' }],
  [OrefCategory.UAVIntrusion, { title: 'חדירת כלי טיס עוין', color: '#F58C14' }],
  [OrefCategory.TerroristInfiltration, { title: 'חדירת מחבלים', color: '#B4141E' }],
  [OrefCategory.NonConventional, { title: 'אירוע לא קונבנציונלי', color: '#9B4DCA' }],
  [OrefCategory.Earthquake, { title: 'רעידת אדמה', color: '#C8873C' }],
  [OrefCategory.CBRNE, { title: 'אירוע רדיולוגי', color: '#A0C83C' }],
  [OrefCategory.Tsunami, { title: 'צונאמי', color: '#2D8CE6' }],
  [OrefCategory.HazardousMaterials, { title: 'אירוע חומרים מסוכנים', color: '#E6C81E' }],
  [OrefCategory.Warning, { title: 'התרעה מקדימה', color: '#F0B400' }],
  [OrefCategory.HeadsUpNotice, { title: 'מבזק', color: '#2DB4AA' }],
]);

// Placeholder titles some sources send instead of a real one.
const PLACEHOLDER_TITLE = /^(threat\s*\d*|alert)$/i;

export function categoryStyle(category: number | undefined, fallbackTitle: string): CategoryStyle {
  const known = category === undefined ? undefined : CATEGORY_STYLES.get(category);
  if (known) {
    return known;
  }
  const title = fallbackTitle?.trim();
  return { title: title && !PLACEHOLDER_TITLE.test(title) ? title : GENERIC_TITLE, color: COLORS.generic };
}

/**
 * Accent for text on the dark panel. Very dark accents (terror's dark red) are
 * mixed 35% toward white so the time stays readable; bars and dots keep the original.
 */
export function readableAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lin = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  if (luminance >= 0.12) {
    return hex;
  }
  const mixed = rgb.map((c) => Math.round(c + (255 - c) * 0.35));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** One alerted city, as posted to the render worker. Plain data only (structured clone). */
export interface CardAlert {
  city: string;
  title: string;
  category?: number;
  timestamp: number;
}

export interface CardData {
  version: number;
  /** De-duplicated by city, newest first. Empty draws the generic card. */
  alerts: CardAlert[];
  maxCities: number;
  /** The static fallback card: alert styling, no cities, no time. */
  generic?: boolean;
  /** The "no active alerts" card, shown once everything has ended. */
  idle?: boolean;
}

/**
 * Flattens the doorbell's `sensor|city` map into card data. The same city from
 * two sensors is listed once. O(active); runs on the main thread after the ring.
 */
export function toCardData(snapshot: DoorbellSnapshot, maxCities: number): CardData {
  const byCity = new Map<string, CardAlert>();
  for (const p of snapshot.active.values()) {
    const prev = byCity.get(p.city);
    if (!prev || p.timestamp > prev.timestamp) {
      byCity.set(p.city, { city: p.city, title: p.title, category: p.category, timestamp: p.timestamp });
    }
  }
  // Stable sort: equal timestamps (one salvo) keep their arrival order.
  const alerts = [...byCity.values()].sort((a, b) => b.timestamp - a.timestamp);
  return { version: snapshot.version, alerts, maxCities };
}

export interface CardModel {
  kind: 'alert' | 'generic' | 'idle';
  title: string;
  accent: string;
  /** Other active categories, shown in small text under the title. */
  subtitle: string | null;
  /** Every alerted city, newest first, with its own category color for the map dot. */
  cities: Array<{ name: string; color: string }>;
  maxCities: number;
  time: string | null;
}

// Created once: constructing an Intl formatter costs far more than formatting.
const TIME_FORMAT = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatTime(timestamp: number): string {
  return TIME_FORMAT.format(timestamp);
}

export function buildCardModel(data: CardData): CardModel {
  if (data.idle) {
    return {
      kind: 'idle', title: IDLE_TITLE, accent: IDLE_ACCENT, subtitle: IDLE_SUBTITLE,
      cities: [], maxCities: data.maxCities, time: null,
    };
  }
  if (data.generic || data.alerts.length === 0) {
    return {
      kind: 'generic', title: GENERIC_TITLE, accent: COLORS.generic, subtitle: GENERIC_SUBTITLE,
      cities: [], maxCities: data.maxCities, time: null,
    };
  }
  // Title and color come from the most recent alert; other categories are listed under it.
  const latest = data.alerts[0];
  const main = categoryStyle(latest.category, latest.title);
  const others: string[] = [];
  const cities: CardModel['cities'] = [];
  for (const a of data.alerts) {
    const style = categoryStyle(a.category, a.title);
    cities.push({ name: a.city, color: style.color });
    if (style.title !== main.title && !others.includes(style.title)) {
      others.push(style.title);
    }
  }
  return {
    kind: 'alert',
    title: main.title,
    accent: main.color,
    subtitle: others.length > 0 ? others.join(' · ') : null,
    cities,
    maxCities: data.maxCities,
    time: formatTime(latest.timestamp),
  };
}

// ---------------------------------------------------------------------------
// Layout (base coordinates, 1280x720)
// ---------------------------------------------------------------------------

// Inset so a glow on the northern- or southernmost city (Metula, Eilat) isn't clipped.
export const MAP_BOX = { x: 40, y: 40, h: 640 };
export const PANEL_GAP = 60;
export const PANEL = { right: BASE_W - 40, top: 40, bottom: BASE_H - 40, radius: 28 };
export const TEXT_RIGHT = BASE_W - 80;
export const TITLE = { baseline: 150, size: 78, minSize: 48 };
export const SUBTITLE = { baseline: 204, size: 30, minSize: 22 };
export const LIST = { top: 228, bottom: 592 };
export const FOOTER = { baseline: BASE_H - 80, timeSize: 40, footerSize: 28 };

interface ListStyle {
  fontSize: number;
  lineHeight: number;
  columns: number;
}

// Tried in order; the first that fits every visible city (plus the "ועוד N" line) wins.
const LIST_STYLES: ListStyle[] = [
  { fontSize: 50, lineHeight: 72, columns: 1 },
  { fontSize: 42, lineHeight: 58, columns: 1 },
  { fontSize: 42, lineHeight: 58, columns: 2 },
  { fontSize: 36, lineHeight: 50, columns: 2 },
  { fontSize: 30, lineHeight: 44, columns: 3 },
];

export interface ListLayout extends ListStyle {
  rows: number;
  /** How many city names are drawn. */
  shown: number;
  /** Count for the "ועוד N" line; 0 means no such line. */
  more: number;
}

export function chooseListLayout(total: number, maxCities: number, height = LIST.bottom - LIST.top): ListLayout {
  const cap = Math.max(1, Math.min(total, maxCities));
  const slotsNeeded = cap + (total > cap ? 1 : 0);
  let style = LIST_STYLES[LIST_STYLES.length - 1];
  for (const s of LIST_STYLES) {
    if (Math.floor(height / s.lineHeight) * s.columns >= slotsNeeded) {
      style = s;
      break;
    }
  }
  const rowsMax = Math.floor(height / style.lineHeight);
  const capacity = rowsMax * style.columns;
  // When even the densest style can't hold them all, keep the last slot for "ועוד N".
  const shown = Math.min(total, slotsNeeded <= capacity ? cap : capacity - 1);
  const slots = shown + (total > shown ? 1 : 0);
  return { ...style, rows: Math.min(rowsMax, Math.ceil(slots / style.columns)), shown, more: total - shown };
}

export function moreLabel(n: number): string {
  return `ועוד ${n}`;
}

/** Width of `text` at `size` px; injected so layout stays testable without canvas. */
export type Measure = (text: string, size: number) => number;

/**
 * Fits text into `maxWidth`: shrink down to `minSize`, then trim and add an
 * ellipsis. The ellipsis goes at the logical end, which is the visual left in RTL.
 */
export function fitText(measure: Measure, text: string, size: number, minSize: number, maxWidth: number): { text: string; size: number } {
  const width = measure(text, size);
  if (width <= maxWidth) {
    return { text, size };
  }
  const scaled = Math.floor(size * maxWidth / width);
  if (scaled >= minSize) {
    return { text, size: scaled };
  }
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join('').trimEnd() + '…', minSize) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { text: chars.slice(0, lo).join('').trimEnd() + '…', size: minSize };
}

// ---------------------------------------------------------------------------
// Map projection and city lookup
// ---------------------------------------------------------------------------

export interface CityPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface Projection {
  /** Right edge of the drawn map, in base coordinates. */
  right: number;
  project(lat: number, lng: number): [number, number];
}

/** Linear projection; x is scaled by cos(mid latitude) so the country keeps its shape. */
export function buildProjection(points: CityPoint[]): Projection {
  let latMin = Infinity;
  let latMax = -Infinity;
  let lngMin = Infinity;
  let lngMax = -Infinity;
  for (const p of points) {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lngMin = Math.min(lngMin, p.lng);
    lngMax = Math.max(lngMax, p.lng);
  }
  if (!Number.isFinite(latMin) || latMax === latMin) {
    // No usable coordinates: an empty map that still leaves room for the panel.
    return { right: MAP_BOX.x + 240, project: () => [MAP_BOX.x, MAP_BOX.y] };
  }
  const sy = MAP_BOX.h / (latMax - latMin);
  const sx = sy * Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
  return {
    right: MAP_BOX.x + (lngMax - lngMin) * sx,
    project: (lat, lng) => [MAP_BOX.x + (lng - lngMin) * sx, MAP_BOX.y + (latMax - lat) * sy],
  };
}

/**
 * Finds a city's coordinates. Oref names don't always match cities.json, so an
 * unknown name falls back to the first entry that starts with it (configured
 * "תל אביב" -> "תל אביב - דרום העיר ויפו"). Misses are remembered, so each name
 * is scanned at most once.
 */
export class CityLocator {
  private readonly exact = new Map<string, CityPoint>();
  private readonly resolved = new Map<string, CityPoint | null>();

  constructor(private readonly points: CityPoint[]) {
    for (const p of points) {
      if (!this.exact.has(p.name)) {
        this.exact.set(p.name, p);
      }
    }
  }

  find(name: string): CityPoint | null {
    const hit = this.exact.get(name);
    if (hit) {
      return hit;
    }
    const cached = this.resolved.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const prefix = name.trim();
    const found = prefix ? this.points.find((p) => p.name.startsWith(prefix)) ?? null : null;
    this.resolved.set(name, found);
    return found;
  }
}

/** Keeps only entries with numeric coordinates. */
export function toCityPoints(raw: unknown): CityPoint[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((c): c is CityPoint => typeof c?.name === 'string' && Number.isFinite(c?.lat) && Number.isFinite(c?.lng));
}
