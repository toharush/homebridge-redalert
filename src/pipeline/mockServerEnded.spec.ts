import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from './AlertPipeline';
import { DeduplicationStage } from './DeduplicationStage';
import { ExpiryStage } from './ExpiryStage';
import { HttpSource } from '../clients/httpSource';
import { SensorFilter } from '../services/SensorFilter';
import { CompositeNotifier } from '../services/AlertNotifier';
import { DoorbellNotifier } from '../notifiers/DoorbellNotifier';
import { WebhookPayload } from '../services/WebhookService';
import { MockAlertFeed } from '../mock/MockAlertFeed.mock';

// `npm run mock` end to end: the /alerts bodies the mock server really serves
// (MockAlertFeed) → real HttpSource.fetchGeneric → normalizeAlerts → dedup /
// expiry → SensorFilter → DoorbellNotifier. Only `fetch` is faked.
//
// Regression: the mock kept one alert slot. Firing a single city and then
// another single city replaced the first, so End only ended the last one and
// the first stayed on in HomeKit and on the doorbell picture, and re-firing it
// never rang (it was still "active"). Firing several cities at once and
// ending them together worked, which is why it looked like a one-city bug.

const log = {
  info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn(),
  log: mock.fn(), success: mock.fn(), easyDebug: mock.fn(), prefix: '',
} as any;

const originalFetch = globalThis.fetch;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HAIFA = 'חיפה';
const AKKO = 'עכו';

function setup(sensorCities: string[]) {
  const feed = new MockAlertFeed({ endedTtlMs: 60000 });
  globalThis.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(feed.alerts())) })) as any;
  const events: WebhookPayload[] = [];
  const rings: number[] = [];
  const doorbell = new DoorbellNotifier(() => rings.push(Date.now()), 0);
  const sensor = { active: false, updateAlertState(s: { isActive: boolean }) {
    this.active = s.isActive;
  } };
  const pipeline = new AlertPipeline(log);
  pipeline.addStage(new DeduplicationStage(30000));
  pipeline.addStage(new ExpiryStage(1800000));
  // As the user configured it: category_field "cat", mapping "1" -> rockets.
  pipeline.addSource(new HttpSource(log, {
    name: 'mock', url: 'http://mock/alerts', pollingInterval: 5, requestTimeout: 1000, failureThreshold: 1,
    categoryMapping: { '1': 'rockets' },
  }));
  pipeline.subscribe(new SensorFilter('Home', log, sensor, sensorCities, new Set([1]), false,
    CompositeNotifier.of({ fire: (p) => events.push(p) }, doorbell)));
  pipeline.start();
  const active = () => [...doorbell.snapshot().active.keys()].sort();
  const stop = () => {
    pipeline.stop();
    doorbell.destroy();
    feed.destroy();
  };
  return { feed, events, rings, doorbell, sensor, active, stop };
}

describe('mock server → plugin: ending alerts', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('one city: fire, End, re-fire rings again', async () => {
    const t = setup([HAIFA]);
    try {
      t.feed.fire([HAIFA], 'rockets', 30000);
      await wait(50);
      assert.deepStrictEqual(t.active(), [`Home|${HAIFA}`]);
      t.feed.end();
      await wait(50);
      assert.strictEqual(t.sensor.active, false);
      assert.deepStrictEqual(t.active(), [], 'doorbell empty, so the snapshot/stream fall back');
      t.feed.fire([HAIFA], 'rockets', 30000);
      await wait(50);
      assert.strictEqual(t.rings.length, 2);
    } finally {
      t.stop();
    }
  });

  it('two single-city fires then End: both end (previously the first stayed on forever)', async () => {
    const t = setup([HAIFA, AKKO]);
    try {
      t.feed.fire([HAIFA], 'rockets', 30000);
      await wait(50);
      t.feed.fire([AKKO], 'rockets', 30000);
      await wait(50);
      assert.deepStrictEqual(t.active(), [`Home|${HAIFA}`, `Home|${AKKO}`].sort());

      t.feed.end();
      await wait(50);
      assert.strictEqual(t.sensor.active, false, 'sensor clears');
      assert.deepStrictEqual(t.active(), [], 'doorbell picture clears');
      assert.deepStrictEqual(t.events.filter((e) => e.event === 'ended').map((e) => e.city).sort(), [HAIFA, AKKO].sort());

      // The first city must be able to ring again.
      const rings = t.rings.length;
      t.feed.fire([HAIFA], 'rockets', 30000);
      await wait(50);
      assert.strictEqual(t.rings.length, rings + 1, 're-fire of the first city rings');
    } finally {
      t.stop();
    }
  });

  it('ending one city leaves the other cities on', async () => {
    const t = setup([HAIFA, AKKO]);
    try {
      t.feed.fire([HAIFA], 'rockets', 30000);
      t.feed.fire([AKKO], 'rockets', 30000);
      await wait(50);
      t.feed.end([AKKO]);
      await wait(50);
      assert.strictEqual(t.sensor.active, true, 'Haifa is still under alert');
      assert.deepStrictEqual(t.active(), [`Home|${HAIFA}`]);
      t.feed.end([HAIFA]);
      await wait(50);
      assert.strictEqual(t.sensor.active, false);
      assert.deepStrictEqual(t.active(), []);
    } finally {
      t.stop();
    }
  });

  it('a fire right after an End keeps the earlier city\'s all-clear on /alerts', async () => {
    const t = setup([HAIFA, AKKO]);
    try {
      t.feed.fire([HAIFA], 'rockets', 30000);
      await wait(50);
      // End and fire in the same tick: no poll in between. The old mock cleared
      // the pending all-clear on fire, so Haifa never saw its end.
      t.feed.end();
      t.feed.fire([AKKO], 'rockets', 30000);
      await wait(50);
      assert.deepStrictEqual(t.active(), [`Home|${AKKO}`]);
    } finally {
      t.stop();
    }
  });
});
