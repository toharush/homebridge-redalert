import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseTzofarMessage } from './tzofarParser';
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
    it('parses early warning with cities in body', () => {
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

    it('falls back to nationwide when no cities in body', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          titleHe: 'מבזק פיקוד העורף',
          bodyHe: 'בדקות הקרובות צפויות להתקבל התרעות',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].data, ['רחבי הארץ']);
    });

    it('ignores non-matching title', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          titleHe: 'הודעה כללית',
          bodyHe: 'בדקות הקרובות something',
        },
      });
      assert.strictEqual(result.length, 0);
    });
  });

  describe('SYSTEM_MESSAGE - exit notification', () => {
    it('parses exit notification with cities', () => {
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

    it('falls back to nationwide when no cities in body', () => {
      const result = parseTzofarMessage({
        type: 'SYSTEM_MESSAGE',
        data: {
          titleHe: 'עדכון פיקוד העורף',
          bodyHe: 'האירוע הסתיים',
        },
      });
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].data, ['רחבי הארץ']);
    });
  });
});
