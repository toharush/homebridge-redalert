import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { OrefCategory, CATEGORY_MAP, getCategoryName, OrefRealtimeAlert } from '../types';
import { OrefClient } from '../clients/orefClient';
import { AlertService } from './AlertService';
import { SensorFilter, parseAlerts } from './SensorFilter';
import {
  makeAlert,
  makeEventEnded,
  makeHeadsUpNotice,
  originalFetch,
  createMockLogger,
  createMockAccessory,
  allCategoryIds,
  mockFetchSequence,
  TestPipeline,
} from './SensorFilter.mock';
import { DEFAULT_ALERT_TIMEOUT } from '../settings';

describe('alert lifecycle', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('activates sensor for matching city, ignores non-matching', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['באר שבע', 'תל אביב', 'אשדוד'])]]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(sensor.lastState!.activeCities.has('תל אביב'));
    assert.ok(!sensor.lastState!.activeCities.has('חיפה'), 'חיפה not in alert — should not activate');
    assert.ok(!sensor.lastState!.activeCities.has('באר שבע'), 'באר שבע not in config — should not appear');
  });

  it('stays active through empty polls (no Event Ended = still sheltering)', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [], [], [], [],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(5);

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('deactivates on Event Ended (cat 10 remapped to 99 by OrefClient)', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('re-triggers after Event Ended when new alert arrives', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());

    await p.pollN(2);
    assert.strictEqual(sensor.lastState!.isActive, false);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('does not activate for cities not in config', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['באר שבע'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('Event Ended for never-active city is harmless', async () => {
    const p = new TestPipeline([[makeEventEnded(['תל אביב'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('double Event Ended is idempotent', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(4);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('handles alert + event ended in same batch (alert wins for fresh city)', async () => {
    const p = new TestPipeline([
      [makeEventEnded(['תל אביב']), makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('handles event ended + new alert for different city in same batch', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['תל אביב']), makeAlert(OrefCategory.Rockets, ['חיפה'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(!sensor.lastState!.activeCities.has('תל אביב'));
    assert.ok(sensor.lastState!.activeCities.has('חיפה'));
  });

  it('handles many empty polls then event ended clears', async () => {
    const sequence: OrefRealtimeAlert[][] = [
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      ...Array(20).fill([]),
      [makeEventEnded(['תל אביב'])],
    ];
    const p = new TestPipeline(sequence);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(sequence.length);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('handles rapid alert → end → alert → end cycles', async () => {
    const sequence: OrefRealtimeAlert[][] = [];
    for (let i = 0; i < 10; i++) {
      sequence.push([makeAlert(OrefCategory.Rockets, ['תל אביב'])]);
      sequence.push([makeEventEnded(['תל אביב'])]);
    }
    const p = new TestPipeline(sequence);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());

    for (let i = 0; i < 10; i++) {
      await p.poll();
      assert.strictEqual(sensor.lastState!.isActive, true, `cycle ${i}: alert`);
      await p.poll();
      assert.strictEqual(sensor.lastState!.isActive, false, `cycle ${i}: ended`);
    }
  });
});

describe('multi-city', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('activates all matching cities independently', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה', 'באר שבע'])]]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה', 'באר שבע'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.activeCities.size, 3);
  });

  it('clears one city at a time via separate Event Ended batches', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה', 'באר שבע'])],
      [makeEventEnded(['תל אביב'])],
      [makeEventEnded(['חיפה'])],
      [makeEventEnded(['באר שבע'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה', 'באר שבע'], allCategoryIds());

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 3);

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 2);
    assert.strictEqual(sensor.lastState!.isActive, true);

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
    assert.ok(sensor.lastState!.activeCities.has('באר שבע'));

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('batch event ended clears multiple cities at once', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])],
      [makeEventEnded(['תל אביב', 'חיפה'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, false);
    assert.strictEqual(sensor.lastState!.activeCities.size, 0);
  });

  it('event ended for unrelated city does not affect active alerts', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['חיפה'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(sensor.lastState!.activeCities.has('תל אביב'));
  });

  it('does not duplicate cities on repeated alerts', async () => {
    const alert = makeAlert(OrefCategory.Rockets, ['תל אביב']);
    const p = new TestPipeline([[alert], [alert], [alert]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(3);

    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
  });
});

describe('category filtering', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sensor only activates for its configured categories', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Earthquake, ['תל אביב'])],
      [makeAlert(OrefCategory.Tsunami, ['תל אביב'])],
      [makeHeadsUpNotice(['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'earthquake ignored');
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'tsunami ignored');
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'notice ignored');
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true, 'rockets activates');
  });

  it('Event Ended clears any category sensor (OREF sends one for all)', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']));
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('HeadsUpNotice (cat 10, different title) does NOT clear active alerts', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeHeadsUpNotice(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('all categories firing at once activates all matching cities', async () => {
    const p = new TestPipeline([[
      makeAlert(OrefCategory.Rockets, ['תל אביב']),
      makeAlert(OrefCategory.UAVIntrusion, ['חיפה']),
      makeAlert(OrefCategory.Earthquake, ['תל אביב']),
      makeAlert(OrefCategory.TerroristInfiltration, ['חיפה']),
    ]]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.strictEqual(sensor.lastState!.activeCities.size, 2);
  });

  it('two different categories for same city — single event ended clears', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב']), makeAlert(OrefCategory.UAVIntrusion, ['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });
});

describe('cross-category sensor independence', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('notice and rocket sensors work independently through full lifecycle', async () => {
    const p = new TestPipeline([
      [makeHeadsUpNotice(['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor: noticeSensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['warning']));
    const { sensor: rocketSensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, true, 'notice activates');
    assert.strictEqual(rocketSensor.lastState!.isActive, false, 'rocket stays off');

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, true, 'notice still on');
    assert.strictEqual(rocketSensor.lastState!.isActive, true, 'rocket activates');

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, false, 'notice clears');
    assert.strictEqual(rocketSensor.lastState!.isActive, false, 'rocket clears');
  });

  it('notice does NOT activate rocket sensor', async () => {
    const p = new TestPipeline([[makeHeadsUpNotice(['תל אביב'])]]);
    const { sensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']));
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('unrelated category does NOT refresh expired sensor', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeAlert(OrefCategory.Earthquake, ['תל אביב'])],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']), { timeout: 100 });

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);

    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'earthquake should not refresh rocket sensor');
  });

  it('notice keeps notice sensor alive but NOT rocket sensor', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב']), makeHeadsUpNotice(['תל אביב'])],
      [makeHeadsUpNotice(['תל אביב'])],
    ]);
    const { sensor: rocketSensor, filter: rocketFilter } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']), { timeout: 100 });
    const { sensor: noticeSensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['warning']), { timeout: 100 });

    await p.poll();
    assert.strictEqual(rocketSensor.lastState!.isActive, true);
    assert.strictEqual(noticeSensor.lastState!.isActive, true);

    const rocketCities = (rocketFilter as any).activeCities as Map<string, number>;
    rocketCities.set('תל אביב', Date.now() - 200);

    await p.poll();
    assert.strictEqual(rocketSensor.lastState!.isActive, false, 'rocket expired');
    assert.strictEqual(noticeSensor.lastState!.isActive, true, 'notice refreshed');
  });

  it('cross-category alert does NOT activate a new city — only refreshes existing', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeHeadsUpNotice(['חיפה'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב', 'חיפה'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
    assert.ok(!sensor.lastState!.activeCities.has('חיפה'));
  });

  it('Event Ended clears all sensor types (notice, rocket, earthquake)', async () => {
    const p = new TestPipeline([
      [makeHeadsUpNotice(['חיפה']), makeAlert(OrefCategory.Rockets, ['חיפה']), makeAlert(OrefCategory.Earthquake, ['חיפה'])],
      [makeEventEnded(['חיפה'])],
    ]);
    const { sensor: noticeSensor } = p.addSensor(['חיפה'], new Set(CATEGORY_MAP['warning']));
    const { sensor: rocketSensor } = p.addSensor(['חיפה'], new Set(CATEGORY_MAP['rockets']));
    const { sensor: eqSensor } = p.addSensor(['חיפה'], new Set(CATEGORY_MAP['earthquake']));

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(rocketSensor.lastState!.isActive, true);
    assert.strictEqual(eqSensor.lastState!.isActive, true);

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, false);
    assert.strictEqual(rocketSensor.lastState!.isActive, false);
    assert.strictEqual(eqSensor.lastState!.isActive, false);
  });
});

describe('prefix matching', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sub-area alert matches parent city config', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: true });
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(sensor.lastState!.activeCities.has('תל אביב'));
  });

  it('parent alert matches configured sub-area', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב'])]]);
    const { sensor } = p.addSensor(['תל אביב - דרום העיר ויפו'], allCategoryIds(), { prefix: true });
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('does NOT prefix match when disabled', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: false });
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('event ended for parent clears sub-area alerts', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח', 'תל אביב - דרום העיר ויפו'])],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: true });
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('event ended for sub-area clears parent city', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['פתח תקווה'])],
      [makeEventEnded(['פתח תקווה - מזרח'])],
    ]);
    const { sensor } = p.addSensor(['פתח תקווה'], allCategoryIds(), { prefix: true });
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('non-prefix substring does not match', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב'])]]);
    const { sensor } = p.addSensor(['אביב'], allCategoryIds(), { prefix: true });
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('multiple sub-areas resolve to same configured parent', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['באר שבע - צפון', 'באר שבע - דרום', 'באר שבע - מזרח'])],
      [makeEventEnded(['באר שבע'])],
    ]);
    const { sensor } = p.addSensor(['באר שבע'], allCategoryIds(), { prefix: true });

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
    assert.ok(sensor.lastState!.activeCities.has('באר שבע'));

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('isolates prefix matching between sensors', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח'])]]);
    const { sensor: prefixSensor } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: true });
    const { sensor: exactSensor } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: false });
    await p.poll();

    assert.strictEqual(prefixSensor.lastState!.isActive, true);
    assert.strictEqual(exactSensor.lastState!.isActive, false);
  });

  it('does not cross-match unrelated city prefixes', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['כפר סבא'])]]);
    const { sensor } = p.addSensor(['כפר סבא', 'כפר יונה'], allCategoryIds(), { prefix: true });
    await p.poll();

    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
    assert.ok(sensor.lastState!.activeCities.has('כפר סבא'));
    assert.ok(!sensor.lastState!.activeCities.has('כפר יונה'));
  });

  it('re-triggers after prefix event ended with new sub-area alert', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['אשדוד - א,ב,ד,ה'])],
      [makeEventEnded(['אשדוד'])],
      [makeAlert(OrefCategory.Rockets, ['אשדוד - ג,ו,ז'])],
    ]);
    const { sensor } = p.addSensor(['אשדוד'], allCategoryIds(), { prefix: true });

    await p.pollN(2);
    assert.strictEqual(sensor.lastState!.isActive, false);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('clears configured sub-areas individually', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח']), makeAlert(OrefCategory.Rockets, ['תל אביב - דרום העיר ויפו'])],
      [makeEventEnded(['תל אביב - מזרח'])],
      [makeEventEnded(['תל אביב - דרום העיר ויפו'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב - מזרח', 'תל אביב - דרום העיר ויפו'], allCategoryIds(), { prefix: true });

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 2);

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
    assert.ok(sensor.lastState!.activeCities.has('תל אביב - דרום העיר ויפו'));

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('prefix matching with correct spelling matches, misspelled does not', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['פתח תקווה - מזרח'])]]);
    const { sensor: correct } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']), { prefix: true });
    const { sensor: misspelled } = p.addSensor(['פתח תקוה'], new Set(CATEGORY_MAP['rockets']), { prefix: true });
    await p.poll();

    assert.strictEqual(correct.lastState!.isActive, true);
    assert.strictEqual(misspelled.lastState!.isActive, false, 'misspelled prefix does not match');
  });

  it('empty string city and event ended do not trigger with prefix matching', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, [''])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeEventEnded([''])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds(), { prefix: true });

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'empty string does not activate');

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true, 'empty event ended does not clear');
  });
});

