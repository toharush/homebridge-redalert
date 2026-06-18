import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { SensorFilter, ParsedAlerts, CityAlert } from './SensorFilter';
import { OrefCategory, CATEGORY_MAP } from '../types';
import { NATIONWIDE_CITY } from '../settings';

function createLogger() {
  return {
    info: mock.fn(), warn: mock.fn(), error: mock.fn(),
    debug: mock.fn(), log: mock.fn(), success: mock.fn(),
    easyDebug: mock.fn(), prefix: '',
  } as any;
}

function createAccessory() {
  return {
    lastState: null as any,
    updateAlertState(state: any) {
      this.lastState = { isActive: state.isActive, cities: [...state.activeCities.keys()] };
    },
  };
}

function rocketIn(...cities: string[]): ParsedAlerts {
  const relevantCities = new Map<string, CityAlert[]>();
  for (const c of cities) {
    relevantCities.set(c, [{ categoryId: OrefCategory.Rockets, title: 'Rockets' }]);
  }
  return { endedCities: new Set(), relevantCities };
}

function endedIn(...cities: string[]): ParsedAlerts {
  return { endedCities: new Set(cities), relevantCities: new Map() };
}

// A "wide" sensor monitoring many cities — the case the optimization targets.
const WIDE = Array.from({ length: 200 }, (_, i) => `city-${i}`);

describe('SensorFilter — wide sensor correctness (optimization guard)', () => {
  const allCats = new Set(Object.values(CATEGORY_MAP).flat());

  it('activates exactly the alerting subset of a wide configured set', () => {
    const acc = createAccessory();
    const f = new SensorFilter('wide', createLogger(), acc, WIDE, allCats, false);

    f.handleAlerts(rocketIn('city-5', 'city-150'));

    assert.strictEqual(acc.lastState.isActive, true);
    assert.deepStrictEqual(acc.lastState.cities.sort(), ['city-150', 'city-5']);
  });

  it('ignores alert cities that are not in the configured set', () => {
    const acc = createAccessory();
    const f = new SensorFilter('wide', createLogger(), acc, WIDE, allCats, false);

    f.handleAlerts(rocketIn('not-monitored', 'city-7'));

    assert.deepStrictEqual(acc.lastState.cities, ['city-7']);
  });

  it('clears the alerting subset on Event Ended', () => {
    const acc = createAccessory();
    const f = new SensorFilter('wide', createLogger(), acc, WIDE, allCats, false);

    f.handleAlerts(rocketIn('city-5', 'city-150'));
    f.handleAlerts(endedIn('city-5'));

    assert.deepStrictEqual(acc.lastState.cities, ['city-150']);
  });

  it('nationwide alert activates all configured cities', () => {
    const acc = createAccessory();
    const f = new SensorFilter('wide', createLogger(), acc, WIDE, allCats, false);

    f.handleAlerts(rocketIn(NATIONWIDE_CITY));

    assert.strictEqual(acc.lastState.isActive, true);
    assert.strictEqual(acc.lastState.cities.length, WIDE.length);
  });

  it('nationwide Event Ended clears everything', () => {
    const acc = createAccessory();
    const f = new SensorFilter('wide', createLogger(), acc, WIDE, allCats, false);

    f.handleAlerts(rocketIn(NATIONWIDE_CITY));
    f.handleAlerts(endedIn(NATIONWIDE_CITY));

    assert.strictEqual(acc.lastState.isActive, false);
    assert.strictEqual(acc.lastState.cities.length, 0);
  });

  it('category filter still applies (disallowed category does not activate)', () => {
    const acc = createAccessory();
    const rocketOnly = new Set(CATEGORY_MAP['rockets']);
    const f = new SensorFilter('wide', createLogger(), acc, WIDE, rocketOnly, false);

    const uavAlert: ParsedAlerts = {
      endedCities: new Set(),
      relevantCities: new Map([['city-5', [{ categoryId: OrefCategory.UAVIntrusion, title: 'UAV' }]]]),
    };
    f.handleAlerts(uavAlert);

    assert.strictEqual(acc.lastState.isActive, false);
  });
});
