import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { CATEGORY_MAP } from '../types';
import {
  ROCKET_MISSILE_ALERT as ROCKET,
  HEADSUP_NOTICE_ALERT as NOTICE,
  EARTHQUAKE_ALERT as EARTHQUAKE,
  rocketMissilePayload,
  makeEventEnded,
  originalFetch,
  allCategoryIds,
  TestPipeline,
} from './SensorFilter.mock';

// ---------------------------------------------------------------------------
// SensorFilter tests — every test verifies the full pipeline AND SensorFilter
// internal state (activeCities map, timestamps, city set management).
// All alert data comes from real mock JSON payloads through OrefClient.
// ---------------------------------------------------------------------------

describe('SensorFilter: activeCities tracking', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('adds city to activeCities on matching alert', async () => {
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.poll();

    assert.strictEqual(getActiveCities().size, 1);
    assert.ok(getActiveCities().has('פתח תקווה'));
  });

  it('stores timestamp in activeCities when alert arrives', async () => {
    const before = Date.now();
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.poll();
    const after = Date.now();

    const ts = getActiveCities().get('פתח תקווה')!;
    assert.ok(ts >= before && ts <= after, `timestamp ${ts} should be between ${before} and ${after}`);
  });

  it('refreshes timestamp on repeated alert for same city', async () => {
    const p = new TestPipeline([[ROCKET], [ROCKET]]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());

    await p.poll();
    const firstTs = getActiveCities().get('פתח תקווה')!;

    // Artificially age the timestamp
    getActiveCities().set('פתח תקווה', firstTs - 1000);

    await p.poll();
    const secondTs = getActiveCities().get('פתח תקווה')!;
    assert.ok(secondTs > firstTs - 1000, 'timestamp should be refreshed');
    assert.ok(Date.now() - secondTs < 50, 'timestamp should be recent');
  });

  it('removes city from activeCities on Event Ended', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());

    await p.poll();
    assert.strictEqual(getActiveCities().size, 1);

    await p.poll();
    assert.strictEqual(getActiveCities().size, 0);
    assert.ok(!getActiveCities().has('פתח תקווה'));
  });

  it('tracks multiple cities independently in activeCities', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['בני ברק'])],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה', 'בני ברק', 'חולון'], allCategoryIds());

    await p.poll();
    assert.strictEqual(getActiveCities().size, 3);

    await p.poll();
    assert.strictEqual(getActiveCities().size, 2);
    assert.ok(!getActiveCities().has('בני ברק'));
    assert.ok(getActiveCities().has('פתח תקווה'));
    assert.ok(getActiveCities().has('חולון'));
  });

  it('does NOT add non-configured city to activeCities', async () => {
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.poll();

    assert.strictEqual(getActiveCities().size, 1);
    assert.ok(!getActiveCities().has('בני ברק'));
    assert.ok(!getActiveCities().has('חולון'));
  });

  it('activeCities is empty after all cities cleared by Event Ended', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(rocketMissilePayload.data)],
    ]);
    const { sensor, getActiveCities } = p.addSensor(['פתח תקווה', 'בני ברק'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(getActiveCities().size, 0);
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('activeCities stays populated through empty polls', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [], [], [], [],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.pollN(5);

    assert.strictEqual(getActiveCities().size, 1);
    assert.ok(getActiveCities().has('פתח תקווה'));
  });

  it('Event Ended for non-active city does not modify activeCities', async () => {
    // שילה is in notice payload but NOT in rocket payload — never activated by rocket
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['שילה'])],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה', 'שילה'], allCategoryIds());

    await p.poll();
    assert.strictEqual(getActiveCities().size, 1); // only פתח תקווה (שילה not in rocket data)

    await p.poll();
    assert.strictEqual(getActiveCities().size, 1, 'שילה was never active — no change');
    assert.ok(getActiveCities().has('פתח תקווה'));
  });
});

