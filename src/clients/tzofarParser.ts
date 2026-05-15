import { OrefRealtimeAlert, OrefCategory } from '../types';

const THREAT_TO_CATEGORY: Record<number, number> = {
  0: OrefCategory.Rockets,
  2: OrefCategory.TerroristInfiltration,
  5: OrefCategory.UAVIntrusion,
  7: OrefCategory.NonConventional,
};

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
    id: `tzofar-${Date.now()}`,
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

  if (isEarlyWarning(data.titleHe, body)) {
    const cities = extractCitiesFromBody(body);
    return [{
      id: `tzofar-ew-${Date.now()}`,
      cat: String(OrefCategory.Warning),
      title: data.titleHe || 'Early Warning',
      data: cities.length > 0 ? cities : ['רחבי הארץ'],
      desc: body,
    }];
  }

  if (isExitNotification(data.titleHe, body)) {
    const cities = extractCitiesFromBody(body);
    return [{
      id: `tzofar-exit-${Date.now()}`,
      cat: String(OrefCategory.EventEnded),
      title: data.titleHe || 'Event Ended',
      data: cities.length > 0 ? cities : ['רחבי הארץ'],
      desc: body,
    }];
  }

  return [];
}

function isEarlyWarning(title: string | undefined, body: string): boolean {
  if (!title?.includes('מבזק פיקוד העורף')) {
    return false;
  }
  return EARLY_WARNING_KEYWORDS.some((kw) => body.includes(kw));
}

function isExitNotification(title: string | undefined, body: string): boolean {
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
