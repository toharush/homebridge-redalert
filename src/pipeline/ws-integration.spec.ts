import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer, WebSocket } from 'ws';
import { AlertPipeline } from './AlertPipeline';
import { DeduplicationStage } from './DeduplicationStage';
import { ExpiryStage } from './ExpiryStage';
import { AlertHistory } from './AlertHistory';
import { SensorFilter } from '../services/SensorFilter';
import { WebSocketSource } from '../clients/webSocketSource';
import { OrefCategory } from '../types';
import { CATEGORY_MAP } from '../types';

function createLogger() {
  return {
    info() {}, warn() {}, error() {},
    debug() {}, log() {}, success() {},
    easyDebug() {}, prefix: '',
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

function allCategoryIds(): Set<number> {
  const ids = new Set<number>();
  for (const arr of Object.values(CATEGORY_MAP)) {
    for (const id of arr) {
      ids.add(id);
    }
  }
  return ids;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function createMockWsServer(): { wss: WebSocketServer; port: number; broadcast: (msg: unknown) => void } {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as any).port;
  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  };
  return { wss, port, broadcast };
}

function fireAlert(broadcast: (msg: unknown) => void, threat: number, cities: string[], title = 'Test Alert') {
  broadcast({ type: 'ALERT', data: { threat, title, data: cities, isDrill: false } });
}

function fireEventEnded(broadcast: (msg: unknown) => void, threat: number, cities: string[]) {
  broadcast({ type: 'ALERT', data: { threat, title: 'Event Ended', data: cities, isDrill: false } });
}

describe('WebSocket Integration Tests', () => {
  let wss: WebSocketServer | null = null;
  let pipeline: AlertPipeline | null = null;

  afterEach(async () => {
    pipeline?.stop();
    pipeline = null;
    if (wss) {
      wss.close();
      await wait(50);
      wss = null;
    }
  });

  it('fires alert via WebSocket and activates sensor', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets', '5': 'uav', '2': 'terror', '7': 'nonconventional', '99': 'eventended' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['תל אביב']);
    await wait(100);

    assert.strictEqual(sensor.lastState?.isActive, true);
    assert.strictEqual(sensor.lastState?.activeCities.has('תל אביב'), true);
  });

  it('event ended deactivates sensor', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['חיפה'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets', '99': 'eventended' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['חיפה']);
    await wait(100);
    assert.strictEqual(sensor.lastState?.isActive, true);

    fireEventEnded(server.broadcast, 99, ['חיפה']);
    await wait(100);
    assert.strictEqual(sensor.lastState?.isActive, false);
    assert.strictEqual(sensor.lastState?.activeCities.size, 0);
  });

  it('dedup prevents duplicate alerts within window', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    let alertCount = 0;
    const sensor = createAccessory();
    const originalUpdate = sensor.updateAlertState.bind(sensor);
    sensor.updateAlertState = (state: any) => {
      alertCount++; originalUpdate(state);
    };

    const filter = new SensorFilter('Home', log, sensor, ['אשדוד'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['אשדוד']);
    await wait(50);
    fireAlert(server.broadcast, 0, ['אשדוד']);
    await wait(50);
    fireAlert(server.broadcast, 0, ['אשדוד']);
    await wait(50);

    assert.strictEqual(sensor.lastState?.isActive, true);
    assert.strictEqual(alertCount, 1, 'sensor should only be notified once despite 3 identical alerts');
  });

  it('different categories on same city trigger independently', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const rocketSensor = createAccessory();
    const uavSensor = createAccessory();
    pipeline.subscribe(new SensorFilter('Rockets', log, rocketSensor, ['נתניה'], new Set(CATEGORY_MAP['rockets']), false));
    pipeline.subscribe(new SensorFilter('UAV', log, uavSensor, ['נתניה'], new Set(CATEGORY_MAP['uav']), false));

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets', '5': 'uav', '99': 'eventended' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['נתניה']);
    await wait(100);
    assert.strictEqual(rocketSensor.lastState?.isActive, true);
    assert.strictEqual(uavSensor.lastState?.isActive, false);

    fireAlert(server.broadcast, 5, ['נתניה']);
    await wait(100);
    assert.strictEqual(uavSensor.lastState?.isActive, true);
  });

  it('alert history tracks alerts and ends', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    const history = new AlertHistory(100);

    pipeline.addStage(new DeduplicationStage(30000, undefined, history));
    pipeline.addStage(new ExpiryStage(30000));
    pipeline.subscribe(history);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets', '99': 'eventended' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['באר שבע', 'אופקים']);
    await wait(100);

    let entries = history.getAll();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].status, 'active');
    assert.strictEqual(entries[1].status, 'active');

    fireEventEnded(server.broadcast, 99, ['באר שבע']);
    await wait(100);

    entries = history.getAll();
    const beerSheva = entries.find((e) => e.city === 'באר שבע');
    const ofakim = entries.find((e) => e.city === 'אופקים');
    assert.strictEqual(beerSheva?.status, 'ended');
    assert.strictEqual(ofakim?.status, 'active');
  });

  it('prefix matching activates sensor for sub-area', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('TelAviv', log, sensor, ['תל אביב'], allCategoryIds(), true);
    pipeline.subscribe(filter);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['תל אביב - מרכז העיר']);
    await wait(100);

    assert.strictEqual(sensor.lastState?.isActive, true);
  });

  it('unmatched city does not activate sensor', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['חיפה', 'אשדוד']);
    await wait(100);

    assert.strictEqual(sensor.lastState?.isActive, false);
  });

  it('health changes on connection failure', async () => {
    const log = createLogger();
    pipeline = new AlertPipeline(log);

    const healthEvents: any[] = [];
    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: 'ws://127.0.0.1:1',
      reconnectInterval: 20,
      maxReconnectInterval: 40,
      failureThreshold: 2,
      categoryMapping: { '0': 'rockets' },
      messageType: 'ALERT',
      messageDataField: 'data',
    }));
    pipeline.onHealthChange = (status) => healthEvents.push(status);

    pipeline.start();
    await wait(500);

    assert.ok(healthEvents.some((e) => e[0]?.healthy === false), 'should become unhealthy after failures');
  });

  it('ExpiryStage auto-ends alert after timeout', async () => {
    const server = createMockWsServer();
    wss = server.wss;

    const log = createLogger();
    pipeline = new AlertPipeline(log);
    const dedupStage = new DeduplicationStage(30000);
    const expiryStage = new ExpiryStage(200);
    expiryStage.attachSeen(dedupStage.seen);
    pipeline.addStage(dedupStage);
    pipeline.addStage(expiryStage);

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['ראשון לציון'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    pipeline.addSource(new WebSocketSource(log, {
      name: 'mock',
      url: `ws://127.0.0.1:${server.port}`,
      reconnectInterval: 1000,
      failureThreshold: 5,
      categoryMapping: { '0': 'rockets', '99': 'eventended' },
      messageType: 'ALERT',
      messageDataField: 'data',
      responseFormat: { id_field: 'id', category_field: 'threat', title_field: 'title', cities_field: 'data', description_field: 'desc', alerts_path: '$' },
    }));

    pipeline.start();
    await wait(200);

    fireAlert(server.broadcast, 0, ['ראשון לציון']);
    await wait(100);
    assert.strictEqual(sensor.lastState?.isActive, true);

    // ExpiryStage needs empty polls to scan — HttpSource does this but WS doesn't poll.
    // The expiry will be triggered by the next alert pipeline tick from any source.
    // For this test, we wait for the expiry timeout and trigger a no-op alert on another city.
    await wait(300);
    fireAlert(server.broadcast, 0, ['עיר אחרת']);
    await wait(100);

    assert.strictEqual(sensor.lastState?.isActive, false);
  });
});