describe('timeout and expiry', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('alert expires after timeout without Event Ended', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);

    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('alert does NOT expire within timeout', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds(), { timeout: 5000 });
    await p.pollN(2);

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('repeated alerts reset the timeout', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);
    const { filter } = p.addSensor(['תל אביב'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 90);

    await p.poll();
    const timestamp = activeCities.get('תל אביב')!;
    assert.ok(Date.now() - timestamp < 50, 'timestamp should be fresh');
  });

  it('one city expires while another stays active', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['חיפה'])],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(!sensor.lastState!.activeCities.has('תל אביב'));
    assert.ok(sensor.lastState!.activeCities.has('חיפה'));
  });

  it('rescue from expiry when new alert arrives before timeout', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 99);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(Date.now() - activeCities.get('תל אביב')! < 50);
  });

  it('exact timeout boundary: not expired at boundary, expired past it', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [],
      [],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    const activeCities = (filter as any).activeCities as Map<string, number>;

    activeCities.set('תל אביב', Date.now() - 100);
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true, 'at exactly timeout — not expired');

    activeCities.set('תל אביב', Date.now() - 101);
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'past timeout — expired');
  });

  it('timeout expiry after some cities cleared by event ended', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])],
      [makeEventEnded(['חיפה'])],
      [],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב', 'חיפה'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 2);

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);

    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('multiple cities both expire when only unrelated category arrives', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])],
      [makeHeadsUpNotice(['תל אביב'])],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב', 'חיפה'], new Set(CATEGORY_MAP['rockets']), { timeout: 100 });

    await p.poll();
    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);
    activeCities.set('חיפה', Date.now() - 200);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false, 'notice does not refresh rocket sensor');
  });

  it('all-categories sensor IS refreshed by notice (notice is an allowed category)', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeHeadsUpNotice(['תל אביב'])],
    ]);
    const { sensor, filter } = p.addSensor(['תל אביב'], allCategoryIds(), { timeout: 100 });

    await p.poll();
    const activeCities = (filter as any).activeCities as Map<string, number>;
    activeCities.set('תל אביב', Date.now() - 200);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true, 'notice refreshed the all-categories sensor');
  });
});

