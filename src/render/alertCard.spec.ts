import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CityLocator, GENERIC_TITLE, IDLE_TITLE, buildCardModel, buildProjection, categoryStyle, chooseListLayout,
  fitText, moreLabel, readableAccent, toCardData,
} from './alertCard';
import { WebhookPayload } from '../services/WebhookService';

function payload(sensor: string, city: string, category: number | undefined, timestamp: number, title = 'Threat 0'): WebhookPayload {
  return { event: 'alert', sensor, city, title, category, timestamp };
}

function snapshotOf(...ps: WebhookPayload[]) {
  return { version: 7, active: new Map(ps.map((p) => [`${p.sensor}|${p.city}`, p])) };
}

describe('alertCard: categories', () => {
  it('derives the Hebrew title and color from the category, ignoring generic source titles', () => {
    assert.deepStrictEqual(categoryStyle(1, 'Threat 0'), { title: 'ירי רקטות וטילים', color: '#E62828' });
    assert.strictEqual(categoryStyle(6, 'x').title, 'חדירת כלי טיס עוין');
    assert.strictEqual(categoryStyle(13, 'x').title, 'חדירת מחבלים');
    assert.strictEqual(categoryStyle(10, 'x').title, 'מבזק');
  });

  it('falls back to the payload title for an unknown category', () => {
    assert.strictEqual(categoryStyle(42, 'כותרת מקור').title, 'כותרת מקור');
    assert.strictEqual(categoryStyle(undefined, 'כותרת מקור').title, 'כותרת מקור');
  });

  it('uses the generic title when the fallback is a placeholder', () => {
    assert.strictEqual(categoryStyle(42, 'Threat 3').title, GENERIC_TITLE);
    assert.strictEqual(categoryStyle(42, '').title, GENERIC_TITLE);
  });

  it('lightens only very dark accents for text', () => {
    assert.strictEqual(readableAccent('#E62828'), '#E62828');
    assert.notStrictEqual(readableAccent('#B4141E'), '#B4141E');
  });
});

describe('alertCard: toCardData / buildCardModel', () => {
  it('lists a city once even when two sensors report it, newest first', () => {
    const data = toCardData(snapshotOf(
      payload('Home', 'A', 1, 100),
      payload('Office', 'A', 1, 100),
      payload('Home', 'B', 6, 200),
    ), 12);
    assert.deepStrictEqual(data.alerts.map((a) => a.city), ['B', 'A']);
    assert.strictEqual(data.version, 7);
  });

  it('takes title and color from the most recent alert and lists other categories', () => {
    const model = buildCardModel(toCardData(snapshotOf(payload('Home', 'A', 1, 100), payload('Home', 'B', 6, 200)), 12));
    assert.strictEqual(model.kind, 'alert');
    assert.strictEqual(model.title, 'חדירת כלי טיס עוין');
    assert.strictEqual(model.subtitle, 'ירי רקטות וטילים');
    assert.deepStrictEqual(model.cities.map((c) => c.color), ['#F58C14', '#E62828'], 'each dot keeps its own color');
    assert.match(model.time!, /^\d\d:\d\d:\d\d$/);
  });

  it('formats the time in Asia/Jerusalem', () => {
    const model = buildCardModel(toCardData(snapshotOf(payload('Home', 'A', 1, Date.UTC(2026, 0, 1, 10, 0, 5))), 12));
    assert.strictEqual(model.time, '12:00:05');
  });

  it('builds the generic card, with no cities or time, when there are no alerts', () => {
    const model = buildCardModel({ version: 1, alerts: [], maxCities: 12 });
    assert.strictEqual(model.kind, 'generic');
    assert.strictEqual(model.title, GENERIC_TITLE);
    assert.strictEqual(model.time, null);
  });

  it('builds the "no active alerts" card', () => {
    const model = buildCardModel({ version: 0, alerts: [], maxCities: 12, idle: true });
    assert.strictEqual(model.kind, 'idle');
    assert.strictEqual(model.title, IDLE_TITLE);
    assert.deepStrictEqual([model.cities, model.time], [[], null]);
  });
});

describe('alertCard: city list layout', () => {
  it('shows everything in one column when it fits', () => {
    const l = chooseListLayout(3, 12);
    assert.deepStrictEqual([l.columns, l.shown, l.more, l.fontSize], [1, 3, 0, 50]);
  });

  it('caps at maxCities and keeps a slot for "ועוד N"', () => {
    const l = chooseListLayout(20, 12);
    assert.strictEqual(l.shown, 12);
    assert.strictEqual(l.more, 8);
    assert.ok(l.rows * l.columns >= 13, 'room for the extra line');
    assert.strictEqual(moreLabel(l.more), 'ועוד 8');
  });

  it('fits the configured maximum of 20 without dropping any', () => {
    const l = chooseListLayout(20, 20);
    assert.strictEqual(l.shown, 20);
    assert.strictEqual(l.more, 0);
  });

  it('never shows more than the layout can hold', () => {
    const l = chooseListLayout(500, 100);
    assert.ok(l.shown + 1 <= l.rows * l.columns);
    assert.strictEqual(l.shown + l.more, 500);
  });
});

describe('alertCard: fitText', () => {
  const measure = (text: string, size: number) => [...text].length * size * 0.5;

  it('keeps text that fits', () => {
    assert.deepStrictEqual(fitText(measure, 'abcd', 50, 40, 1000), { text: 'abcd', size: 50 });
  });

  it('shrinks within the minimum size', () => {
    const r = fitText(measure, 'a'.repeat(10), 50, 40, 225); // 250 wide at 50px
    assert.strictEqual(r.text, 'a'.repeat(10));
    assert.ok(r.size >= 40 && r.size < 50);
    assert.ok(measure(r.text, r.size) <= 225);
  });

  it('ellipsizes at the minimum size when shrinking is not enough', () => {
    const r = fitText(measure, 'תל אביב - דרום העיר ויפו', 50, 40, 200);
    assert.strictEqual(r.size, 40);
    assert.ok(r.text.endsWith('…'));
    assert.ok(measure(r.text, r.size) <= 200);
  });
});

describe('alertCard: map', () => {
  const points = [
    { name: 'צפון', lat: 33, lng: 35.5 },
    { name: 'דרום', lat: 29.5, lng: 34.9 },
    { name: 'תל אביב - דרום העיר ויפו', lat: 32.05, lng: 34.76 },
  ];

  it('projects north to the top and keeps the map left of the panel', () => {
    const p = buildProjection(points);
    const [, yNorth] = p.project(33, 35.5);
    const [, ySouth] = p.project(29.5, 34.9);
    assert.ok(yNorth < ySouth);
    assert.ok(p.right > 40 && p.right < 400);
  });

  it('finds exact names and falls back to the first name with that prefix', () => {
    const loc = new CityLocator(points);
    assert.strictEqual(loc.find('צפון')?.name, 'צפון');
    assert.strictEqual(loc.find('תל אביב')?.name, 'תל אביב - דרום העיר ויפו');
    assert.strictEqual(loc.find('לא קיים'), null);
    assert.strictEqual(loc.find('לא קיים'), null, 'misses are cached');
  });
});