describe('SensorFilter: timestamp expiry', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('removes expired cities from activeCities on next poll', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    assert.strictEqual(getActiveCities().size, 1);

    getActiveCities().set('פתח תקווה', Date.now() - 200);
    await p.poll();
    assert.strictEqual(getActiveCities().size, 0);
  });

  it('does NOT expire at exact timeout boundary (only > timeout)', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [],
      [],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds(), { timeout: 100 });

    await p.poll();

    getActiveCities().set('פתח תקווה', Date.now() - 100);
    await p.poll();
    assert.strictEqual(getActiveCities().size, 1, 'at exact boundary — not expired');

    getActiveCities().set('פתח תקווה', Date.now() - 101);
    await p.poll();
    assert.strictEqual(getActiveCities().size, 0, 'past boundary — expired');
  });

  it('expires one city while another stays active in activeCities', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [],
    ]);
    const { sensor, getActiveCities } = p.addSensor(
      ['פתח תקווה', 'בני ברק'], allCategoryIds(), { timeout: 100 },
    );

    await p.poll();
    assert.strictEqual(getActiveCities().size, 2);

    // Age only פתח תקווה
    getActiveCities().set('פתח תקווה', Date.now() - 200);
    await p.poll();

    assert.strictEqual(getActiveCities().size, 1);
    assert.ok(!getActiveCities().has('פתח תקווה'));
    assert.ok(getActiveCities().has('בני ברק'));
    assert.strictEqual(sensor.lastState!.isActive, true, 'still active — בני ברק remains');
  });

  it('new alert rescues city from expiry by refreshing timestamp', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [ROCKET],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    getActiveCities().set('פתח תקווה', Date.now() - 99); // near expiry

    await p.poll(); // fresh alert resets timestamp
    assert.strictEqual(getActiveCities().size, 1);
    assert.ok(Date.now() - getActiveCities().get('פתח תקווה')! < 50, 'timestamp refreshed');
  });

  it('logs warning when alert expires (safety fallback)', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    getActiveCities().set('פתח תקווה', Date.now() - 200);
    await p.poll();

    assert.ok(p.log.warn.mock.calls.length >= 1, 'should log expiry warning');
    assert.ok(
      p.log.warn.mock.calls.some((c: any) => c.arguments[0].includes('expired')),
      'warning should mention expiry',
    );
  });
});

describe('SensorFilter: category filtering on activeCities', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('only adds city when alert category is in allowedCategories', async () => {
    const p = new TestPipeline([
      [EARTHQUAKE],
      [ROCKET],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(getActiveCities().size, 0, 'earthquake not in rockets category');

    await p.poll();
    assert.strictEqual(getActiveCities().size, 1, 'rockets activates');
  });

  it('unrelated category does NOT refresh timestamp in activeCities', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [EARTHQUAKE],
    ]);
    const { getActiveCities } = p.addSensor(
      ['פתח תקווה'], new Set(CATEGORY_MAP['rockets']), { timeout: 100 },
    );

    await p.poll();
    getActiveCities().set('פתח תקווה', Date.now() - 200);

    await p.poll(); // earthquake — should not refresh
    assert.strictEqual(getActiveCities().size, 0, 'expired — earthquake did not refresh');
  });

  it('all-categories sensor gets refreshed by any category', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [NOTICE],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    getActiveCities().set('פתח תקווה', Date.now() - 200);

    await p.poll(); // notice refreshes because all categories allowed
    assert.strictEqual(getActiveCities().size, 1, 'notice refreshed all-categories sensor');
    assert.ok(Date.now() - getActiveCities().get('פתח תקווה')! < 50);
  });

  it('Event Ended removes from activeCities regardless of sensor category', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { getActiveCities } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(getActiveCities().size, 1);

    await p.poll();
    assert.strictEqual(getActiveCities().size, 0, 'event ended clears regardless of category');
  });
});

describe('SensorFilter: prefix matching in activeCities', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('stores configured city name (not alert sub-area) in activeCities', async () => {
    // rocketMissilePayload contains 'תל אביב - מזרח' — prefix 'תל אביב' should match
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: true });
    await p.poll();

    assert.strictEqual(getActiveCities().size, 1);
    assert.ok(getActiveCities().has('תל אביב'), 'stored under configured name');
    assert.ok(!getActiveCities().has('תל אביב - מזרח'), 'NOT stored under alert sub-area name');
  });

  it('prefix event ended removes configured city from activeCities', async () => {
    // Rocket has 'ראשון לציון - מזרח', prefix 'ראשון לציון' matches it
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['ראשון לציון'])],
    ]);
    const { getActiveCities } = p.addSensor(['ראשון לציון'], allCategoryIds(), { prefix: true });

    await p.poll();
    assert.ok(getActiveCities().has('ראשון לציון'));

    await p.poll();
    assert.strictEqual(getActiveCities().size, 0);
  });

  it('multiple sub-area alerts all map to same key in activeCities', async () => {
    // rocketMissilePayload has multiple 'תל אביב - *' sub-areas
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: true });
    await p.poll();

    assert.strictEqual(getActiveCities().size, 1, 'all sub-areas map to one key');
    assert.ok(getActiveCities().has('תל אביב'));
  });

  it('prefix disabled: sub-area alert does NOT add to activeCities', async () => {
    // With prefix disabled, 'תל אביב' won't match 'תל אביב - מזרח'
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: false });
    await p.poll();

    assert.strictEqual(getActiveCities().size, 0);
  });

  it('exact match takes priority over prefix in activeCities key', async () => {
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities } = p.addSensor(
      ['תל אביב - מזרח', 'תל אביב'], allCategoryIds(), { prefix: true },
    );
    await p.poll();

    assert.ok(getActiveCities().has('תל אביב - מזרח'), 'exact match stored under exact key');
  });
});