describe('edge cases', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('empty data array', async () => {
    const p = new TestPipeline([[{ id: '1', cat: '1', title: 'test', data: [] as string[], desc: '' }]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('duplicate cities in alert data', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב', 'תל אביב', 'תל אביב'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
  });

  it('invalid, zero, and negative categories are ignored', async () => {
    const p = new TestPipeline([
      [{ id: '1', cat: 'invalid', title: 'bad', data: ['תל אביב'], desc: '' }],
      [{ id: '2', cat: '0', title: 'zero', data: ['תל אביב'], desc: '' }],
      [{ id: '3', cat: '-1', title: 'neg', data: ['תל אביב'], desc: '' }],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.pollN(3);

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('whitespace and empty string in alert data are filtered out', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['', '  ', 'תל אביב', ''])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.strictEqual(sensor.lastState!.activeCities.size, 1);
  });

  it('OrefClient handles BOM prefix in response', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      text: () => Promise.resolve('\uFEFF' + JSON.stringify([makeAlert(OrefCategory.Rockets, ['תל אביב'])])),
      status: 200,
    })) as any;

    const client = new OrefClient(3000);
    const log = createMockLogger();
    const sensor = createMockAccessory();
    const filter = new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false);

    const alerts = await client.fetchAlerts();
    filter.handleAlerts(parseAlerts(alerts));

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('OrefClient returns empty for malformed JSON', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      text: () => Promise.resolve('not valid json{{{'),
      status: 200,
    })) as any;

    const client = new OrefClient(3000);
    const log = createMockLogger();
    const sensor = createMockAccessory();
    const filter = new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false);

    const alerts = await client.fetchAlerts();
    filter.handleAlerts(parseAlerts(alerts));

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('cat as number instead of string (API inconsistency)', async () => {
    const p = new TestPipeline([[{ id: '1', cat: 1 as any, title: 'rockets', data: ['תל אביב'], desc: '' }]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('empty cities config never triggers', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]]);
    const { sensor } = p.addSensor([], allCategoryIds());
    await p.poll();

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('alert storm with 50+ cities', async () => {
    const manyCities = Array.from({ length: 50 }, (_, i) => `עיר-${i}`);
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, manyCities)],
      [makeEventEnded(manyCities)],
    ]);
    const { sensor } = p.addSensor(manyCities, allCategoryIds());

    await p.poll();
    assert.strictEqual(sensor.lastState!.activeCities.size, 50);

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('misspelled city (פתח תקוה vs פתח תקווה) does NOT match', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['פתח תקווה'])]]);
    const { sensor: exact } = p.addSensor(['פתח תקוה'], allCategoryIds());
    const { sensor: correct } = p.addSensor(['פתח תקווה'], allCategoryIds());
    await p.poll();

    assert.strictEqual(exact.lastState!.isActive, false, 'misspelled does not match');
    assert.strictEqual(correct.lastState!.isActive, true, 'correct spelling matches');
  });
});

