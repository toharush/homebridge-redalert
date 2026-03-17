import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { OrefClient } from './orefClient';

const ALERT = { id: '1', cat: '1', title: 'ירי רקטות וטילים', data: ['תל אביב'], desc: 'desc' };

function mockFetch(body: string, status = 200) {
  return mock.fn(() => Promise.resolve({
    text: () => Promise.resolve(body),
    status,
  }));
}

describe('OrefClient', () => {
  const originalFetch = globalThis.fetch;
  let client: OrefClient;

  beforeEach(() => {
    client = new OrefClient(3000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should parse a single alert wrapped in array', async () => {
    globalThis.fetch = mockFetch(JSON.stringify([ALERT])) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, '1');
    assert.deepStrictEqual(result[0].data, ['תל אביב']);
  });

  it('should wrap a single alert object into an array', async () => {
    globalThis.fetch = mockFetch(JSON.stringify(ALERT)) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, '1');
  });

  it('should parse multiple alerts', async () => {
    const alerts = [ALERT, { ...ALERT, id: '2', data: ['חיפה'] }];
    globalThis.fetch = mockFetch(JSON.stringify(alerts)) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result.length, 2);
  });

  it('should return empty array for empty response', async () => {
    globalThis.fetch = mockFetch('') as any;
    const result = await client.fetchAlerts();
    assert.deepStrictEqual(result, []);
  });

  it('should return empty array for whitespace-only response', async () => {
    globalThis.fetch = mockFetch('   \n\t  ') as any;
    const result = await client.fetchAlerts();
    assert.deepStrictEqual(result, []);
  });

  it('should strip BOM prefix and parse correctly', async () => {
    globalThis.fetch = mockFetch('\uFEFF' + JSON.stringify([ALERT])) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, '1');
  });

  it('should return empty array for malformed JSON', async () => {
    globalThis.fetch = mockFetch('not valid json{{{') as any;
    const result = await client.fetchAlerts();
    assert.deepStrictEqual(result, []);
  });

  it('should return empty array for BOM-only response', async () => {
    globalThis.fetch = mockFetch('\uFEFF') as any;
    const result = await client.fetchAlerts();
    assert.deepStrictEqual(result, []);
  });

  it('should propagate fetch errors', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('network error'))) as any;
    await assert.rejects(() => client.fetchAlerts(), { message: 'network error' });
  });
});
