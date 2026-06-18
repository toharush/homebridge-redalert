import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from './AlertPipeline';
import { DeduplicationStage } from './DeduplicationStage';
import { ExpiryStage } from './ExpiryStage';
import { OrefCategory } from '../types';

function createLogger() {
  return {
    info: mock.fn(), warn: mock.fn(), error: mock.fn(),
    debug: mock.fn(), log: mock.fn(), success: mock.fn(),
    easyDebug: mock.fn(), prefix: '',
  } as any;
}

const EVENT_ENDED = String(OrefCategory.EventEnded);

describe('ExpiryStage + DeduplicationStage interaction', () => {
  const realNow = Date.now;
  afterEach(() => {
    Date.now = realNow;
  });

  it('auto-expires a city even after a later alert triggers dedup cleanup', () => {
    // maxAge (2 min) is deliberately larger than dedup's default cleanup horizon
    // (windowMs * 2 = 60s) — the same ratio production runs (30min vs 60s).
    const dedup = new DeduplicationStage(30000);
    const expiry = new ExpiryStage(120000);

    // Assemble via the pipeline so the real wiring runs: addStage(expiry) must
    // raise dedup's retention to cover the expiry horizon.
    const pipeline = new AlertPipeline(createLogger());
    pipeline.addStage(dedup);
    pipeline.addStage(expiry);

    const endedCities = new Set<string>();

    // Drive the two stages in the order AlertPipeline.ingest does:
    // ExpiryStage first, then DeduplicationStage.
    const ingest = (alerts: { id: string; cat: string; title: string; data: string[]; desc: string }[], t: number) => {
      Date.now = () => t;
      const afterExpiry = expiry.process(alerts);
      for (const a of afterExpiry) {
        if (a.cat === EVENT_ENDED) {
          for (const c of a.data) {
            endedCities.add(c);
          }
        }
      }
      dedup.process(afterExpiry);
    };

    const rocket = (city: string, id: string) =>
      ({ id, cat: String(OrefCategory.Rockets), title: 'Rockets', data: [city], desc: '' });

    // t=0: alert for city1 — recorded in `seen` at t=0.
    ingest([rocket('city1', 'a1')], 0);

    // t=70s: a brand-new alert for city2 arrives. With the bug, this non-empty
    // batch makes DeduplicationStage.cleanup() purge everything older than 60s —
    // including city1 — before expiry can ever act on it.
    ingest([rocket('city2', 'a2')], 70000);

    // Quiet period afterwards (empty polls, like OREF's 1s heartbeat) carrying us
    // past city1's 2-minute expiry horizon.
    for (let t = 100000; t <= 220000; t += 30000) {
      ingest([], t);
    }

    assert.ok(
      endedCities.has('city1'),
      'city1 must auto-expire (synthetic Event-Ended) even though a later alert triggered dedup cleanup',
    );
  });
});
