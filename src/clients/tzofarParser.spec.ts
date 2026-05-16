import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { parseTzofarMessage, resolveCityIds, _setTzofarCityMap } from './tzofarParser';
import { OrefCategory } from '../types';

describe('parseTzofarMessage', () => {
  it('returns empty for null/undefined message', () => {
    assert.deepStrictEqual(parseTzofarMessage(null), []);
    assert.deepStrictEqual(parseTzofarMessage(undefined), []);
    assert.deepStrictEqual(parseTzofarMessage({}), []);
  });

  it('returns empty for unknown message type', () => {
    assert.deepStrictEqual(parseTzofarMessage({ type: 'PING' }), []);
  });

  describe('ALERT messages', () => {
    it('parses rocket alert (threat 0)', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 0, cities: ['תל אביב', 'חיפה'], isDrill: false },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Rockets));
      assert.deepStrictEqual(result[0].data, ['תל אביב', 'חיפה']);
    });

    it('parses terror alert (threat 2)', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 2, cities: ['ירושלים'] },
      });
      assert.strictEqual(result[0].cat, String(OrefCategory.TerroristInfiltration));
    });

    it('parses UAV alert (threat 5)', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 5, cities: ['נהריה'] },
      });
      assert.strictEqual(result[0].cat, String(OrefCategory.UAVIntrusion));
    });

    it('parses non-conventional alert (threat 7)', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 7, cities: ['באר שבע'] },
      });
      assert.strictEqual(result[0].cat, String(OrefCategory.NonConventional));
    });

    it('ignores drill alerts', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 0, cities: ['תל אביב'], isDrill: true },
      });
      assert.strictEqual(result.length, 0);
    });

    it('ignores unknown threat ID', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 999, cities: ['תל אביב'] },
      });
      assert.strictEqual(result.length, 0);
    });

    it('ignores alert with empty cities', () => {
      const result = parseTzofarMessage({
        type: 'ALERT',
        data: { threat: 0, cities: [] },
      });
      assert.strictEqual(result.length, 0);
    });
  });

  describe('SYSTEM_MESSAGE - early warning', () => {
    it('parses early warning via instructionType=0 with cities in body', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 0,
          titleHe: 'מבזק פיקוד העורף',
          bodyHe: 'בדקות הקרובות צפויות התרעות באזורים: עוטף עזה, שפלה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Warning));
      assert.deepStrictEqual(result[0].data, ['עוטף עזה', 'שפלה']);
    });

    it('parses early warning via keyword fallback (no instructionType)', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          titleHe: 'מבזק פיקוד העורף',
          bodyHe: 'בדקות הקרובות צפויות התרעות באזורים: עוטף עזה, שפלה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Warning));
      assert.deepStrictEqual(result[0].data, ['עוטף עזה', 'שפלה']);
    });

    it('ignores early warning when no cities in body', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 0,
          titleHe: 'מבזק פיקוד העורף',
          bodyHe: 'בדקות הקרובות צפויות להתקבל התרעות',
        },
      });
      assert.strictEqual(result.length, 0);
    });

    it('ignores non-matching title when no instructionType', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          titleHe: 'הודעה כללית',
          bodyHe: 'בדקות הקרובות something',
        },
      });
      assert.strictEqual(result.length, 0);
    });

    it('instructionType=0 overrides non-matching title', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 0,
          titleHe: 'הודעה כללית',
          bodyHe: 'באזורים: עוטף עזה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Warning));
    });
  });

  describe('SYSTEM_MESSAGE - exit notification', () => {
    it('parses exit notification via instructionType=1 with cities', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 1,
          titleHe: 'עדכון פיקוד העורף',
          bodyHe: 'האירוע הסתיים באזורים: תל אביב, חיפה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
      assert.deepStrictEqual(result[0].data, ['תל אביב', 'חיפה']);
    });

    it('parses exit notification via keyword fallback (no instructionType)', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          titleHe: 'עדכון פיקוד העורף',
          bodyHe: 'האירוע הסתיים באזורים: תל אביב, חיפה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
      assert.deepStrictEqual(result[0].data, ['תל אביב', 'חיפה']);
    });

    it('ignores exit notification without cities in body', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 1,
          titleHe: 'עדכון פיקוד העורף',
          bodyHe: 'האירוע הסתיים',
        },
      });
      assert.strictEqual(result.length, 0, 'should ignore exit notification without specific cities');
    });

    it('instructionType=1 overrides non-matching title', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 1,
          titleHe: 'some other title',
          bodyHe: 'באזורים: חיפה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
    });

    it('ignores instructionType=2 (OTHER)', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 2,
          titleHe: 'הודעה כללית',
          bodyHe: 'באזורים: תל אביב',
        },
      });
      assert.strictEqual(result.length, 0);
    });
  });

  describe('SYSTEM_MESSAGE - citiesIds resolution', () => {
    const cityMap = new Map<number, string>([
      [511, 'אבו גוש'],
      [1470, 'אבו סנאן'],
      [155, 'אופקים'],
      [4, 'אילת'],
    ]);

    beforeEach(() => {
      _setTzofarCityMap(cityMap);
    });

    afterEach(() => {
      _setTzofarCityMap(null);
    });

    it('resolves citiesIds to city names for early warning', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 0,
          citiesIds: [511, 155],
          titleHe: 'מבזק פיקוד העורף',
          bodyHe: 'בדקות הקרובות צפויות התרעות',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Warning));
      assert.deepStrictEqual(result[0].data, ['אבו גוש', 'אופקים']);
    });

    it('resolves citiesIds to city names for end event', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 1,
          citiesIds: [4, 1470],
          titleHe: 'עדכון פיקוד העורף',
          bodyHe: 'האירוע הסתיים',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
      assert.deepStrictEqual(result[0].data, ['אילת', 'אבו סנאן']);
    });

    it('falls back to body text when citiesIds has unknown IDs', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 1,
          citiesIds: [9999],
          titleHe: 'עדכון פיקוד העורף',
          bodyHe: 'האירוע הסתיים באזורים: חיפה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].data, ['חיפה']);
    });

    it('prefers citiesIds over body text when both available', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          instructionType: 0,
          citiesIds: [4],
          titleHe: 'מבזק פיקוד העורף',
          bodyHe: 'בדקות הקרובות צפויות התרעות באזורים: חיפה',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].data, ['אילת']);
    });

    it('resolveCityIds returns names for known IDs', () => {
      const names = resolveCityIds([511, 4, 9999]);
      assert.deepStrictEqual(names, ['אבו גוש', 'אילת']);
    });

    it('resolveCityIds returns empty when map not loaded', () => {
      _setTzofarCityMap(null);
      const names = resolveCityIds([511, 4]);
      assert.deepStrictEqual(names, []);
    });
  });
});
