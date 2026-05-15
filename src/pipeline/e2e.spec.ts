import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from './AlertPipeline';
import { ExpiryStage } from './ExpiryStage';
import { DeduplicationStage } from './DeduplicationStage';
import { AlertHistory } from './AlertHistory';
import { SensorFilter } from '../services/SensorFilter';
import { HttpSource } from '../clients/httpSource';
import { OrefClient } from '../clients/orefClient';
import { OrefCategory, OrefRealtimeAlert } from '../types';
import { makeAlert, makeEventEnded, makeHeadsUpNotice } from '../clients/orefClient.mock';
import { CATEGORY_MAP } from '../types';

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
      this.lastState = { ...state, activeCities: new Map(state.activeCities) };
    },
  };
}

const originalFetch = globalThis.fetch;

function mockFetch(sequence: OrefRealtimeAlert[][]) {
  let i = 0;
  const bodies = sequence.map((a) => a.length > 0 ? JSON.stringify(a) : '');
  globalThis.fetch = mock.fn(() => {
    const body = i < bodies.length ? bodies[i] : '';
    i++;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(body), status: 200 });
  }) as any;
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

describe('E2E: Full pipeline architecture', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('source → ExpiryStage → Dedup → SensorFilter → accessory', async () => {
    mockFetch([
      [makeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])],
    ]);

    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const history = new AlertHistory(100);

    pipeline.addStage(new DeduplicationStage(30000, undefined, history));
    pipeline.addStage(new ExpiryStage(30000));
    pipeline.subscribe(history);

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב', 'חיפה'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const client = new OrefClient(3000);
    pipeline.addSource(new HttpSource(log, {
      name: 'test', url: '', pollingInterval: 10, requestTimeout: 3000,
      failureThreshold: 3, fetchFn: () => client.fetchAlerts(),
    }));

    pipeline.start();
    await new Promise((r) => setTimeout(r, 50));
    pipeline.stop();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.strictEqual(sensor.lastState!.activeCities.size, 2);
    assert.ok(history.getAll().length >= 1);
    assert.strictEqual(history.getAll()[0].status, 'active');
  });

  it('event-ended flows through pipeline and clears sensor + history', async () => {
    mockFetch([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [], [],
      [makeEventEnded(['תל אביב'])],
    ]);

    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const history = new AlertHistory(100);

    pipeline.addStage(new DeduplicationStage(30000, undefined, history));
    pipeline.addStage(new ExpiryStage(30000));
    pipeline.subscribe(history);

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const client = new OrefClient(3000);
    pipeline.addSource(new HttpSource(log, {
      name: 'test', url: '', pollingInterval: 15, requestTimeout: 3000,
      failureThreshold: 3, fetchFn: () => client.fetchAlerts(),
    }));

    pipeline.start();
    await new Promise((r) => setTimeout(r, 150));
    pipeline.stop();

    assert.strictEqual(sensor.lastState!.isActive, false);
    assert.strictEqual(sensor.lastState!.activeCities.size, 0);
    assert.strictEqual(history.getAll()[0].status, 'ended');
  });

  it('ExpiryStage injects synthetic event-ended after timeout', async () => {
    const realNow = Date.now;
    let currentTime = 100000;
    Date.now = () => currentTime;

    const dedupStage = new DeduplicationStage(30000);
    const expiryStage = new ExpiryStage(500);
    expiryStage.attachSeen(dedupStage.seen);

    const alert = makeAlert(OrefCategory.Rockets, ['תל אביב']);
    let result = dedupStage.process([alert], 'test');
    result = expiryStage.process(result);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, String(OrefCategory.Rockets));

    currentTime += 600;
    result = dedupStage.process([], 'test');
    result = expiryStage.process(result);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(Number(result[0].cat), OrefCategory.EventEnded);
    assert.ok(result[0].data.includes('תל אביב'));

    Date.now = realNow;
  });

  it('ExpiryStage does NOT expire within timeout', async () => {
    const realNow = Date.now;
    let currentTime = 100000;
    Date.now = () => currentTime;

    const dedupStage = new DeduplicationStage(30000);
    const expiryStage = new ExpiryStage(500);
    expiryStage.attachSeen(dedupStage.seen);

    dedupStage.process([makeAlert(OrefCategory.Rockets, ['תל אביב'])], 'test');

    currentTime += 400;
    const result = expiryStage.process([]);
    assert.strictEqual(result.length, 0, 'should not expire within timeout');

    Date.now = realNow;
  });

  it('ExpiryStage respects explicit event-ended (does not double-expire)', () => {
    const realNow = Date.now;
    let currentTime = 100000;
    Date.now = () => currentTime;

    const dedupStage = new DeduplicationStage(30000);
    const expiryStage = new ExpiryStage(500);
    expiryStage.attachSeen(dedupStage.seen);

    dedupStage.process([makeAlert(OrefCategory.Rockets, ['תל אביב'])], 'test');

    currentTime += 200;
    const ended: OrefRealtimeAlert = {
      id: 'end-1', cat: String(OrefCategory.EventEnded),
      title: 'האירוע הסתיים', data: ['תל אביב'], desc: '',
    };
    dedupStage.process([ended], 'test');

    currentTime += 400;
    const result = expiryStage.process([]);
    assert.strictEqual(result.length, 0, 'already ended — should not inject synthetic');

    Date.now = realNow;
  });

  it('dedup prevents duplicate alerts from triggering sensor twice', async () => {
    mockFetch([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
    ]);

    const log = createLogger();
    const pipeline = new AlertPipeline(log);

    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const client = new OrefClient(3000);
    pipeline.addSource(new HttpSource(log, {
      name: 'test', url: '', pollingInterval: 10, requestTimeout: 3000,
      failureThreshold: 3, fetchFn: () => client.fetchAlerts(),
    }));

    pipeline.start();
    await new Promise((r) => setTimeout(r, 80));
    pipeline.stop();

    assert.strictEqual(sensor.lastState!.isActive, true);
    const infoLogs = log.info.mock.calls.filter((c: any) => c.arguments[0].includes('ALERT'));
    assert.strictEqual(infoLogs.length, 1, 'sensor triggered only once despite duplicate');
  });

  it('AlertHistory receives events as pipeline listener', async () => {
    mockFetch([
      [makeAlert(OrefCategory.Rockets, ['תל אביב'])],
      [], [],
      [makeEventEnded(['תל אביב'])],
    ]);

    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const history = new AlertHistory(100);

    pipeline.addStage(new DeduplicationStage(30000, undefined, history));
    pipeline.addStage(new ExpiryStage(30000));
    pipeline.subscribe(history);

    const client = new OrefClient(3000);
    pipeline.addSource(new HttpSource(log, {
      name: 'test', url: '', pollingInterval: 15, requestTimeout: 3000,
      failureThreshold: 3, fetchFn: () => client.fetchAlerts(),
    }));

    pipeline.start();
    await new Promise((r) => setTimeout(r, 150));
    pipeline.stop();

    const entries = history.getAll();
    assert.ok(entries.length >= 1);
    assert.strictEqual(entries[0].status, 'ended');
  });

  it('multiple sensors with different categories filter independently', async () => {
    mockFetch([
      [makeAlert(OrefCategory.Rockets, ['תל אביב']), makeHeadsUpNotice(['תל אביב'])],
    ]);

    const log = createLogger();
    const pipeline = new AlertPipeline(log);

    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const rocketSensor = createAccessory();
    const noticeSensor = createAccessory();
    pipeline.subscribe(new SensorFilter('Rockets', log, rocketSensor, ['תל אביב'], new Set(CATEGORY_MAP['rockets']), false));
    pipeline.subscribe(new SensorFilter('Notice', log, noticeSensor, ['תל אביב'], new Set(CATEGORY_MAP['warning']), false));

    const client = new OrefClient(3000);
    pipeline.addSource(new HttpSource(log, {
      name: 'test', url: '', pollingInterval: 10, requestTimeout: 3000,
      failureThreshold: 3, fetchFn: () => client.fetchAlerts(),
    }));

    pipeline.start();
    await new Promise((r) => setTimeout(r, 50));
    pipeline.stop();

    assert.strictEqual(rocketSensor.lastState!.isActive, true);
    assert.strictEqual(noticeSensor.lastState!.isActive, true);
  });

  it('health change callback receives full source status', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('fail'))) as any;

    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const healthEvents: any[] = [];

    pipeline.addSource(new HttpSource(log, {
      name: 'Pikud HaOref', url: '', pollingInterval: 10, requestTimeout: 3000,
      failureThreshold: 3, fetchFn: () => Promise.reject(new Error('fail')),
    }));
    pipeline.onHealthChange = (status) => healthEvents.push(status);

    pipeline.start();
    await new Promise((r) => setTimeout(r, 100));
    pipeline.stop();

    assert.ok(healthEvents.length >= 1);
    assert.strictEqual(healthEvents[0][0].name, 'Pikud HaOref');
    assert.strictEqual(healthEvents[0][0].healthy, false);
  });
});