describe('real-world scenario', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('full lifecycle: notice → rocket → empty polls → event ended', async () => {
    const notice = makeHeadsUpNotice(['פתח תקווה', 'בני ברק', 'חולון', 'תל אביב - מזרח', 'שילה']);
    const rocket = makeAlert(OrefCategory.Rockets, ['פתח תקווה', 'בני ברק', 'חולון', 'תל אביב - מזרח']);

    const p = new TestPipeline([
      [notice],
      [notice, rocket],
      [notice, rocket],
      [], [], [],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { sensor: noticeSensor } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['warning']));
    const { sensor: rocketSensor } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(rocketSensor.lastState!.isActive, false);

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(rocketSensor.lastState!.isActive, true);

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(rocketSensor.lastState!.isActive, true);

    await p.pollN(3);
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
    assert.strictEqual(rocketSensor.lastState!.isActive, true);

    await p.poll();
    assert.strictEqual(noticeSensor.lastState!.isActive, false);
    assert.strictEqual(rocketSensor.lastState!.isActive, false);
  });

  it('city-specific filtering: שילה only in notice, not in rocket', async () => {
    const notice = makeHeadsUpNotice(['פתח תקווה', 'שילה']);
    const rocket = makeAlert(OrefCategory.Rockets, ['פתח תקווה']);

    const p = new TestPipeline([[notice, rocket]]);
    const { sensor: noticeSensor } = p.addSensor(['שילה'], new Set(CATEGORY_MAP['warning']));
    const { sensor: rocketSensor } = p.addSensor(['שילה'], new Set(CATEGORY_MAP['rockets']));
    await p.poll();

    assert.strictEqual(noticeSensor.lastState!.isActive, true, 'שילה is in notice');
    assert.strictEqual(rocketSensor.lastState!.isActive, false, 'שילה is NOT in rocket');
  });

  it('prefix matching catches sub-areas through full pipeline', async () => {
    const rocket = makeAlert(OrefCategory.Rockets, ['תל אביב - מזרח', 'תל אביב - דרום העיר ויפו']);

    const p = new TestPipeline([
      [rocket],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']), { prefix: true });

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(sensor.lastState!.activeCities.has('תל אביב'));

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('multiple independent sensors: only matching cities activate', async () => {
    const rocket = makeAlert(OrefCategory.Rockets, ['פתח תקווה', 'בני ברק', 'חולון']);

    const p = new TestPipeline([[rocket]]);
    const { sensor: ptSensor } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));
    const { sensor: bbSensor } = p.addSensor(['בני ברק'], new Set(CATEGORY_MAP['rockets']));
    const { sensor: bsSensor } = p.addSensor(['באר שבע'], new Set(CATEGORY_MAP['rockets']));
    await p.poll();

    assert.strictEqual(ptSensor.lastState!.isActive, true);
    assert.strictEqual(bbSensor.lastState!.isActive, true);
    assert.strictEqual(bsSensor.lastState!.isActive, false, 'באר שבע not in payload');
  });
});

describe('AlertService async polling', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('polls, processes alerts, and stops cleanly', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.runService({ pollInterval: 10, waitMs: 80 });

    assert.strictEqual(sensor.lastState!.isActive, true);
  });

  it('does not schedule new polls after stop()', async () => {
    const getCalls = mockFetchSequence([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);
    const client = new OrefClient(3000);
    const log = createMockLogger();
    const service = new AlertService(log, client, 30);
    const sensor = createMockAccessory();
    service.registerListener(new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false));

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    const callsAtStop = getCalls();
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(getCalls(), callsAtStop);
  });

  it('recovers after multiple consecutive fetch errors', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.reject(new Error('temporary failure'));
      }
      return Promise.resolve({
        text: () => Promise.resolve(JSON.stringify([makeAlert(OrefCategory.Rockets, ['תל אביב'])])),
        status: 200,
      });
    }) as any;

    const client = new OrefClient(3000);
    const log = createMockLogger();
    const service = new AlertService(log, client, 10);
    const sensor = createMockAccessory();
    service.registerListener(new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false));

    service.start();
    await new Promise((r) => setTimeout(r, 200));
    service.stop();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(callCount >= 4);
  });

  it('silently handles AbortError from fetch timeout', async () => {
    globalThis.fetch = mock.fn(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as any;

    const client = new OrefClient(3000);
    const log = createMockLogger();
    const service = new AlertService(log, client, 30);
    const sensor = createMockAccessory();
    service.registerListener(new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false));

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(log.error.mock.calls.length, 0);
  });

  it('logs errors for non-abort fetch failures', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('network error'))) as any;

    const client = new OrefClient(3000);
    const log = createMockLogger();
    const service = new AlertService(log, client, 30);
    const sensor = createMockAccessory();
    service.registerListener(new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false));

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.ok(log.error.mock.calls.length >= 1);
    assert.strictEqual(sensor.lastState, null);
  });

  it('broadcasts to multiple filters', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב'])]]);
    const { sensor: s1 } = p.addSensor(['תל אביב'], allCategoryIds());
    const { sensor: s2 } = p.addSensor(['חיפה'], allCategoryIds());
    await p.runService({ pollInterval: 10, waitMs: 80 });

    assert.strictEqual(s1.lastState!.isActive, true);
    assert.strictEqual(s2.lastState!.isActive, false);
  });

  it('resumes polling after stop and start again', async () => {
    const alerts = [makeAlert(OrefCategory.Rockets, ['תל אביב'])];
    const getCalls = mockFetchSequence([alerts, alerts, alerts, alerts, alerts]);
    const client = new OrefClient(3000);
    const log = createMockLogger();
    const service = new AlertService(log, client, 10);
    const sensor = createMockAccessory();
    service.registerListener(new SensorFilter('Test', log, sensor, ['תל אביב'], allCategoryIds(), DEFAULT_ALERT_TIMEOUT, false));

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    const callsAfterFirst = getCalls();
    sensor.lastState = null;

    service.start();
    await new Promise((r) => setTimeout(r, 50));
    service.stop();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.ok(getCalls() > callsAfterFirst);
  });

  it('sensors stay active through empty polls then clear on event ended (async)', async () => {
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [], [], [], [],
      [makeEventEnded(['תל אביב'])],
    ]);
    const { sensor } = p.addSensor(['תל אביב'], new Set(CATEGORY_MAP['rockets']));
    await p.runService({ pollInterval: 15, waitMs: 250 });

    assert.strictEqual(sensor.lastState!.isActive, false);
  });

  it('full E2E: notice → rocket → empty → event ended through real polling', async () => {
    const notice = makeHeadsUpNotice(['פתח תקווה', 'בני ברק', 'חולון', 'תל אביב - מזרח', 'שילה']);
    const rocket = makeAlert(OrefCategory.Rockets, ['פתח תקווה', 'בני ברק', 'חולון', 'תל אביב - מזרח']);

    const p = new TestPipeline([
      [notice],
      [notice, rocket],
      [],
      [makeEventEnded(['פתח תקווה'])],
    ]);
    const { sensor: noticeSensor } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['warning']));
    const { sensor: rocketSensor } = p.addSensor(['פתח תקווה'], new Set(CATEGORY_MAP['rockets']));
    await p.runService({ pollInterval: 20, waitMs: 200 });

    assert.strictEqual(noticeSensor.lastState!.isActive, false);
    assert.strictEqual(rocketSensor.lastState!.isActive, false);
  });
});

