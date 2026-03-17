import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { OrefCategory, CATEGORY_MAP, getCategoryName, OrefRealtimeAlert, AlertState, EVENT_ENDED_TITLE } from '../types';
import { AlertClient } from '../clients/orefClient';
import { AlertService, AlertAccessory } from './AlertService';
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

function createService(
  log: any,
  cities: string[],
  categories: Set<number>,
  client?: AlertClient,
  prefixMatching?: boolean,
): AlertService {
  return new AlertService(log, client || createMockClient(), cities, categories, DEFAULT_POLLING_INTERVAL, DEFAULT_ALERT_TIMEOUT, prefixMatching);
}

// Feed alerts directly without starting the polling loop
function feedAlerts(service: AlertService, alerts: OrefRealtimeAlert[]): void {
  (service as any).handleAlerts(alerts);
}

describe('AlertService', () => {
  const cities = ['תל אביב', 'חיפה'];
  let log: any;
  let service: AlertService;
  let accessory: ReturnType<typeof createMockAccessory>;

  beforeEach(() => {
    log = createMockLogger();
    service = createService(log, cities, allCategoryIds());
    accessory = createMockAccessory();
    service.registerAccessory(accessory);
  });

  it('should broadcast active state for matching city', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should broadcast active when matching city is in array with others', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['באר שבע', 'חיפה', 'אשדוד'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should stay active when realtime alerts clear (no EventEnded)', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(service, []);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should deactivate when EventEnded received for city', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(service, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should stay active if EventEnded only for some cities', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);

    feedAlerts(service, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(service, [makeEventEnded(['חיפה'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not be active for cities not in config', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['באר שבע'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should not be active for event-ended without prior alert', () => {
    feedAlerts(service, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should filter by allowed categories', () => {
    const rocketsOnly = createService(log, cities, new Set(CATEGORY_MAP['rockets']));
    rocketsOnly.registerAccessory(accessory);

    feedAlerts(rocketsOnly, [makeAlert(OrefCategory.TerroristInfiltration, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    feedAlerts(rocketsOnly, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should not duplicate cities on repeated alerts', () => {
    const alert = makeAlert(OrefCategory.Rockets, ['תל אביב']);
    feedAlerts(service, [alert]);
    feedAlerts(service, [alert]);
    feedAlerts(service, [alert]);
    assert.strictEqual(accessory.lastState!.activeCities.size, 1);
  });

  it('should reset timeout on repeated alerts for same city', () => {
    const shortTimeout = new AlertService(log, createMockClient(), cities, allCategoryIds(), 1000, 100);
    shortTimeout.registerAccessory(accessory);

    feedAlerts(shortTimeout, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Simulate time passing close to timeout, then new alert resets it
    const activeCities = (shortTimeout as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 90); // 90ms ago, almost expired at 100ms

    feedAlerts(shortTimeout, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    // Timestamp should be reset to now, so it should NOT expire
    const timestamp = activeCities.get('תל אביב')!;
    assert.ok(Date.now() - timestamp < 50);
  });

  it('should skip alerts with invalid category', () => {
    const badAlert = { id: '1', cat: 'invalid', title: 'bad', data: ['תל אביב'], desc: '' };
    feedAlerts(service, [badAlert]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should broadcast to multiple accessories', () => {
    const second = createMockAccessory();
    service.registerAccessory(second);

    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual(second.lastState!.isActive, true);
  });

  it('should trigger on heads-up notice (cat 10 with non-EventEnded title)', () => {
    feedAlerts(service, [makeHeadsUpNotice(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should NOT treat heads-up notice as event ended', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    // Heads-up notice is cat 10 but should NOT clear the active alert
    feedAlerts(service, [makeHeadsUpNotice(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should only treat cat 10 as event ended when title matches', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    feedAlerts(service, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should NOT prefix match when disabled', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);
  });

  it('should prefix match sub-areas when enabled', () => {
    const prefixService = createService(log, ['תל אביב'], allCategoryIds(), undefined, true);
    prefixService.registerAccessory(accessory);

    feedAlerts(prefixService, [makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should prefix match when configured city is more specific', () => {
    const prefixService = createService(log, ['תל אביב - דרום העיר ויפו'], allCategoryIds(), undefined, true);
    prefixService.registerAccessory(accessory);

    feedAlerts(prefixService, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should allow re-trigger after event ended for same city', () => {
    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);

    feedAlerts(service, [makeEventEnded(['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, false);

    feedAlerts(service, [makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(accessory.lastState!.isActive, true);
  });

  it('should poll and process alerts from client', async () => {
    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    const mockClient = createMockClient(alerts);
    const pollingService = createService(log, cities, allCategoryIds(), mockClient);
    pollingService.registerAccessory(accessory);

    pollingService.start();
    await new Promise((r) => setTimeout(r, 50));
    pollingService.stop();

    assert.strictEqual(accessory.lastState!.isActive, true);
    assert.strictEqual((mockClient.fetchAlerts as any).mock.calls.length >= 1, true);
  });

  it('should handle client errors gracefully', async () => {
    const failingClient: AlertClient = {
      fetchAlerts: mock.fn(() => Promise.reject(new Error('network error'))),
    };
    const pollingService = createService(log, cities, allCategoryIds(), failingClient);
    pollingService.registerAccessory(accessory);

    pollingService.start();
    await new Promise((r) => setTimeout(r, 50));
    pollingService.stop();

    assert.strictEqual(log.error.mock.calls.length >= 1, true);
    assert.strictEqual(accessory.lastState, null);
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
