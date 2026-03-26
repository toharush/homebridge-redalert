import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { OrefClient } from './orefClient';
import { OrefCategory, EVENT_ENDED_TITLE } from '../types';

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

  it('should remap Event Ended (cat 10 with event ended title) to cat 99', async () => {
    const eventEnded = { id: '2', cat: '10', title: EVENT_ENDED_TITLE, data: ['תל אביב'], desc: '' };
    globalThis.fetch = mockFetch(JSON.stringify([eventEnded])) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
  });

  it('should NOT remap HeadsUpNotice (cat 10 with different title)', async () => {
    const notice = { id: '3', cat: '10', title: 'בדקות הקרובות צפויות להתקבל התרעות באזורך', data: ['תל אביב'], desc: '' };
    globalThis.fetch = mockFetch(JSON.stringify([notice])) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result[0].cat, '10');
  });

  it('should remap cat 10 with title containing event ended text', async () => {
    const titles = [
      `${EVENT_ENDED_TITLE} - חזרו לשגרה`,
      `חזרו לשגרה - ${EVENT_ENDED_TITLE}`,
      `חזרו לשגרה ${EVENT_ENDED_TITLE} - חזרה לשגרה`,
    ];
    for (const title of titles) {
      const alert = { id: '4', cat: '10', title, data: ['תל אביב'], desc: '' };
      globalThis.fetch = mockFetch(JSON.stringify([alert])) as any;
      const result = await client.fetchAlerts();
      assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded), `title "${title}" should be remapped`);
    }
  });
});