describe('SensorFilter: independent activeCities per sensor', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('each sensor has its own activeCities map', async () => {
    const p = new TestPipeline([[ROCKET]]);
    const { getActiveCities: ac1 } = p.addSensor(['פתח תקווה'], allCategoryIds());
    const { getActiveCities: ac2 } = p.addSensor(['חולון'], allCategoryIds());
    await p.poll();

    assert.strictEqual(ac1().size, 1);
    assert.ok(ac1().has('פתח תקווה'));
    assert.ok(!ac1().has('חולון'));

    assert.strictEqual(ac2().size, 1);
    assert.ok(ac2().has('חולון'));
    assert.ok(!ac2().has('פתח תקווה'));
  });

  it('Event Ended on one sensor does not affect other sensor activeCities', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { getActiveCities: ac1 } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));
    const { getActiveCities: ac2 } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(ac1().size, 1);
    assert.strictEqual(ac2().size, 1);

    // Both receive event ended since they share the same pipeline
    await p.poll();
    assert.strictEqual(ac1().size, 0);
    assert.strictEqual(ac2().size, 0);
  });

  it('notice sensor and rocket sensor have separate activeCities', async () => {
    // פתח תקווה is in both rocket and notice payloads
    const p = new TestPipeline([[ROCKET, NOTICE]]);
    const { getActiveCities: noticeAC } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['warning']));
    const { getActiveCities: rocketAC } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));
    await p.poll();

    assert.strictEqual(noticeAC().size, 1);
    assert.strictEqual(rocketAC().size, 1);
    // Different filter instances — independent maps
    assert.notStrictEqual(noticeAC(), rocketAC());
  });

  it('expiry in one sensor does not affect other sensor timestamps', async () => {
    // פתח תקווה is in both payloads
    const p = new TestPipeline([
      [ROCKET, NOTICE],
      [],
    ]);
    const { getActiveCities: rocketAC } = p.addSensor(
      ['פתח תקווה'], new Set(CATEGORY_MAP['rockets']), { timeout: 100 },
    );
    const { getActiveCities: noticeAC } = p.addSensor(
      ['פתח תקווה'], new Set(CATEGORY_MAP['warning']), { timeout: 100 },
    );

    await p.poll();

    // Age only rocket sensor
    rocketAC().set('פתח תקווה', Date.now() - 200);

    await p.poll();
    assert.strictEqual(rocketAC().size, 0, 'rocket expired');
    assert.strictEqual(noticeAC().size, 1, 'notice still active — independent timeout');
  });
});

