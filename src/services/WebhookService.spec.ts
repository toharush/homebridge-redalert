import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { WebhookService, WebhookPayload } from './WebhookService';

describe('WebhookService', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock.fn((url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true } as Response);
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createLog() {
    return { info: mock.fn(), warn: mock.fn(), error: mock.fn(), easyDebug: mock.fn() } as any;
  }

  const alertPayload: WebhookPayload = {
    event: 'alert',
    sensor: 'Home',
    city: 'תל אביב - יפו',
    title: 'ירי רקטות וטילים',
    timestamp: 1700000000000,
  };

  it('sends POST request to configured URL', async () => {
    const service = new WebhookService([{ url: 'https://example.com/hook' }], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].url, 'https://example.com/hook');
    assert.strictEqual(fetchCalls[0].init.method, 'POST');
  });

  it('includes JSON payload in request body', async () => {
    const service = new WebhookService([{ url: 'https://example.com/hook' }], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(fetchCalls[0].init.body as string);
    assert.strictEqual(body.event, 'alert');
    assert.strictEqual(body.sensor, 'Home');
    assert.strictEqual(body.city, 'תל אביב - יפו');
    assert.strictEqual(body.title, 'ירי רקטות וטילים');
    assert.strictEqual(body.timestamp, 1700000000000);
  });

  it('sends Content-Type application/json header', async () => {
    const service = new WebhookService([{ url: 'https://example.com/hook' }], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.strictEqual(headers['Content-Type'], 'application/json');
  });

  it('uses PUT method when configured', async () => {
    const service = new WebhookService([{ url: 'https://example.com/hook', method: 'PUT' }], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(fetchCalls[0].init.method, 'PUT');
  });

  it('includes custom headers', async () => {
    const service = new WebhookService([{
      url: 'https://example.com/hook',
      headers: { 'Authorization': 'Bearer token123' },
    }], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.strictEqual(headers['Authorization'], 'Bearer token123');
    assert.strictEqual(headers['Content-Type'], 'application/json');
  });

  it('fires to multiple webhook URLs', async () => {
    const service = new WebhookService([
      { url: 'https://first.com/hook' },
      { url: 'https://second.com/hook' },
    ], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(fetchCalls.length, 2);
    assert.strictEqual(fetchCalls[0].url, 'https://first.com/hook');
    assert.strictEqual(fetchCalls[1].url, 'https://second.com/hook');
  });

  it('sends ended event payload', async () => {
    const service = new WebhookService([{ url: 'https://example.com/hook' }], createLog());
    service.fire({
      event: 'ended',
      sensor: 'Office',
      city: 'חיפה',
      title: 'Event Ended',
      timestamp: 1700000060000,
    });

    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(fetchCalls[0].init.body as string);
    assert.strictEqual(body.event, 'ended');
    assert.strictEqual(body.sensor, 'Office');
    assert.strictEqual(body.city, 'חיפה');
  });

  it('logs error on fetch failure without crashing', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('Network error'))) as any;
    const log = createLog();
    const service = new WebhookService([{ url: 'https://example.com/hook' }], log);
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(log.error.mock.calls.length, 1);
    assert.ok(log.error.mock.calls[0].arguments[0].includes('Network error'));
  });

  it('does nothing when no webhooks configured', async () => {
    const service = new WebhookService([], createLog());
    service.fire(alertPayload);

    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(fetchCalls.length, 0);
  });
});