describe('getCategoryName', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns correct names for known categories', async () => {
    const p = new TestPipeline([[makeAlert(OrefCategory.Rockets, ['תל אביב'])]]);
    const { sensor } = p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);

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

  it('returns unknown for unrecognized categories', async () => {
    const p = new TestPipeline([[{ id: '1', cat: '999', title: 'unknown', data: ['תל אביב'], desc: '' }]]);
    p.addSensor(['תל אביב'], allCategoryIds());
    await p.poll();

    assert.strictEqual(getCategoryName(999), 'unknown');
  });
});

describe('performance', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('processes Event Ended for 500 cities within 50ms', async () => {
    const manyCities = Array.from({ length: 500 }, (_, i) => `עיר-${i}`);
    const p = new TestPipeline([
      [makeAlert(OrefCategory.Rockets, manyCities)],
      [makeEventEnded(manyCities)],
    ]);
    const { sensor } = p.addSensor(manyCities, allCategoryIds());

    await p.poll();
    assert.strictEqual(sensor.lastState!.isActive, true);

    const start = performance.now();
    await p.poll();
    const elapsed = performance.now() - start;

    assert.strictEqual(sensor.lastState!.isActive, false);
    assert.ok(elapsed < 50, `Event Ended took ${elapsed.toFixed(1)}ms, expected < 50ms`);
  });
});