describe('SensorFilter: activeCities ↔ accessory state consistency', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accessory isActive matches activeCities.size > 0', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['פתח תקווה'])],
      [ROCKET],
    ]);
    const { sensor, getActiveCities } = p.addSensor(['פתח תקווה', 'בני ברק'], allCategoryIds());

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, getActiveCities().size > 0);
    assert.strictEqual(getActiveCities().size, 2);

    await p.poll(); // event ended only for פתח תקווה — בני ברק still active
    assert.strictEqual(sensor.lastState!.isActive, getActiveCities().size > 0);
    assert.strictEqual(getActiveCities().size, 1);

    await p.poll(); // rocket again — פתח תקווה re-added
    assert.strictEqual(sensor.lastState!.isActive, getActiveCities().size > 0);
    assert.strictEqual(getActiveCities().size, 2);
  });

  it('accessory activeCities matches filter activeCities keys', async () => {
    const p = new TestPipeline([[ROCKET]]);
    const { sensor, getActiveCities } = p.addSensor(
      ['פתח תקווה', 'בני ברק', 'שילה'], allCategoryIds(),
    );
    await p.poll();

    // שילה is not in rocket payload so only 2 cities should be active
    const filterKeys = [...getActiveCities().keys()].sort();
    const accessoryKeys = [...sensor.lastState!.activeCities.keys()].sort();
    assert.deepStrictEqual(filterKeys, accessoryKeys);
    assert.strictEqual(filterKeys.length, 2);
  });

  it('accessory receives snapshot — not affected by later filter changes', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { sensor } = p.addSensor(['פתח תקווה'], allCategoryIds());

    await p.poll();
    const snapshotAfterAlert = sensor.lastState!.activeCities;
    assert.strictEqual(snapshotAfterAlert.size, 1);

    await p.poll();
    // The snapshot from the first poll should still show the city
    assert.strictEqual(snapshotAfterAlert.size, 1, 'snapshot is independent');
    // But latest state shows cleared
    assert.strictEqual(sensor.lastState!.activeCities.size, 0);
  });
});

describe('SensorFilter: logging through full pipeline', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('logs ALERT on new city activation', async () => {
    const p = new TestPipeline([[ROCKET]]);
    p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.poll();

    assert.ok(
      p.log.info.mock.calls.some(
        (c: any) => c.arguments[0].includes('ALERT') && c.arguments[0].includes('פתח תקווה'),
      ),
      'should log ALERT with city name',
    );
  });

  it('logs Event ended on city clear', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.pollN(2);

    assert.ok(
      p.log.info.mock.calls.some((c: any) => c.arguments[0].includes('Event ended')),
      'should log event ended',
    );
  });

  it('does NOT log ALERT on repeated alert for already-active city', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [ROCKET],
    ]);
    p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.pollN(2);

    const alertLogs = p.log.info.mock.calls.filter(
      (c: any) => c.arguments[0].includes('ALERT') && c.arguments[0].includes('פתח תקווה'),
    );
    assert.strictEqual(alertLogs.length, 1, 'ALERT logged only once — not on refresh');
  });
});

describe('SensorFilter: E2E through real AlertService polling', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('activeCities populated through actual AlertService timers', async () => {
    const p = new TestPipeline([[ROCKET]]);
    const { sensor, getActiveCities } = p.addSensor(['פתח תקווה', 'בני ברק'], allCategoryIds());
    await p.runService({ pollInterval: 10, waitMs: 80 });

    assert.strictEqual(getActiveCities().size, 2);
    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('activeCities cleared by Event Ended through AlertService polling', async () => {
    const p = new TestPipeline([
      [ROCKET],
      [], [],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { sensor, getActiveCities } = p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.runService({ pollInterval: 15, waitMs: 200 });

    assert.strictEqual(getActiveCities().size, 0);
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('multiple sensors have independent activeCities through AlertService', async () => {
    const p = new TestPipeline([[ROCKET, NOTICE]]);
    const { getActiveCities: rocketAC } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));
    const { getActiveCities: noticeAC } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['warning']));
    await p.runService({ pollInterval: 10, waitMs: 80 });

    assert.strictEqual(rocketAC().size, 1);
    assert.strictEqual(noticeAC().size, 1);
    assert.notStrictEqual(rocketAC(), noticeAC());
  });

  it('full lifecycle: activeCities tracks through notice → rocket → event ended', async () => {
    const p = new TestPipeline([
      [NOTICE],
      [NOTICE, ROCKET],
      [],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { getActiveCities: rocketAC, sensor: rocketSensor } = p.addSensor(
      ['פתח תקווה'], new Set(CATEGORY_MAP['rockets']),
    );
    const { getActiveCities: noticeAC, sensor: noticeSensor } = p.addSensor(
      ['פתח תקווה'], new Set(CATEGORY_MAP['warning']),
    );
    await p.runService({ pollInterval: 20, waitMs: 200 });

    // Both should be cleared after event ended
    assert.strictEqual(rocketAC().size, 0);
    assert.strictEqual(noticeAC().size, 0);
    assert.strictEqual(rocketSensor.lastState!.isActive, false);
    assert.strictEqual(noticeSensor.lastState!.isActive, false);
  });
});
