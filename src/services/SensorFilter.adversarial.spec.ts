import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { SensorFilter, ParsedAlerts, CityAlert } from './SensorFilter';
import { OrefCategory, CATEGORY_MAP } from '../types';
import { NATIONWIDE_CITY } from '../settings';

function logger() {
  return {
    info: mock.fn(), warn: mock.fn(), error: mock.fn(),
    debug: mock.fn(), log: mock.fn(), success: mock.fn(),
    easyDebug: mock.fn(), prefix: '',
  } as any;
}
function acc() {
  return {
    states: [] as any[],
    last: null as any,
    updateAlertState(s: any) {
      const snap = { isActive: s.isActive, cities: [...s.activeCities.keys()].sort() };
      this.states.push(snap); this.last = snap;
    },
  };
}
function alertOf(map: Record<string, number>): ParsedAlerts {
  const relevantCities = new Map<string, CityAlert[]>();
  for (const [c, cat] of Object.entries(map)) {
    relevantCities.set(c, [{ categoryId: cat, title: `cat${cat}` }]);
  }
  return { endedCities: new Set(), relevantCities };
}
function mixed(alerts: Record<string, number>, ended: string[]): ParsedAlerts {
  const p = alertOf(alerts);
  return { endedCities: new Set(ended), relevantCities: p.relevantCities };
}

const allCats = new Set(Object.values(CATEGORY_MAP).flat());

describe('SensorFilter adversarial — life-safety invariants', () => {
  it('city alerting AND ending in the same batch ends up ACTIVE (alert wins)', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA'], allCats, false);
    f.handleAlerts(mixed({ cityA: OrefCategory.Rockets }, ['cityA']));
    assert.strictEqual(a.last.isActive, true, 'a fresh alert must win over a simultaneous end');
    assert.deepStrictEqual(a.last.cities, ['cityA']);
  });

  it('does NOT fire when the only matching city has a disallowed category', () => {
    const a = acc();
    const rocketOnly = new Set(CATEGORY_MAP['rockets']);
    const f = new SensorFilter('s', logger(), a, ['cityA'], rocketOnly, false);
    f.handleAlerts(alertOf({ cityA: OrefCategory.UAVIntrusion }));
    assert.strictEqual(a.last.isActive, false);
  });

  it('stays active for cityA when an unrelated cityB alert arrives', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA', 'cityB'], allCats, false);
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));
    assert.deepStrictEqual(a.last.cities, ['cityA']);
    f.handleAlerts(alertOf({ unrelated: OrefCategory.Rockets }));
    assert.deepStrictEqual(a.last.cities, ['cityA'], 'cityA must remain active');
  });

  it('clears only the ended city, leaves the other active', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA', 'cityB'], allCats, false);
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets, cityB: OrefCategory.Rockets }));
    assert.deepStrictEqual(a.last.cities, ['cityA', 'cityB']);
    f.handleAlerts(mixed({}, ['cityA']));
    assert.deepStrictEqual(a.last.cities, ['cityB']);
  });

  it('broadcasts state every call (accessory always told current truth)', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA'], allCats, false);
    f.handleAlerts(alertOf({ unrelated: OrefCategory.Rockets })); // no match
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));     // match
    f.handleAlerts(mixed({}, ['cityA']));                          // ended
    assert.strictEqual(a.states.length, 3, 'every handleAlerts must broadcast');
    assert.strictEqual(a.states[0].isActive, false);
    assert.strictEqual(a.states[1].isActive, true);
    assert.strictEqual(a.states[2].isActive, false);
  });

  it('repeated identical alert keeps sensor active and fires webhook only once', async () => {
    const fired: string[] = [];
    const webhook = { fire: (p: any) => fired.push(p.event) } as any;
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA'], allCats, false, webhook);
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(a.last.isActive, true);
    assert.strictEqual(fired.filter((e) => e === 'alert').length, 1, 'alert webhook fires once for the same active city');
  });

  it('parity with legacy path: prefix_matching=true routes through the original loop and still works', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['תל אביב'], allCats, true);
    f.handleAlerts(alertOf({ 'תל אביב - יפו': OrefCategory.Rockets }));
    assert.strictEqual(a.last.isActive, true, 'prefix match must still activate via legacy loop');
    assert.deepStrictEqual(a.last.cities, ['תל אביב']);
  });

  it('nationwide alert still activates all configured cities (legacy loop)', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA', 'cityB', 'cityC'], allCats, false);
    f.handleAlerts(alertOf({ [NATIONWIDE_CITY]: OrefCategory.Rockets }));
    assert.strictEqual(a.last.cities.length, 3);
  });
});

