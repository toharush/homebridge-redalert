import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { OrefCategory, CATEGORY_MAP, getCategoryName, OrefRealtimeAlert, AlertState, EVENT_ENDED_TITLE } from '../types';
import { AlertClient } from '../clients/orefClient';
import { AlertService } from './AlertService';
import { SensorFilter, AlertAccessory } from './SensorFilter';
import { DEFAULT_POLLING_INTERVAL, DEFAULT_ALERT_TIMEOUT } from '../settings';

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    prefix: '',
    easyDebug: mock.fn(),
  } as any;
}

function createMockClient(alerts: OrefRealtimeAlert[] = []): AlertClient {
  return {
    fetchAlerts: mock.fn(() => Promise.resolve(alerts)),
  };
}

function createMockAccessory(): AlertAccessory & { lastState: AlertState | null } {
  return {
    lastState: null,
    updateAlertState(state: AlertState) {
      this.lastState = { ...state, activeCities: new Map(state.activeCities) };
    },
  };
}

function allCategoryIds(): Set<number> {
  const ids = new Set<number>();
  for (const arr of Object.values(CATEGORY_MAP)) {
    for (const id of arr) {
      ids.add(id);
    }
  }
  return ids;
}

function makeAlert(cat: OrefCategory, cities: string[]): OrefRealtimeAlert {
  return {
    id: '134180679120000000',
    cat: String(cat),
    title: 'test alert',
    data: cities,
    desc: 'היכנסו מייד למרחב המוגן',
  };
}

function makeEventEnded(cities: string[]): OrefRealtimeAlert {
  return {
    id: '134180724020000000',
    cat: String(OrefCategory.HeadsUpNotice),
    title: EVENT_ENDED_TITLE,
    data: cities,
    desc: 'השוהים במרחב המוגן יכולים לצאת.',
  };
}

function makeHeadsUpNotice(cities: string[]): OrefRealtimeAlert {
  return {
    id: '134181295300000000',
    cat: String(OrefCategory.HeadsUpNotice),
    title: 'בדקות הקרובות צפויות להתקבל התרעות באזורך',
    data: cities,
    desc: 'על תושבי האזורים הבאים לשפר את המיקום למיגון המיטבי בקרבתך.',
  };
}

function createFilter(
  log: any,
  accessory: AlertAccessory,
  cities: string[],
  categories: Set<number>,
  alertTimeout: number = DEFAULT_ALERT_TIMEOUT,
  prefixMatching: boolean = false,
): SensorFilter {
  return new SensorFilter('Test Sensor', log, accessory, cities, categories, alertTimeout, prefixMatching);
}

// Feed alerts directly to a SensorFilter
function feedAlerts(filter: SensorFilter, alerts: OrefRealtimeAlert[]): void {
  filter.handleAlerts(alerts);
}

