import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

let WebSocketSource: any;
let wsAvailable = false;
try {
  ({ WebSocketSource } = require('./webSocketSource'));
  wsAvailable = true;
} catch {
  // ws module not installed — tests will be skipped
}

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

describe('WebSocketSource', { skip: !wsAvailable ? 'ws module not installed' : undefined }, () => {
  it('starts healthy before connection', () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://invalid.example.com',
      reconnectInterval: 1000,
      failureThreshold: 3,
    });
    assert.strictEqual(source.isHealthy(), true);
  });

  it('has correct name and type', () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'my-source',
      url: 'wss://invalid.example.com',
      reconnectInterval: 1000,
      failureThreshold: 3,
    });
    assert.strictEqual(source.name, 'my-source');
    assert.strictEqual(source.type, 'websocket');
  });

  it('stop cleans up without error when never started', () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://invalid.example.com',
      reconnectInterval: 1000,
      failureThreshold: 3,
    });
    source.stop();
    assert.ok(true);
  });

  it('accepts onAlerts and onHealthChange callbacks without error', () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://invalid.example.com',
      reconnectInterval: 1000,
      failureThreshold: 3,
    });
    source.onAlerts(() => {});
    source.onHealthChange(() => {});
    assert.ok(true);
  });

  it('parseFn config is accepted', () => {
    const log = createLogger();
    const parseFn = mock.fn(() => []);
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://invalid.example.com',
      reconnectInterval: 1000,
      failureThreshold: 3,
      parseFn,
    });
    assert.strictEqual(source.name, 'test-ws');
  });

  it('does not connect until start is called', () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://invalid.example.com',
      reconnectInterval: 1000,
      failureThreshold: 3,
    });
    assert.strictEqual(log.info.mock.calls.length, 0);
    source.stop();
  });

  it('logs connection attempt on start', async () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://127.0.0.1:1',
      reconnectInterval: 60000,
      failureThreshold: 3,
    });
    source.start();
    assert.ok(log.info.mock.calls.some((c: any) => c.arguments[0].includes('connecting')));
    source.stop();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('becomes unhealthy after failureThreshold connection failures', async () => {
    const log = createLogger();
    const source = new WebSocketSource(log, {
      name: 'test-ws',
      url: 'wss://127.0.0.1:1',
      reconnectInterval: 20,
      failureThreshold: 2,
    });

    const healthEvents: boolean[] = [];
    source.onHealthChange((h: boolean) => healthEvents.push(h));
    source.start();
    await new Promise((r) => setTimeout(r, 300));
    source.stop();

    assert.strictEqual(source.isHealthy(), false);
    assert.ok(healthEvents.includes(false));
  });
});
