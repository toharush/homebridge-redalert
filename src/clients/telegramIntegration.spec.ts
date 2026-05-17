import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from '../pipeline/AlertPipeline';
import { DeduplicationStage } from '../pipeline/DeduplicationStage';
import { ExpiryStage } from '../pipeline/ExpiryStage';
import { SensorFilter } from '../services/SensorFilter';
import { TelegramSource, SharedTelegramClient, TelegramSourceConfig } from './telegramSource';
import { buildCityIndex } from './telegramParser';
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

function createMockClient(): SharedTelegramClient & { _handlers: Map<string, ((text: string) => void)[]> } {
  const handlers = new Map<string, ((text: string) => void)[]>();
  return {
    _handlers: handlers,
    connect: mock.fn(async () => {}),
    isConnected: mock.fn(() => true),
    addMessageHandler: mock.fn((channel: string, handler: (text: string) => void) => {
      if (!handlers.has(channel)) {
        handlers.set(channel, []);
      }
      handlers.get(channel)!.push(handler);
    }),
    stop: mock.fn(),
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

const cityList = buildCityIndex(['תל אביב', 'חיפה', 'באר שבע', 'ירושלים']);

describe('Telegram → Pipeline → Sensor integration', () => {
  it('telegram message triggers matching sensor', async () => {
    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const client = createMockClient();

    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב', 'חיפה'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const config: TelegramSourceConfig = {
      name: 'Kumta',
      channel: 'CumtaAlertsChannel',
      fallbackCategory: 'rockets',
      failureThreshold: 3,
      cityList,
    };
    const tgSource = new TelegramSource(log, config, client);
    tgSource.setHealthy(true);
    pipeline.addSource(tgSource);

    pipeline.start();
    await new Promise((r) => setTimeout(r, 20));

    const handler = client._handlers.get('CumtaAlertsChannel')?.[0];
    assert.ok(handler, 'handler should be registered');
    handler('צבע אדום [08:30]\nתל אביב\nחיפה');

    await new Promise((r) => setTimeout(r, 20));
    pipeline.stop();

    assert.strictEqual(sensor.lastState!.isActive, true);
    assert.strictEqual(sensor.lastState!.activeCities.size, 2);
    assert.ok(sensor.lastState!.activeCities.has('תל אביב'));
    assert.ok(sensor.lastState!.activeCities.has('חיפה'));
  });

  it('telegram message does not trigger non-matching sensor', async () => {
    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const client = createMockClient();

    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('South', log, sensor, ['באר שבע'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const config: TelegramSourceConfig = {
      name: 'Kumta',
      channel: 'CumtaAlertsChannel',
      fallbackCategory: 'rockets',
      failureThreshold: 3,
      cityList,
    };
    const tgSource = new TelegramSource(log, config, client);
    tgSource.setHealthy(true);
    pipeline.addSource(tgSource);

    pipeline.start();
    await new Promise((r) => setTimeout(r, 20));

    const handler = client._handlers.get('CumtaAlertsChannel')?.[0];
    assert.ok(handler);
    handler('צבע אדום [08:30]\nתל אביב\nחיפה');

    await new Promise((r) => setTimeout(r, 20));
    pipeline.stop();

    assert.strictEqual(sensor.lastState?.isActive ?? false, false);
  });

  it('dedup prevents same telegram alert from firing twice', async () => {
    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const client = createMockClient();

    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const config: TelegramSourceConfig = {
      name: 'Kumta',
      channel: 'CumtaAlertsChannel',
      fallbackCategory: 'rockets',
      failureThreshold: 3,
      cityList,
    };
    const tgSource = new TelegramSource(log, config, client);
    tgSource.setHealthy(true);
    pipeline.addSource(tgSource);

    pipeline.start();
    await new Promise((r) => setTimeout(r, 20));

    const handler = client._handlers.get('CumtaAlertsChannel')?.[0];
    assert.ok(handler);
    handler('צבע אדום [08:30]\nתל אביב');
    handler('צבע אדום [08:30]\nתל אביב');

    await new Promise((r) => setTimeout(r, 20));
    pipeline.stop();

    const infoLogs = log.info.mock.calls.filter((c: any) => c.arguments[0].includes('ALERT'));
    assert.strictEqual(infoLogs.length, 1, 'sensor triggered only once despite duplicate');
  });

  it('bindClient registers handler after start', async () => {
    const log = createLogger();
    const pipeline = new AlertPipeline(log);
    const client = createMockClient();

    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(30000));

    const sensor = createAccessory();
    const filter = new SensorFilter('Home', log, sensor, ['תל אביב'], allCategoryIds(), false);
    pipeline.subscribe(filter);

    const config: TelegramSourceConfig = {
      name: 'Kumta',
      channel: 'CumtaAlertsChannel',
      fallbackCategory: 'rockets',
      failureThreshold: 3,
      cityList,
    };
    const tgSource = new TelegramSource(log, config);
    pipeline.addSource(tgSource);

    pipeline.start();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(client._handlers.get('CumtaAlertsChannel'), undefined);

    tgSource.bindClient(client);
    tgSource.setHealthy(true);

    const handler = client._handlers.get('CumtaAlertsChannel')?.[0];
    assert.ok(handler, 'handler registered after bindClient');
    handler('צבע אדום [08:30]\nתל אביב');

    await new Promise((r) => setTimeout(r, 20));
    pipeline.stop();

    assert.strictEqual(sensor.lastState!.isActive, true);
  });
});
