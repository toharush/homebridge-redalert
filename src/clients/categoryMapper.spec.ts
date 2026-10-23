import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeAlerts, DEFAULT_RESPONSE_FORMAT } from './categoryMapper';
import { OrefCategory, EVENT_ENDED_TITLE } from '../types';

// The Mako marketplace preset (homebridge-ui) — a mirror of Pikud HaOref's alerts.json.
const MAKO_MAPPING = {
  '1': 'rockets', '2': 'nonconventional', '3': 'earthquake', '4': 'cbrne', '5': 'tsunami',
  '6': 'uav', '7': 'hazmat', '8': 'warning', '10': 'warning', '13': 'terror',
} as const;

const ENDED = String(OrefCategory.EventEnded);

describe('normalizeAlerts — event ended', () => {
  it('turns an Oref-format "event ended" (cat 10) into Event Ended, not a warning', () => {
    // Regression: "10" → warning made the end of an event switch sensors ON again.
    const out = normalizeAlerts(
      [{ id: '1', cat: '10', title: EVENT_ENDED_TITLE, data: ['חיפה'], desc: '' }],
      { ...MAKO_MAPPING }, DEFAULT_RESPONSE_FORMAT,
    );
    assert.deepStrictEqual(out.map((a) => [a.cat, a.data]), [[ENDED, ['חיפה']]]);
  });

  it('recognises the end title even when the source category is not mapped', () => {
    // The config UI cannot map anything to "eventended", so the title is the only signal it can rely on.
    const out = normalizeAlerts(
      [{ id: '2', cat: '99', title: EVENT_ENDED_TITLE, data: ['חיפה'], desc: '' }],
      { '1': 'rockets' }, DEFAULT_RESPONSE_FORMAT,
    );
    assert.deepStrictEqual(out.map((a) => a.cat), [ENDED]);
  });

  it('honours a custom title field', () => {
    const out = normalizeAlerts(
      [{ type: 'X', name: EVENT_ENDED_TITLE, places: ['חיפה'] }],
      {}, { ...DEFAULT_RESPONSE_FORMAT, category_field: 'type', title_field: 'name', cities_field: 'places' },
    );
    assert.deepStrictEqual(out.map((a) => [a.cat, a.data]), [[ENDED, ['חיפה']]]);
  });

  it('keeps mapping a genuine heads-up notice (cat 10, other title) to warning', () => {
    const out = normalizeAlerts(
      [{ id: '3', cat: '10', title: 'בדקות הקרובות צפויות להתקבל התרעות באזורך', data: ['חיפה'], desc: '' }],
      { ...MAKO_MAPPING }, DEFAULT_RESPONSE_FORMAT,
    );
    assert.deepStrictEqual(out.map((a) => a.cat), [String(OrefCategory.Warning)]);
  });

  it('still drops unmapped, non-ended alerts', () => {
    assert.deepStrictEqual(
      normalizeAlerts([{ id: '4', cat: '42', title: 'x', data: ['חיפה'], desc: '' }], { '1': 'rockets' }, DEFAULT_RESPONSE_FORMAT),
      [],
    );
  });
});
