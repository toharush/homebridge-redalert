import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCityIndex, parseTelegramMessage } from './telegramParser';
import { OrefCategory } from '../types';

describe('buildCityIndex', () => {
  it('sorts city names by length descending', () => {
    const result = buildCityIndex(['ab', 'abcd', 'a', 'abc']);
    assert.deepStrictEqual(result, ['abcd', 'abc', 'ab', 'a']);
  });

  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(buildCityIndex([]), []);
  });

  it('handles cities of equal length (stable order)', () => {
    const result = buildCityIndex(['aa', 'bb', 'cc']);
    assert.strictEqual(result.length, 3);
    // All have length 2, order should be stable
    assert.deepStrictEqual(result, ['aa', 'bb', 'cc']);
  });
});

describe('parseTelegramMessage', () => {
  const cityList = buildCityIndex([
    'מרגליות',
    'מנרה',
    'תל אביב - מזרח',
    'תל אביב',
    'חיפה',
    'באר שבע',
    'קו העימות - מרגליות, מנרה',
  ]);

  describe('category detection', () => {
    it('detects rockets from "צבע אדום"', () => {
      const text = 'צבע אדום במרגליות [10:03]:\n\n17/05/2026 10:03:54:\n • מרגליות';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Rockets));
    });

    it('detects UAV intrusion from "חדירת כלי טיס"', () => {
      const text = 'חדירת כלי טיס במרגליות [10:03]:\n\n17/05/2026 10:03:54:\n • מרגליות';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.UAVIntrusion));
    });

    it('detects terrorist infiltration from "חדירת מחבלים"', () => {
      const text = 'חדירת מחבלים בחיפה [10:03]:\n\n17/05/2026 10:03:54:\n • חיפה';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.TerroristInfiltration));
    });

    it('uses fallback category when no keyword matches', () => {
      const text = 'רעידת אדמה בחיפה [10:03]:\n\n17/05/2026 10:03:54:\n • חיפה';
      const result = parseTelegramMessage(text, 'earthquake', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Earthquake));
    });

    it('uses fallback "uav" category string', () => {
      const text = 'unknown alert type בחיפה [10:03]:\n\n • חיפה';
      const result = parseTelegramMessage(text, 'uav', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.UAVIntrusion));
    });

    it('uses fallback "terror" category string', () => {
      const text = 'unknown בחיפה [10:03]:\n\n • חיפה';
      const result = parseTelegramMessage(text, 'terror', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.TerroristInfiltration));
    });
  });

  describe('city extraction', () => {
    it('extracts single city', () => {
      const text = 'צבע אדום בחיפה [10:03]:\n\n17/05/2026 10:03:54:\n • חיפה';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].data.includes('חיפה'));
    });

    it('extracts multiple cities', () => {
      const text = 'צבע אדום במרגליות, מנרה [10:03]:\n\n17/05/2026 10:03:54:\n • מרגליות\n • מנרה';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].data.includes('מרגליות'));
      assert.ok(result[0].data.includes('מנרה'));
    });

    it('deduplicates cities', () => {
      const text = 'צבע אדום במרגליות [10:03]:\n\n • מרגליות\n • מרגליות';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      // "מרגליות" should appear only once
      const count = result[0].data.filter((c: string) => c === 'מרגליות').length;
      assert.strictEqual(count, 1);
    });

    it('matches longest city name first to avoid partial matches', () => {
      const text = 'צבע אדום [10:03]:\n\n • תל אביב - מזרח';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].data.includes('תל אביב - מזרח'));
      // "תל אביב" should NOT be separately matched because the text was consumed
      assert.ok(!result[0].data.includes('תל אביב'));
    });

    it('returns empty array when no cities found', () => {
      const text = 'צבע אדום [10:03]:\n\nsome random text with no known cities';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('title extraction', () => {
    it('extracts title before [ bracket from first line', () => {
      const text = 'צבע אדום במרגליות, מנרה [10:03]:\n\n • מרגליות';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result[0].title, 'צבע אדום במרגליות, מנרה');
    });

    it('uses full first line when no bracket found', () => {
      const text = 'צבע אדום במרגליות\n\n • מרגליות';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result[0].title, 'צבע אדום במרגליות');
    });
  });

  describe('full Kumta message format', () => {
    it('parses a full Kumta rocket alert', () => {
      const text = [
        'צבע אדום במרגליות, מנרה [10:03]:',
        '',
        '17/05/2026 10:03:54:',
        ' • קו העימות - מרגליות, מנרה',
        '',
        '|| מועצות אזוריות: מבואות החרמון, הגליל העליון ||',
        '',
        'נשלח באמצעות @CumtaAlertsChannel',
      ].join('\n');

      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.Rockets));
      assert.strictEqual(result[0].title, 'צבע אדום במרגליות, מנרה');
      // Should find cities from the text
      assert.ok(result[0].data.length > 0);
      assert.ok(result[0].data.includes('מרגליות'));
      assert.ok(result[0].data.includes('מנרה'));
    });

    it('parses a full Kumta UAV alert', () => {
      const text = [
        'חדירת כלי טיס במרגליות, מנרה [10:03]:',
        '',
        '17/05/2026 10:03:54:',
        ' • קו העימות - מרגליות, מנרה',
      ].join('\n');

      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].cat, String(OrefCategory.UAVIntrusion));
      assert.strictEqual(result[0].title, 'חדירת כלי טיס במרגליות, מנרה');
      assert.ok(result[0].data.includes('מרגליות'));
      assert.ok(result[0].data.includes('מנרה'));
    });
  });

  describe('edge cases', () => {
    it('handles empty text', () => {
      assert.deepStrictEqual(parseTelegramMessage('', 'rockets', cityList), []);
    });

    it('handles text with only whitespace', () => {
      assert.deepStrictEqual(parseTelegramMessage('   \n\n  ', 'rockets', cityList), []);
    });

    it('handles empty city list', () => {
      const text = 'צבע אדום במרגליות [10:03]:\n\n • מרגליות';
      assert.deepStrictEqual(parseTelegramMessage(text, 'rockets', []), []);
    });

    it('generates a unique id prefixed with telegram-', () => {
      const text = 'צבע אדום בחיפה [10:03]:\n\n • חיפה';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.ok(result[0].id.startsWith('telegram-'));
    });

    it('sets desc to empty string', () => {
      const text = 'צבע אדום בחיפה [10:03]:\n\n • חיפה';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result[0].desc, '');
    });

    it('falls back to rockets (fallback) for unknown category key', () => {
      const text = 'unknown alert בחיפה [10:03]:\n\n • חיפה';
      const result = parseTelegramMessage(text, 'rockets', cityList);
      assert.strictEqual(result[0].cat, String(OrefCategory.Rockets));
    });
  });
});