describe('SensorFilter', () => {
  const cities = ['תל אביב', 'חיפה'];
  let log: any;
  let filter: SensorFilter;
  let accessory: ReturnType<typeof createMockAccessory>;

  beforeEach(() => {
    log = createMockLogger();
    accessory = createMockAccessory();
    filter = createFilter(log, accessory, cities, allCategoryIds());
  });

  it('should broadcast active state for matching city', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should broadcast active when matching city is in array with others', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['באר שבע', 'חיפה', 'אשדוד'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should stay active when realtime alerts clear (no EventEnded)', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, []);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should deactivate when EventEnded received for city', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should stay active if EventEnded only for some cities', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);

    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(filter, [makeEventEnded(['חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not be active for cities not in config', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['באר שבע'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not be active for event-ended without prior alert', () => {
    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should filter by allowed categories', () => {
    const rocketsOnly = createFilter(log, accessory, cities, new Set(CATEGORY_MAP['rockets']));

    feedAlerts(rocketsOnly, [makeAlert(OrefCategory.TerroristInfiltration, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    feedAlerts(rocketsOnly, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should not duplicate cities on repeated alerts', () => {
    const alert = makeAlert(OrefCategory.Rockets, ['תל אביב']);
    feedAlerts(filter, [alert]);
    feedAlerts(filter, [alert]);
    feedAlerts(filter, [alert]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
  });

  it('should reset timeout on repeated alerts for same city', () => {
    const shortFilter = createFilter(log, accessory, cities, allCategoryIds(), 100);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Simulate time passing close to timeout, then new alert resets it
    const activeCities = (shortFilter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 90); // 90ms ago, almost expired at 100ms

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    // Timestamp should be reset to now, so it should NOT expire
    const timestamp = activeCities.get('תל אביב')!;
    assert.ok(Date.now() - timestamp < 50);
  });

  it('should skip alerts with invalid category', () => {
    const badAlert = { id: '1', cat: 'invalid', title: 'bad', data: ['תל אביב'], desc: '' };
    feedAlerts(filter, [badAlert]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should trigger on heads-up notice (cat 10 with non-EventEnded title)', () => {
    feedAlerts(filter, [makeHeadsUpNotice(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should NOT treat heads-up notice as event ended', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Heads-up notice is cat 10 but should NOT clear the active alert
    feedAlerts(filter, [makeHeadsUpNotice(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should only treat cat 10 as event ended when title matches', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should clear sub-area alert when event ended for parent city (prefix matching)', () => {
    const prefixFilter = createFilter(log, accessory, ['פתח תקווה'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['פתח תקווה - מזרח'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(prefixFilter, [makeEventEnded(['פתח תקווה'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should clear parent alert when event ended for sub-area (prefix matching)', () => {
    const prefixFilter = createFilter(log, accessory, ['פתח תקווה - מזרח'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['פתח תקווה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(prefixFilter, [makeEventEnded(['פתח תקווה - מזרח'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should NOT prefix match event ended when prefix matching is disabled', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(filter, [makeEventEnded(['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should NOT prefix match when disabled', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should prefix match sub-areas when enabled', () => {
    const prefixFilter = createFilter(log, accessory, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should prefix match when configured city is more specific', () => {
    const prefixFilter = createFilter(
      log, accessory, ['תל אביב - דרום העיר ויפו'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should allow re-trigger after event ended for same city', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  // --- Critical safety edge cases ---

  it('should stay active when event ended arrives for DIFFERENT city', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, [makeEventEnded(['חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));
  });

  it('should handle simultaneous alerts and event ended in same batch', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, [
      makeAlert(OrefCategory.Rockets, ['חיפה']),
      makeEventEnded(['תל אביב']),
    ]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(!accessory.lastState!.activeCities.has('תל אביב'));
    assert.ok(accessory.lastState!.activeCities.has('חיפה'));
  });

  it('should handle multiple different category alerts for same city', () => {
    feedAlerts(filter, [
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
      makeAlert(OrefCategory.UAVIntrusion, ['תל אביב']),
    ]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
  });

  it('should stay active after event ended if new alert arrives in same batch', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, [
      makeEventEnded(['תל אביב']),
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
    ]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should handle alert with empty data array', () => {
    const emptyAlert = { id: '1', cat: '1', title: 'test', data: [] as string[], desc: '' };
    feedAlerts(filter, [emptyAlert]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should ignore category 0', () => {
    const zeroAlert = { id: '1', cat: '0', title: 'test', data: ['תל אביב'], desc: '' };
    feedAlerts(filter, [zeroAlert]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should ignore negative category', () => {
    const negAlert = { id: '1', cat: '-1', title: 'test', data: ['תל אביב'], desc: '' };
    feedAlerts(filter, [negAlert]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should expire stale alerts after timeout', () => {
    const shortFilter = createFilter(log, accessory, cities, allCategoryIds(), 50);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Simulate time past timeout
    const activeCities = (shortFilter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 100);

    feedAlerts(shortFilter, []);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should NOT expire alerts that are within timeout', () => {
    const shortFilter = createFilter(log, accessory, cities, allCategoryIds(), 5000);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(shortFilter, []);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should handle rapid alert-end-alert-end cycles', () => {
    for (let i = 0; i < 5; i++) {
      feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
      assert.strictEqual(accessory.lastState!.isActive, true, `cycle ${i}: should be active`);

      feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
      assert.strictEqual(accessory.lastState!.isActive, false, `cycle ${i}: should be inactive`);
    }
  });

  it('should track multiple cities independently', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);

    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('חיפה'));
    assert.ok(!accessory.lastState!.activeCities.has('תל אביב'));
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should not clear active alert when receiving unrelated event ended', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(filter, [makeEventEnded(['באר שבע'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));
  });

  it('should release one city at a time when alerts fire in multiple places', () => {
    const multiFilter = createFilter(log, accessory, ['תל אביב', 'חיפה', 'באר שבע'], allCategoryIds());

    // Alerts in all 3 cities
    feedAlerts(multiFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה', 'באר שבע'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 3);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended only for תל אביב
    feedAlerts(multiFilter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);
    assert.ok(!accessory.lastState!.activeCities.has('תל אביב'));
    assert.ok(accessory.lastState!.activeCities.has('חיפה'));
    assert.ok(accessory.lastState!.activeCities.has('באר שבע'));
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for חיפה
    feedAlerts(multiFilter, [makeEventEnded(['חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('באר שבע'));
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for באר שבע — all clear
    feedAlerts(multiFilter, [makeEventEnded(['באר שבע'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 0);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle two sensors - notice sensor and alert sensor independently', () => {
    const noticeSensor = createMockAccessory();
    const alertSensor = createMockAccessory();
    const noticeFilter = createFilter(log, noticeSensor, ['תל אביב'], new Set(CATEGORY_MAP['warning']));
    const alertFilter = createFilter(log, alertSensor, ['תל אביב'], new Set(CATEGORY_MAP['rockets']));

    // Heads-up notice arrives — only notice sensor triggers
    const notice = [makeHeadsUpNotice(['תל אביב'])];
    noticeFilter.handleAlerts(notice);
    alertFilter.handleAlerts(notice);
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(alertSensor.lastState!.isActive, false);

    // Rocket alert arrives — alert sensor triggers too, notice stays on
    const rocket = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    noticeFilter.handleAlerts(rocket);
    alertFilter.handleAlerts(rocket);
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(alertSensor.lastState!.isActive, true);

    // Event ended — both clear
    const ended = [makeEventEnded(['תל אביב'])];
    noticeFilter.handleAlerts(ended);
    alertFilter.handleAlerts(ended);
    assert.strictEqual(noticeSensor.lastState!.isActive, false);
    assert.strictEqual(alertSensor.lastState!.isActive, false);
  });

  it('should release notice sensor without affecting alert sensor', () => {
    const noticeSensor = createMockAccessory();
    const alertSensor = createMockAccessory();
    const noticeFilter = createFilter(log, noticeSensor, ['תל אביב'], new Set(CATEGORY_MAP['warning']));
    const alertFilter = createFilter(log, alertSensor, ['תל אביב'], new Set(CATEGORY_MAP['rockets']));

    // Both get triggered
    const batch = [
      makeHeadsUpNotice(['תל אביב']),
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
    ];
    noticeFilter.handleAlerts(batch);
    alertFilter.handleAlerts(batch);
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(alertSensor.lastState!.isActive, true);

    // Event ended for תל אביב — both release since it's the same city
    const ended = [makeEventEnded(['תל אביב'])];
    noticeFilter.handleAlerts(ended);
    alertFilter.handleAlerts(ended);
    assert.strictEqual(noticeSensor.lastState!.isActive, false);
    assert.strictEqual(alertSensor.lastState!.isActive, false);
  });

  it('should clear all sub-area alerts when event ended for parent (prefix matching)', () => {
    const prefixFilter = createFilter(log, accessory, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    // Alerts for two different sub-areas
    feedAlerts(prefixFilter, [
      makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח']),
      makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו']),
    ]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for parent "תל אביב" — should clear the configured "תל אביב"
    feedAlerts(prefixFilter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle event ended arriving before alert in same batch', () => {
    feedAlerts(filter, [
      makeEventEnded(['תל אביב']),
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
    ]);
    // Event ended processed first but no active alert to clear, then alert activates
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should handle duplicate cities in alert data array', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'תל אביב', 'תל אביב'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should handle multiple event ended for same city (idempotent)', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    // Second event ended for same city — should not crash or change state
    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not trigger sensor with empty cities config', () => {
    const emptyFilter = createFilter(log, accessory, [], allCategoryIds());
    feedAlerts(emptyFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה', 'באר שבע'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should expire one city while another stays active', () => {
    const shortFilter = createFilter(log, accessory, ['תל אביב', 'חיפה'], allCategoryIds(), 100);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);

    // Manually age תל אביב past timeout
    const activeCities = (shortFilter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);

    // New alert for חיפה — triggers expiry check, תל אביב expires but חיפה stays
    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(!accessory.lastState!.activeCities.has('תל אביב'));
    assert.ok(accessory.lastState!.activeCities.has('חיפה'));
  });

  it('should isolate prefix matching between sensors', () => {
    const prefixSensor = createMockAccessory();
    const exactSensor = createMockAccessory();
    const prefixFilter = createFilter(log, prefixSensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);
    const exactFilter = createFilter(log, exactSensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false);

    const subAreaAlert = [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])];
    prefixFilter.handleAlerts(subAreaAlert);
    exactFilter.handleAlerts(subAreaAlert);

    // Prefix sensor matches, exact sensor does not
    assert.strictEqual(prefixSensor.lastState!.isActive, true);
    assert.strictEqual(exactSensor.lastState!.isActive, false);
  });

  it('should prefer exact match over prefix match', () => {
    const prefixFilter = createFilter(
      log, accessory, ['תל אביב - מזרח', 'תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    // Should match the exact "תל אביב - מזרח", not the prefix "תל אביב"
    assert.ok(accessory.lastState!.activeCities.has('תל אביב - מזרח'));
  });

  it('should not match substring that is not a prefix', () => {
    const prefixFilter = createFilter(log, accessory, ['אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    // "אביב" is NOT a prefix of "תל אביב" — should not match
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should match multiple configured prefixes independently', () => {
    const prefixFilter = createFilter(
      log, accessory, ['תל אביב', 'באר שבע'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח', 'באר שבע - דרום'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));
    assert.ok(accessory.lastState!.activeCities.has('באר שבע'));

    // Event ended for one parent only
    feedAlerts(prefixFilter, [makeEventEnded(['תל אביב - מזרח'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(!accessory.lastState!.activeCities.has('תל אביב'));
    assert.ok(accessory.lastState!.activeCities.has('באר שבע'));
  });

  it('should not prefix match when alert city shares no prefix with configured', () => {
    const prefixFilter = createFilter(log, accessory, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל מונד'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle prefix matching with event ended for exact sub-area after parent alert', () => {
    const prefixFilter = createFilter(log, accessory, ['חיפה'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    // Alert comes for parent
    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for a sub-area — matches via prefix
    feedAlerts(prefixFilter, [makeEventEnded(['חיפה - כרמל ועיר תחתית'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle prefix matching with multiple sub-area alerts then single parent event ended', () => {
    const prefixFilter = createFilter(log, accessory, ['באר שבע'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    // Multiple sub-area alerts — all map to the configured "באר שבע"
    feedAlerts(prefixFilter, [
      makeAlert(OrefCategory.Rockets, ['באר שבע - צפון']),
      makeAlert(OrefCategory.Rockets, ['באר שבע - דרום']),
      makeAlert(OrefCategory.Rockets, ['באר שבע - מזרח']),
    ]);
    // All resolve to same configured city
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('באר שבע'));

    // Single parent event ended clears it
    feedAlerts(prefixFilter, [makeEventEnded(['באר שבע'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not cross-match prefixes between unrelated cities', () => {
    const prefixFilter = createFilter(
      log, accessory, ['כפר סבא', 'כפר יונה'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['כפר סבא'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('כפר סבא'));
    assert.ok(!accessory.lastState!.activeCities.has('כפר יונה'));
  });

  it('should handle prefix event ended that does not match any active city', () => {
    const prefixFilter = createFilter(log, accessory, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for unrelated city
    feedAlerts(prefixFilter, [makeEventEnded(['חיפה - כרמל'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));
  });

  it('should re-trigger after prefix event ended and new prefix alert', () => {
    const prefixFilter = createFilter(log, accessory, ['אשדוד'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['אשדוד - א,ב,ד,ה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(prefixFilter, [makeEventEnded(['אשדוד'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    // New alert for different sub-area
    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['אשדוד - ג,ו,ז'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should clear each sub-area individually with matching event ended (prefix)', () => {
    // User configured specific sub-areas, not the parent
    const prefixFilter = createFilter(
      log, accessory, ['תל אביב - מזרח', 'תל אביב - דרום העיר ויפו'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])]);
    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);

    // Event ended per sub-area clears each independently
    feedAlerts(prefixFilter, [makeEventEnded(['תל אביב - מזרח'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב - דרום העיר ויפו'));

    feedAlerts(prefixFilter, [makeEventEnded(['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should clear alerts via event ended even when sensor only monitors rockets', () => {
    const rocketsOnly = createFilter(log, accessory, ['תל אביב'], new Set(CATEGORY_MAP['rockets']));

    feedAlerts(rocketsOnly, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended is cat 10 (HeadsUpNotice) — sensor only monitors rockets but should still clear
    feedAlerts(rocketsOnly, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle batch event ended for multiple cities at once', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);

    // Single event ended message with both cities
    feedAlerts(filter, [makeEventEnded(['תל אביב', 'חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
    assert.strictEqual(accessory.lastState!.activeCities.size, 0);
  });

  it('should handle alert with mix of matching and non-matching cities', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['באר שבע', 'תל אביב', 'אשדוד', 'חיפה', 'נתניה'])]);
    // Only תל אביב and חיפה are in the config
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));
    assert.ok(accessory.lastState!.activeCities.has('חיפה'));
  });

  it('should handle empty string in alert data array', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['', 'תל אביב', ''])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));
  });

  it('should handle two sensors on same city triggering and clearing independently', () => {
    const sensor1 = createMockAccessory();
    const sensor2 = createMockAccessory();
    const filter1 = createFilter(log, sensor1, ['תל אביב'], new Set(CATEGORY_MAP['rockets']));
    const filter2 = createFilter(log, sensor2, ['תל אביב'], new Set(CATEGORY_MAP['rockets']));

    const alert = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    filter1.handleAlerts(alert);
    filter2.handleAlerts(alert);
    assert.strictEqual(sensor1.lastState!.isActive, true);
    assert.strictEqual(sensor2.lastState!.isActive, true);

    // Event ended only sent to filter1
    filter1.handleAlerts([makeEventEnded(['תל אביב'])]);
    assert.strictEqual(sensor1.lastState!.isActive, false);
    assert.strictEqual(sensor2.lastState!.isActive, true); // filter2 never got event ended
  });

  it('should handle timeout expiry after some cities cleared by event ended', () => {
    const shortFilter = createFilter(log, accessory, ['תל אביב', 'חיפה'], allCategoryIds(), 100);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);

    // Event ended clears חיפה
    feedAlerts(shortFilter, [makeEventEnded(['חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.ok(accessory.lastState!.activeCities.has('תל אביב'));

    // Age תל אביב past timeout
    const activeCities = (shortFilter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);

    // Empty poll triggers expiry
    feedAlerts(shortFilter, []);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle alert followed by many empty polls then event ended', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Simulate many empty polls
    for (let i = 0; i < 20; i++) {
      feedAlerts(filter, []);
    }
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should expire alert at exactly the timeout boundary', () => {
    const shortFilter = createFilter(log, accessory, cities, allCategoryIds(), 100);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Set timestamp to exactly the timeout boundary
    const activeCities = (shortFilter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 100);

    feedAlerts(shortFilter, []);
    // At exactly timeout, should NOT expire (only > timeout expires)
    assert.strictEqual(accessory.lastState!.isActive, true);

    // One ms past timeout — should expire
    activeCities.set('תל אביב', Date.now() - 101);
    feedAlerts(shortFilter, []);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should rescue alert from expiry when new alert arrives at timeout boundary', () => {
    const shortFilter = createFilter(log, accessory, cities, allCategoryIds(), 100);

    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Age close to expiry
    const activeCities = (shortFilter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 99);

    // New alert resets timestamp before expiry runs
    feedAlerts(shortFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(Date.now() - activeCities.get('תל אביב')! < 50);
  });

  it('should handle cat as number instead of string (API inconsistency)', () => {
    const numericCatAlert = { id: '1', cat: 1 as any, title: 'rockets', data: ['תל אביב'], desc: '' };
    feedAlerts(filter, [numericCatAlert]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should handle alert with missing fields gracefully', () => {
    const partial = { id: '1', cat: '1', title: 'test', data: ['תל אביב'] } as any;
    feedAlerts(filter, [partial]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should handle alert with undefined data gracefully', () => {
    const noData = { id: '1', cat: '1', title: 'test', data: undefined } as any;
    // Should not crash
    assert.doesNotThrow(() => feedAlerts(filter, [noData]));
  });

  it('should handle overlapping prefixes - shorter prefix matches first', () => {
    const prefixFilter = createFilter(
      log, accessory, ['כפר', 'כפר סבא'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['כפר סבא'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    // "כפר סבא" exact match should take priority over "כפר" prefix
    assert.ok(accessory.lastState!.activeCities.has('כפר סבא'));
  });

  it('should handle overlapping prefixes - non-exact falls to shorter prefix', () => {
    const prefixFilter = createFilter(
      log, accessory, ['כפר', 'כפר סבא'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true,
    );

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['כפר יונה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    // "כפר יונה" is not an exact match for either, but "כפר" is a prefix
    assert.ok(accessory.lastState!.activeCities.has('כפר'));
  });

  it('should handle alert storm with 50+ cities', () => {
    const manyCities = Array.from({ length: 50 }, (_, i) => `עיר-${i}`);
    const stormFilter = createFilter(log, accessory, manyCities, allCategoryIds());

    feedAlerts(stormFilter, [makeAlert(OrefCategory.Rockets, manyCities)]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 50);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for all
    feedAlerts(stormFilter, [makeEventEnded(manyCities)]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle two different categories for same city then single event ended clears both', () => {
    feedAlerts(filter, [
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
      makeAlert(OrefCategory.UAVIntrusion, ['תל אביב']),
    ]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Single event ended clears regardless of how many categories triggered it
    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle event ended in multiple separate batches for different cities', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);

    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(filter, [makeEventEnded(['חיפה'])]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 0);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should handle whitespace-only city name in alert data', () => {
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['  ', 'תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
  });

  it('should handle rapid cycle: alert → end → alert → end for same city in separate batches', () => {
    for (let i = 0; i < 10; i++) {
      feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
      assert.strictEqual(accessory.lastState!.isActive, true, `cycle ${i}: alert`);

      feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
      assert.strictEqual(accessory.lastState!.isActive, false, `cycle ${i}: ended`);
    }
  });

  it('should survive alert with completely empty object in array', () => {
    const emptyObj = {} as any;
    assert.doesNotThrow(() => feedAlerts(filter, [emptyObj]));
  });

  it('should handle event ended between two alert batches for different cities', () => {
    // First alert for תל אביב
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Event ended for תל אביב
    feedAlerts(filter, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    // New alert for חיפה — sensor should re-trigger
    feedAlerts(filter, [makeAlert(OrefCategory.Rockets, ['חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(accessory.lastState!.activeCities.has('חיפה'));
    assert.ok(!accessory.lastState!.activeCities.has('תל אביב'));
  });

  it('should not trigger false alarm for empty string city with prefix matching', () => {
    const prefixFilter = createFilter(log, accessory, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, [''])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not clear active alert via empty string event ended with prefix matching', () => {
    const prefixFilter = createFilter(log, accessory, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, true);

    feedAlerts(prefixFilter, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(prefixFilter, [makeEventEnded([''])]);
    assert.strictEqual(accessory.lastState!.isActive, true); // should NOT be cleared
  });

  it('should handle all categories firing at once', () => {
    const allAlerts = [
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
      makeAlert(OrefCategory.UAVIntrusion, ['חיפה']),
      makeAlert(OrefCategory.Earthquake, ['תל אביב']),
      makeAlert(OrefCategory.TerroristInfiltration, ['חיפה']),
    ];
    feedAlerts(filter, allAlerts);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual(accessory.lastState!.activeCities.size, 2);
  });
});

describe('AlertService polling', () => {
  const cities = ['תל אביב', 'חיפה'];
  let log: any;
  let accessory: ReturnType<typeof createMockAccessory>;

  beforeEach(() => {
    log = createMockLogger();
    accessory = createMockAccessory();
  });

  function createPollingService(client: AlertClient): { service: AlertService; filter: SensorFilter } {
    const service = new AlertService(log, client, DEFAULT_POLLING_INTERVAL);
    const filter = createFilter(log, accessory, cities, allCategoryIds());
    service.registerListener(filter);
    return { service, filter };
  }

  it('should not schedule new polls after stop()', async () => {
    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    const mockClient = createMockClient(alerts);
    const { service } = createPollingService(mockClient);

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    const callsAtStop = (mockClient.fetchAlerts as any).mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    const callsAfter = (mockClient.fetchAlerts as any).mock.calls.length;

    assert.strictEqual(callsAtStop, callsAfter);
  });

  it('should recover after multiple consecutive errors', async () => {
    let callCount = 0;
    const flakyClient: AlertClient = {
      fetchAlerts: mock.fn(() => {
        callCount++;
        if (callCount <= 3) {
          return Promise.reject(new Error('temporary failure'));
        }
        return Promise.resolve([makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
      }),
    };
    const service = new AlertService(log, flakyClient, 10);
    const filter = createFilter(log, accessory, cities, allCategoryIds());
    service.registerListener(filter);

    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();

    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok(callCount >= 4);
  });

  it('should silently handle AbortError from timeout', async () => {
    const abortClient: AlertClient = {
      fetchAlerts: mock.fn(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }),
    };
    const { service } = createPollingService(abortClient);

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(log.error.mock.calls.length, 0);
  });

  it('should poll and process alerts from client', async () => {
    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    const mockClient = createMockClient(alerts);
    const { service } = createPollingService(mockClient);

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual((mockClient.fetchAlerts as any).mock.calls.length >= 1, true);
  });

  it('should handle client errors gracefully', async () => {
    const failingClient: AlertClient = {
      fetchAlerts: mock.fn(() => Promise.reject(new Error('network error'))),
    };
    const { service } = createPollingService(failingClient);

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(log.error.mock.calls.length >= 1, true);
    assert.strictEqual(accessory.lastState, null);
  });

  it('should broadcast to multiple filters', async () => {
    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    const mockClient = createMockClient(alerts);
    const service = new AlertService(log, mockClient, DEFAULT_POLLING_INTERVAL);

    const accessory1 = createMockAccessory();
    const accessory2 = createMockAccessory();
    const filter1 = createFilter(log, accessory1, ['תל אביב'], allCategoryIds());
    const filter2 = createFilter(log, accessory2, ['חיפה'], allCategoryIds());

    service.registerListener(filter1);
    service.registerListener(filter2);

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(accessory1.lastState!.isActive, true);
    assert.strictEqual(accessory2.lastState!.isActive, false);
  });

  it('should isolate filters - each sensor tracks independently', () => {
    const accessory1 = createMockAccessory();
    const accessory2 = createMockAccessory();
    const filter1 = createFilter(log, accessory1, ['תל אביב'], allCategoryIds());
    const filter2 = createFilter(log, accessory2, ['חיפה'], allCategoryIds());

    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])];
    filter1.handleAlerts(alerts);
    filter2.handleAlerts(alerts);

    assert.strictEqual(accessory1.lastState!.isActive, true);
    assert.strictEqual(accessory2.lastState!.isActive, true);

    // Event ended only for תל אביב
    const ended = [makeEventEnded(['תל אביב'])];
    filter1.handleAlerts(ended);
    filter2.handleAlerts(ended);

    assert.strictEqual(accessory1.lastState!.isActive, false);
    assert.strictEqual(accessory2.lastState!.isActive, true); // חיפה still active
  });

  it('should allow different categories per filter', () => {
    const accessory1 = createMockAccessory();
    const accessory2 = createMockAccessory();
    const filter1 = createFilter(log, accessory1, ['תל אביב'], new Set(CATEGORY_MAP['rockets']));
    const filter2 = createFilter(log, accessory2, ['תל אביב'], new Set(CATEGORY_MAP['earthquake']));

    const rocketAlert = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    filter1.handleAlerts(rocketAlert);
    filter2.handleAlerts(rocketAlert);

    assert.strictEqual(accessory1.lastState!.isActive, true);
    assert.strictEqual(accessory2.lastState!.isActive, false);
  });

  it('should resume polling after stop and start again', async () => {
    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    const mockClient = createMockClient(alerts);
    const { service } = createPollingService(mockClient);

    // First start/stop
    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    const callsAfterFirstStop = (mockClient.fetchAlerts as any).mock.calls.length;
    assert.ok(callsAfterFirstStop >= 1);

    // Reset accessory state
    accessory.lastState = null;

    // Second start/stop — should resume polling
    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.ok((mockClient.fetchAlerts as any).mock.calls.length > callsAfterFirstStop);
  });

  it('should handle alternating alerts and empty responses from API', async () => {
    let callCount = 0;
    const alternatingClient: AlertClient = {
      fetchAlerts: mock.fn(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return Promise.resolve([makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
        }
        return Promise.resolve([]);
      }),
    };
    const service = new AlertService(log, alternatingClient, 10);
    const filter = createFilter(log, accessory, cities, allCategoryIds());
    service.registerListener(filter);

    service.start();
    await new Promise((r) => setTimeout(r, 150));
    service.stop();

    // Alert should remain active because there's no event ended, just empty polls
    assert.strictEqual(accessory.lastState!.isActive, true);
  });
});

describe('getCategoryName', () => {
  it('should return correct names for known categories', () => {
    assert.strictEqual(getCategoryName(OrefCategory.Rockets), 'rockets');
    assert.strictEqual(getCategoryName(OrefCategory.NonConventional), 'nonconventional');
    assert.strictEqual(getCategoryName(OrefCategory.Earthquake), 'earthquake');
    assert.strictEqual(getCategoryName(OrefCategory.CBRNE), 'cbrne');
    assert.strictEqual(getCategoryName(OrefCategory.Tsunami), 'tsunami');
    assert.strictEqual(getCategoryName(OrefCategory.UAVIntrusion), 'uav');
    assert.strictEqual(getCategoryName(OrefCategory.HazardousMaterials), 'hazmat');
    assert.strictEqual(getCategoryName(OrefCategory.Warning), 'warning');
    assert.strictEqual(getCategoryName(OrefCategory.HeadsUpNotice), 'headsup');
    assert.strictEqual(getCategoryName(OrefCategory.TerroristInfiltration), 'terror');
  });

  it('should return unknown for unrecognized categories', () => {
    assert.strictEqual(getCategoryName(999), 'unknown');
  });
});
