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
import { EVENT_ENDED_TITLE, OrefRealtimeAlert } from '../types';

// End-to-end over a *generic* custom HTTP source (the path `custom_sources` +
// mock-server.ts use): real HttpSource.fetchGeneric → normalizeAlerts → dedup /
// expiry → SensorFilter → DoorbellNotifier. Only `fetch` is faked.

const log = {
  info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn(),
  log: mock.fn(), success: mock.fn(), easyDebug: mock.fn(), prefix: '',
} as any;

const originalFetch = globalThis.fetch;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CITY = 'חיפה';

function serve(get: () => OrefRealtimeAlert[]) {
  globalThis.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => get() })) as any;
}

function setup(mapping: Record<string, any>) {
  const events: WebhookPayload[] = [];
  const rings: number[] = [];
  const doorbell = new DoorbellNotifier(() => rings.push(Date.now()), 0);
  const sensor = {
    active: false,
    updateAlertState(s: { isActive: boolean }) {
      this.active = s.isActive;
    },
  };
  const pipeline = new AlertPipeline(log);
  pipeline.addStage(new DeduplicationStage(30000));
  pipeline.addStage(new ExpiryStage(1800000));
  pipeline.addSource(new HttpSource(log, {
    name: 'mock', url: 'http://mock/alerts', pollingInterval: 5, requestTimeout: 1000, failureThreshold: 1, categoryMapping: mapping,
  }));
  pipeline.subscribe(new SensorFilter('Home', log, sensor, [CITY], new Set([1, 8]), false,
    CompositeNotifier.of({ fire: (p) => events.push(p) }, doorbell)));
  return { events, rings, doorbell, sensor, pipeline };
}

describe('custom HTTP source — event ended reaches sensors and the Apple TV doorbell', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const [label, endCat] of [['Oref format (cat 10)', '10'], ['mock / synthetic format (cat 99)', '99']] as const) {
    it(`${label}: ends the alert, empties the doorbell, and a re-fire rings with a new version`, async () => {
      // Mapping as the config UI produces it: no way to select "eventended".
      const t = setup({ '1': 'rockets', '10': 'warning' });
      let body: OrefRealtimeAlert[] = [{ id: 'a', cat: '1', title: 'ירי רקטות וטילים', data: [CITY], desc: '' }];
      serve(() => body);
      t.pipeline.start();
      try {
        await wait(60);
        assert.strictEqual(t.sensor.active, true);
        assert.strictEqual(t.rings.length, 1);
        const v1 = t.doorbell.snapshot().version;

        body = [{ id: 'e', cat: endCat, title: EVENT_ENDED_TITLE, data: [CITY], desc: '' }];
        await wait(60);
        assert.strictEqual(t.sensor.active, false, 'sensor clears on event ended');
        assert.strictEqual(t.doorbell.snapshot().active.size, 0, 'doorbell clears, so the snapshot falls back');
        assert.deepStrictEqual(t.events.map((e) => e.event), ['alert', 'ended'], 'end must not re-arm as a warning');

        body = [{ id: 'b', cat: '1', title: 'ירי רקטות וטילים', data: [CITY], desc: '' }];
        await wait(60);
        assert.strictEqual(t.sensor.active, true);
        assert.strictEqual(t.rings.length, 2, 're-fire after end rings again');
        assert.ok(t.doorbell.snapshot().version > v1 + 1, 'version bumped for end and re-fire');
      } finally {
        t.pipeline.stop();
        t.doorbell.destroy();
      }
    });
  }

  it('an alert that merely disappears from the feed does not end it (only event-ended / expiry do)', async () => {
    const t = setup({ '1': 'rockets' });
    let body: OrefRealtimeAlert[] = [{ id: 'a', cat: '1', title: 'ירי רקטות וטילים', data: [CITY], desc: '' }];
    serve(() => body);
    t.pipeline.start();
    try {
      await wait(60);
      body = [];
      await wait(60);
      assert.strictEqual(t.sensor.active, true, 'Oref empties alerts.json long before the all-clear');
      assert.strictEqual(t.doorbell.snapshot().active.size, 1);
    } finally {
      t.pipeline.stop();
      t.doorbell.destroy();
    }
  });
});
