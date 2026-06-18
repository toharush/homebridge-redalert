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

  it('repeated identical alert keeps sensor active and fires webhook only once', () => {
    const fired: string[] = [];
    const webhook = { fire: (p: any) => fired.push(p.event) } as any;
    const a = acc();
    const f = new SensorFilter('s', logger(), a, ['cityA'], allCats, false, webhook);
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));
    f.handleAlerts(alertOf({ cityA: OrefCategory.Rockets }));
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
