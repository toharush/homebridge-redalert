import crypto from 'crypto';
import { OrefRealtimeAlert, OrefCategory } from '../types';

const THREAT_TO_CATEGORY: Record<number, number> = {
  0: OrefCategory.Rockets,
  2: OrefCategory.TerroristInfiltration,
  5: OrefCategory.UAVIntrusion,
  7: OrefCategory.NonConventional,
};

const INSTRUCTION_TYPE_EARLY_WARNING = 0;
const INSTRUCTION_TYPE_END_EVENT = 1;

const EARLY_WARNING_KEYWORDS = [
  'בדקות הקרובות',
  'צפויות להתקבל התרעות',
  'ייתכן ויופעלו התרעות',
  'זיהוי שיגורים',
  'שיגורים לעבר ישראל',
  'בעקבות זיהוי שיגורים',
];

const EXIT_NOTIFICATION_KEYWORDS = [
  'האירוע הסתיים',
  'הסתיים באזורים',
  'האירוע הסתיים באזורים',
];

const TZOFAR_CITIES_URL = 'https://www.tzevaadom.co.il/static/cities.json';

let tzofarIdToName: Map<number, string> | null = null;
let cityMapLoading: Promise<void> | null = null;

/** @internal Test helper to inject a city map without network fetch */
export function _setTzofarCityMap(map: Map<number, string> | null): void {
  tzofarIdToName = map;
  cityMapLoading = null;
}

export async function loadTzofarCityMap(): Promise<void> {
  if (tzofarIdToName) {
    return;
  }
  if (cityMapLoading) {
    return cityMapLoading;
  }
  cityMapLoading = doLoadCityMap();
  return cityMapLoading;
}

async function doLoadCityMap(): Promise<void> {
  try {
    let version = 10;
    try {
      const versionsRes = await fetch('https://api.tzevaadom.co.il/lists-versions');
      const versions = await versionsRes.json() as Record<string, number>;
      if (versions.cities) {
        version = versions.cities;
      }
    } catch { /* use default version */ }

    const res = await fetch(`${TZOFAR_CITIES_URL}?v=${version}`);
    const json = await res.json() as { cities: Record<string, { id?: number; he?: string }> };
    const map = new Map<number, string>();

    for (const [key, city] of Object.entries(json.cities)) {
      const tzofarId = city.id;
      const name = city.he || key;
      if (tzofarId !== undefined) {
        map.set(tzofarId, name);
      }
    }

    tzofarIdToName = map;
    // eslint-disable-next-line no-console
    console.log(`[Tzofar] Loaded ${map.size} cities from Tzofar API (v${version})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[Tzofar] Failed to load city map: ${err}. SYSTEM_MESSAGE citiesIds will fall back to body text.`);
    tzofarIdToName = new Map();
  }
}

export function resolveCityIds(ids: number[]): string[] {
  if (!tzofarIdToName || tzofarIdToName.size === 0) {
    return [];
  }
  const names: string[] = [];
  for (const id of ids) {
    const name = tzofarIdToName.get(id);
    if (name) {
      names.push(name);
    }
  }
  return names;
}

export function parseTzofarMessage(message: any): OrefRealtimeAlert[] {
  if (!message || !message.type) {
    return [];
  }

  if (message.type === 'ALERT') {
    return parseAlert(message.data);
  }

  if (message.type === 'SYSTEM_MESSAGE') {
    return parseSystemMessage(message.data);
  }

  return [];
}

function parseAlert(data: any): OrefRealtimeAlert[] {
  if (!data || data.isDrill) {
    return [];
  }

  const cities: string[] = Array.isArray(data.cities) ? data.cities : [];
  if (cities.length === 0) {
    return [];
  }

  const category = THREAT_TO_CATEGORY[data.threat];
  if (category === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[Tzofar] Unknown threat type ${data.threat} for cities: ${cities.join(', ')}`);
    return [];
  }

  return [{
    id: `tzofar-${crypto.randomUUID()}`,
    cat: String(category),
    title: `Threat ${data.threat}`,
    data: cities,
    desc: '',
  }];
}

function parseSystemMessage(data: any): OrefRealtimeAlert[] {
  if (!data) {
    return [];
  }

  const body: string = data.bodyHe || '';
  const instructionType: number | undefined = data.instructionType;

  const isEarly = instructionType === INSTRUCTION_TYPE_EARLY_WARNING
    || (instructionType === undefined && isEarlyWarningByKeywords(data.titleHe, body));

  const isEnd = instructionType === INSTRUCTION_TYPE_END_EVENT
    || (instructionType === undefined && isExitNotificationByKeywords(data.titleHe, body));

  if (isEarly) {
    const cities = resolveCities(data.citiesIds, body);
    if (cities.length === 0) {
      return [];
    }
    return [{
      id: `tzofar-ew-${crypto.randomUUID()}`,
      cat: String(OrefCategory.Warning),
      title: data.titleHe || 'Early Warning',
      data: cities,
      desc: body,
    }];
  }

  if (isEnd) {
    const cities = resolveCities(data.citiesIds, body);
    if (cities.length === 0) {
      return [];
    }
    return [{
      id: `tzofar-exit-${crypto.randomUUID()}`,
      cat: String(OrefCategory.EventEnded),
      title: data.titleHe || 'Event Ended',
      data: cities,
      desc: body,
    }];
  }

  return [];
}

function resolveCities(citiesIds: number[] | undefined, body: string): string[] {
  if (Array.isArray(citiesIds) && citiesIds.length > 0) {
    const resolved = resolveCityIds(citiesIds);
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return extractCitiesFromBody(body);
}

function isEarlyWarningByKeywords(title: string | undefined, body: string): boolean {
  if (!title?.includes('מבזק פיקוד העורף')) {
    return false;
  }
  return EARLY_WARNING_KEYWORDS.some((kw) => body.includes(kw));
}

function isExitNotificationByKeywords(title: string | undefined, body: string): boolean {
  if (!title?.includes('עדכון פיקוד העורף')) {
    return false;
  }
  return EXIT_NOTIFICATION_KEYWORDS.some((kw) => body.includes(kw));
}

function extractCitiesFromBody(body: string): string[] {
  const match = body.match(/באזורים?:?\s*(.+)/);
  if (!match) {
    return [];
  }
  return match[1].split(/[,،]/).map((c) => c.trim()).filter(Boolean);
}
