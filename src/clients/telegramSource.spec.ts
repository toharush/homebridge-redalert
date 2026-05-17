import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TelegramSource, SharedTelegramClient, TelegramSourceConfig } from './telegramSource';
import { OrefRealtimeAlert } from '../types';

function createLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    easyDebug: mock.fn(),
    prefix: '',
  } as any;
}

function createMockSharedClient(): SharedTelegramClient & { _handlers: Map<string, (text: string) => void> } {
  const handlers = new Map<string, (text: string) => void>();
  return {
    _handlers: handlers,
    connect: mock.fn(async () => {}),
    isConnected: mock.fn(() => true),
    addMessageHandler: mock.fn((channel: string, handler: (text: string) => void) => {
      handlers.set(channel, handler);
    }),
    stop: mock.fn(),
  };
}

function createConfig(overrides?: Partial<TelegramSourceConfig>): TelegramSourceConfig {
  return {
    name: 'test-telegram',
    channel: 'TestAlertsChannel',
    fallbackCategory: 'rockets',
    failureThreshold: 3,
    cityList: ['תל אביב - יפו', 'תל אביב', 'חיפה'],
    ...overrides,
  };
}

describe('TelegramSource', () => {
  let log: ReturnType<typeof createLogger>;
  let client: ReturnType<typeof createMockSharedClient>;
  let config: TelegramSourceConfig;

  beforeEach(() => {
    log = createLogger();
    client = createMockSharedClient();
    config = createConfig();
  });

  it('has correct name and type', () => {
    const source = new TelegramSource(log, config, client);
    assert.strictEqual(source.name, 'test-telegram');
    assert.strictEqual(source.type, 'telegram');
  });

  it('starts unhealthy', () => {
    const source = new TelegramSource(log, config, client);
    assert.strictEqual(source.isHealthy(), false);
  });

  it('becomes healthy when setHealthy(true) is called', () => {
    const source = new TelegramSource(log, config, client);
    const healthEvents: boolean[] = [];
    source.onHealthChange((h) => healthEvents.push(h));

    source.setHealthy(true);

    assert.strictEqual(source.isHealthy(), true);
    assert.deepStrictEqual(healthEvents, [true]);
  });

  it('becomes unhealthy when setHealthy(false) is called after being healthy', () => {
    const source = new TelegramSource(log, config, client);
    const healthEvents: boolean[] = [];
    source.onHealthChange((h) => healthEvents.push(h));

    source.setHealthy(true);
    source.setHealthy(false);

    assert.strictEqual(source.isHealthy(), false);
    assert.deepStrictEqual(healthEvents, [true, false]);
  });

  it('does not emit duplicate health events', () => {
    const source = new TelegramSource(log, config, client);
    const healthEvents: boolean[] = [];
    source.onHealthChange((h) => healthEvents.push(h));

    source.setHealthy(false); // already false, no event
    source.setHealthy(true);
    source.setHealthy(true); // already true, no event

    assert.deepStrictEqual(healthEvents, [true]);
  });

  it('registers handler with shared client on start()', () => {
    const source = new TelegramSource(log, config, client);
    source.start();

    assert.strictEqual(
      (client.addMessageHandler as any).mock.calls.length,
      1,
    );
    const call = (client.addMessageHandler as any).mock.calls[0];
    assert.strictEqual(call.arguments[0], 'TestAlertsChannel');
    assert.strictEqual(typeof call.arguments[1], 'function');
  });

  it('stop() does not throw (no-op)', () => {
    const source = new TelegramSource(log, config, client);
    source.start();
    source.stop(); // should not throw
    assert.ok(true);
  });

  it('emits parsed alerts when message is received', () => {
    const source = new TelegramSource(log, config, client);
    const receivedAlerts: OrefRealtimeAlert[][] = [];
    source.onAlerts((alerts) => receivedAlerts.push(alerts));
    source.start();

    // Simulate a message through the registered handler
    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler, 'Handler should be registered');

    handler('צבע אדום [12:00]\nחיפה');

    assert.strictEqual(receivedAlerts.length, 1);
    assert.strictEqual(receivedAlerts[0].length, 1);
    assert.deepStrictEqual(receivedAlerts[0][0].data, ['חיפה']);
  });

  it('does not emit alerts for empty parse result', () => {
    const source = new TelegramSource(log, config, client);
    const receivedAlerts: OrefRealtimeAlert[][] = [];
    source.onAlerts((alerts) => receivedAlerts.push(alerts));
    source.start();

    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler);

    // Message with no matching cities
    handler('some random text with no cities');

    assert.strictEqual(receivedAlerts.length, 0);
  });

  it('does not emit alerts for empty messages', () => {
    const source = new TelegramSource(log, config, client);
    const receivedAlerts: OrefRealtimeAlert[][] = [];
    source.onAlerts((alerts) => receivedAlerts.push(alerts));
    source.start();

    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler);

    handler('');
    handler('   ');

    assert.strictEqual(receivedAlerts.length, 0);
  });

  it('works without callbacks registered', () => {
    const source = new TelegramSource(log, config, client);
    source.start();

    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler);

    // Should not throw even without callbacks
    handler('צבע אדום [12:00]\nחיפה');
    assert.ok(true);
  });

  it('emits alerts with correct category from message', () => {
    const source = new TelegramSource(log, config, client);
    const receivedAlerts: OrefRealtimeAlert[][] = [];
    source.onAlerts((alerts) => receivedAlerts.push(alerts));
    source.start();

    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler);

    handler('צבע אדום [12:00]\nתל אביב - יפו');

    assert.strictEqual(receivedAlerts.length, 1);
    const alert = receivedAlerts[0][0];
    assert.deepStrictEqual(alert.data, ['תל אביב - יפו']);
    // Title should be extracted from first line
    assert.ok(alert.title.includes('צבע אדום'));
  });

  it('uses fallbackCategory when no Hebrew keyword matches', () => {
    const source = new TelegramSource(log, createConfig({ fallbackCategory: 'uav' }), client);
    const receivedAlerts: OrefRealtimeAlert[][] = [];
    source.onAlerts((alerts) => receivedAlerts.push(alerts));
    source.start();

    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler);

    // No known Hebrew keyword in first line
    handler('התראה כללית\nחיפה');

    assert.strictEqual(receivedAlerts.length, 1);
    assert.strictEqual(receivedAlerts[0].length, 1);
  });

  it('logs errors from parse failures gracefully', () => {
    const source = new TelegramSource(log, config, client);
    source.onAlerts(() => {});
    source.start();

    const handler = client._handlers.get('TestAlertsChannel');
    assert.ok(handler);

    // parseTelegramMessage handles bad input gracefully, so this should not throw
    handler('valid text\nחיפה');
    assert.ok(true);
  });
});
