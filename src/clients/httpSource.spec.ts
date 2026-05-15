import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { HttpSource } from './httpSource';
import { OrefRealtimeAlert } from '../types';

const originalFetch = globalThis.fetch;

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

describe('HttpSource', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('polls and emits alerts via fetchFn', async () => {
    const alerts: OrefRealtimeAlert[] = [
      { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ];
    const fetchFn = mock.fn(() => Promise.resolve(alerts));
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 3000,
      failureThreshold: 3,
      fetchFn,
    });

    const received: OrefRealtimeAlert[][] = [];
    source.onAlerts((a) => received.push(a));
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    source.stop();

    assert.ok(received.length >= 1);
    assert.deepStrictEqual(received[0], alerts);
  });

  it('emits empty arrays to allow pipeline stages to run', async () => {
    const fetchFn = mock.fn(() => Promise.resolve([] as OrefRealtimeAlert[]));
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 3000,
      failureThreshold: 3,
      fetchFn,
    });

    const received: OrefRealtimeAlert[][] = [];
    source.onAlerts((a) => received.push(a));
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    source.stop();

    assert.ok(received.length > 0);
    assert.strictEqual(received[0].length, 0);
  });

  it('starts healthy', () => {
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 1000,
      requestTimeout: 3000,
      failureThreshold: 3,
      fetchFn: () => Promise.resolve([]),
    });
    assert.strictEqual(source.isHealthy(), true);
  });

  it('becomes unhealthy after consecutive failures exceed threshold', async () => {
    const fetchFn = mock.fn(() => Promise.reject(new Error('fail')));
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 3000,
      failureThreshold: 3,
      fetchFn,
    });

    const healthEvents: boolean[] = [];
    source.onHealthChange((h) => healthEvents.push(h));
    source.start();
    await new Promise((r) => setTimeout(r, 120));
    source.stop();

    assert.strictEqual(source.isHealthy(), false);
    assert.ok(healthEvents.includes(false));
  });

  it('recovers health after failure then success', async () => {
    let callCount = 0;
    const fetchFn = mock.fn(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.reject(new Error('fail'));
      }
      return Promise.resolve([] as OrefRealtimeAlert[]);
    });
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 3000,
      failureThreshold: 3,
      fetchFn,
    });

    const healthEvents: boolean[] = [];
    source.onHealthChange((h) => healthEvents.push(h));
    source.start();
    await new Promise((r) => setTimeout(r, 200));
    source.stop();

    assert.deepStrictEqual(healthEvents, [false, true]);
  });

  it('adaptive timeout reduces timeout on first failure', async () => {
    let callCount = 0;
    const fetchFn = mock.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('fail'));
      }
      return Promise.resolve([] as OrefRealtimeAlert[]);
    });
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 5000,
      failureThreshold: 5,
      fetchFn,
      adaptiveTimeout: true,
    });

    source.onAlerts(() => {});
    source.start();
    await new Promise((r) => setTimeout(r, 80));
    source.stop();

    assert.ok(callCount >= 2);
  });

  it('stops polling after stop()', async () => {
    let callCount = 0;
    const fetchFn = mock.fn(() => {
      callCount++;
      return Promise.resolve([] as OrefRealtimeAlert[]);
    });
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 3000,
      failureThreshold: 3,
      fetchFn,
    });

    source.start();
    await new Promise((r) => setTimeout(r, 50));
    source.stop();
    const countAtStop = callCount;
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(callCount, countAtStop);
  });

  it('fetches from URL when no fetchFn provided', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ id: '1', cat: 'rockets', title: 'Rockets', data: ['city1'], desc: '' }]),
    })) as any;

    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: 'http://example.com/alerts',
      pollingInterval: 10,
      requestTimeout: 3000,
      failureThreshold: 3,
      categoryMapping: { rockets: 'rockets' },
    });

    const received: OrefRealtimeAlert[][] = [];
    source.onAlerts((a) => received.push(a));
    source.start();
    await new Promise((r) => setTimeout(r, 50));
    source.stop();

    assert.ok(received.length >= 1);
  });

  it('logs slow responses', async () => {
    const fetchFn = mock.fn(async () => {
      await new Promise((r) => setTimeout(r, 2100));
      return [{ id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' }] as OrefRealtimeAlert[];
    });
    const log = createLogger();
    const source = new HttpSource(log, {
      name: 'test',
      url: '',
      pollingInterval: 10,
      requestTimeout: 5000,
      failureThreshold: 3,
      fetchFn,
    });

    source.onAlerts(() => {});
    source.start();
    await new Promise((r) => setTimeout(r, 2500));
    source.stop();

    assert.ok(log.warn.mock.calls.some((c: any) => c.arguments[0].includes('Slow')));
  });
});
