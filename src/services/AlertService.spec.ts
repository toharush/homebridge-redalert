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