describe('SensorFilter — extra-broadcast safety (fast path vs legacy early-return)', () => {
  it('extra broadcast of isActive=false never disturbs an already-active sensor', () => {
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA'], allCats, false);
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));   // ON
    assert.strictEqual(a.last.isActive, true);
    // irrelevant batch arrives while cityA active — must stay ON
    f.handleAlerts(alertOf({ elsewhere: OrefCategory.Rockets }));
    assert.strictEqual(a.last.isActive, true, 'active sensor must remain ON');
    assert.deepStrictEqual(a.last.cities, ['cityA']);
  });
});

describe('SensorFilter prefix_matching — one sub-area ending must not end the others', () => {
  const TLV = 'תל אביב';
  const EAST = 'תל אביב - מזרח';
  const SOUTH = 'תל אביב - דרום העיר ויפו';

  function prefixFilter(cities: string[]) {
    const a = acc();
    const fired: any[] = [];
    const f = new SensorFilter('s', logger(), a, cities, allCats, true, { fire: (p: any) => fired.push(p) });
    return { a, f, fired };
  }

  it('parent "תל אביב" stays ON while another sub-area is still under alert', () => {
    // Regression: with prefix matching both sub-areas map to the one key
    // "תל אביב", so the end of either turned the sensor (and doorbell) off.
    const { a, f } = prefixFilter([TLV]);
    f.handleAlerts(alertOf({ [EAST]: OrefCategory.Rockets, [SOUTH]: OrefCategory.Rockets }));
    assert.strictEqual(a.last.isActive, true);
    f.handleAlerts(mixed({}, [EAST]));
    assert.strictEqual(a.last.isActive, true, 'south is still under alert');
    f.handleAlerts(mixed({}, [SOUTH]));
    assert.strictEqual(a.last.isActive, false, 'off once every sub-area ended');
  });

  it('a sub-area that alerted in a later batch is tracked too', () => {
    const { a, f } = prefixFilter([TLV]);
    f.handleAlerts(alertOf({ [EAST]: OrefCategory.Rockets }));
    f.handleAlerts(alertOf({ [SOUTH]: OrefCategory.Rockets }));
    f.handleAlerts(mixed({}, [SOUTH]));
    assert.strictEqual(a.last.isActive, true);
    f.handleAlerts(mixed({}, [EAST]));
    assert.strictEqual(a.last.isActive, false);
  });

  it('an end naming the configured city itself ends it at once', () => {
    const { a, f } = prefixFilter([TLV]);
    f.handleAlerts(alertOf({ [EAST]: OrefCategory.Rockets, [SOUTH]: OrefCategory.Rockets }));
    f.handleAlerts(mixed({}, [TLV]));
    assert.strictEqual(a.last.isActive, false);
  });

  it('a configured sub-area is not ended by the end of a parent-prefix name it never alerted under', () => {
    // "אזור" is a real city and a prefix of "אזור תעשייה ..." zones.
    const { a, f } = prefixFilter(['אזור תעשייה אריאל']);
    f.handleAlerts(alertOf({ 'אזור תעשייה אריאל': OrefCategory.Rockets }));
    f.handleAlerts(mixed({}, ['אזור תעשייה אפק ולב הארץ']));
    assert.strictEqual(a.last.isActive, true, 'a sibling zone ending does not end this one');
  });

  it('nationwide end still clears everything; nationwide alert is only ended by its own city or nationwide', () => {
    const { a, f } = prefixFilter([TLV, 'חיפה']);
    f.handleAlerts(alertOf({ [NATIONWIDE_CITY]: OrefCategory.Rockets }));
    assert.deepStrictEqual(a.last.cities, ['חיפה', TLV].sort());
    f.handleAlerts(mixed({}, [EAST]));
    assert.strictEqual(a.last.isActive, true);
    f.handleAlerts(mixed({}, ['חיפה']));
    assert.deepStrictEqual(a.last.cities, [TLV]);
    f.handleAlerts(mixed({}, [NATIONWIDE_CITY]));
    assert.strictEqual(a.last.isActive, false);
  });

  it('emits exactly one ended event, when the last sub-area ends', async () => {
    const { f, fired } = prefixFilter([TLV]);
    f.handleAlerts(alertOf({ [EAST]: OrefCategory.Rockets, [SOUTH]: OrefCategory.Rockets }));
    f.handleAlerts(mixed({}, [EAST]));
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(fired.map((p) => p.event), ['alert'], 'no ended (and no doorbell change) while south is on');
    f.handleAlerts(mixed({}, [SOUTH]));
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(fired.map((p) => p.event), ['alert', 'ended']);
  });
});
