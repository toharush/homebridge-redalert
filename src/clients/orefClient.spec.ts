import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { OrefClient } from './orefClient';
import { OrefCategory, EVENT_ENDED_TITLE } from '../types';
import {
  ROCKET_MISSILE_ALERT as ALERT,
  HEADSUP_NOTICE_ALERT,
  rocketMissilePayload,
  makeEventEnded,
} from './orefClient.mock';

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
    assert.deepStrictEqual(result[0].data, rocketMissilePayload.data);
  });

  it('should wrap a single alert object into an array', async () => {
    globalThis.fetch = mockFetch(JSON.stringify(ALERT)) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, rocketMissilePayload.id);
  });

  it('should parse multiple alerts', async () => {
    const alerts = [ALERT, { ...ALERT, id: '2', data: ['חיפה', 'עכו'] }];
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
    assert.strictEqual(result[0].id, rocketMissilePayload.id);
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
    globalThis.fetch = mockFetch(JSON.stringify([makeEventEnded(rocketMissilePayload.data)])) as any;
    const result = await client.fetchAlerts();
    assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
  });

  it('should NOT remap HeadsUpNotice (cat 10 with different title)', async () => {
    globalThis.fetch = mockFetch(JSON.stringify([HEADSUP_NOTICE_ALERT])) as any;
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
      const alert = { id: '4', cat: '10', title, data: rocketMissilePayload.data, desc: '' };
      globalThis.fetch = mockFetch(JSON.stringify([alert])) as any;
      const result = await client.fetchAlerts();
      assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded), `title "${title}" should be remapped`);
    }
  });
});

describe('OrefClient with real API payloads', () => {
  const originalFetch = globalThis.fetch;
  let client: OrefClient;

  beforeEach(() => {
    client = new OrefClient(3000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should parse real rocket payload correctly', async () => {
    globalThis.fetch = mockFetch(JSON.stringify([ALERT])) as any;
    const result = await client.fetchAlerts();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, '1');
    assert.strictEqual(result[0].title, 'ירי רקטות וטילים');
    assert.ok(result[0].data.includes('פתח תקווה'));
    assert.ok(result[0].data.includes('תל אביב - מזרח'));
    assert.ok(result[0].data.length > 100, `expected many cities, got ${result[0].data.length}`);
  });

  it('should parse real notice payload and NOT remap to EventEnded', async () => {
    globalThis.fetch = mockFetch(JSON.stringify([HEADSUP_NOTICE_ALERT])) as any;
    const result = await client.fetchAlerts();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, '10', 'notice should stay as cat 10 (HeadsUpNotice)');
    assert.ok(result[0].data.includes('פתח תקווה'));
    assert.ok(result[0].data.includes('שילה'));
  });

  it('should parse both payloads together in same response', async () => {
    globalThis.fetch = mockFetch(JSON.stringify([HEADSUP_NOTICE_ALERT, ALERT])) as any;
    const result = await client.fetchAlerts();

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].cat, '10');
    assert.strictEqual(result[1].cat, '1');
  });

  it('should handle real payload with BOM prefix', async () => {
    globalThis.fetch = mockFetch('\uFEFF' + JSON.stringify([ALERT])) as any;
    const result = await client.fetchAlerts();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, '1');
    assert.ok(result[0].data.includes('בני ברק'));
  });

  it('should remap event ended for real payload cities', async () => {
    const eventEnded = makeEventEnded(rocketMissilePayload.data);
    globalThis.fetch = mockFetch(JSON.stringify([eventEnded])) as any;
    const result = await client.fetchAlerts();

    assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
    assert.ok(result[0].data.includes('פתח תקווה'));
  });

  it('should handle full real-world API sequence: notice → rocket → event ended', async () => {
    // Step 1: Notice
    globalThis.fetch = mockFetch(JSON.stringify([HEADSUP_NOTICE_ALERT])) as any;
    let result = await client.fetchAlerts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, '10');

    // Step 2: Both notice + rocket
    globalThis.fetch = mockFetch(JSON.stringify([HEADSUP_NOTICE_ALERT, ALERT])) as any;
    result = await client.fetchAlerts();
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].cat, '10');
    assert.strictEqual(result[1].cat, '1');

    // Step 3: Empty (alert disappears from API)
    globalThis.fetch = mockFetch('') as any;
    result = await client.fetchAlerts();
    assert.deepStrictEqual(result, []);

    // Step 4: Event Ended
    globalThis.fetch = mockFetch(JSON.stringify([makeEventEnded(rocketMissilePayload.data)])) as any;
    result = await client.fetchAlerts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, String(OrefCategory.EventEnded));
  });
});
