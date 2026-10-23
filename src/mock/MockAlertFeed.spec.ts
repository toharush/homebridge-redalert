import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { MockAlertFeed, MockEntry } from './MockAlertFeed.mock';

// The state behind `npm run mock`. These pin the per-city behaviour the
// HTTP/WS endpoints serve: the old single-slot mock dropped the previous
// alert's cities on every fire, so they could never be ended.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alertCities = (body: MockEntry[]) => body.filter((e) => e.cat !== '10').flatMap((e) => e.data).sort();
const endedCities = (body: MockEntry[]) => body.filter((e) => e.cat === '10').flatMap((e) => e.data).sort();

describe('MockAlertFeed (mock-server state)', () => {
  let feed: MockAlertFeed;
  afterEach(() => feed?.destroy());

  it('a second single-city fire adds to the active set instead of replacing it', () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    feed.fire(['חיפה'], 'rockets', 30000);
    feed.fire(['עכו'], 'rockets', 30000);
    assert.deepStrictEqual(alertCities(feed.alerts()), ['חיפה', 'עכו'].sort());
    assert.deepStrictEqual(feed.status()?.cities.sort(), ['חיפה', 'עכו'].sort());
  });

  it('End all ends every active city, including ones from earlier fires', () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    feed.fire(['חיפה'], 'rockets', 30000);
    feed.fire(['עכו'], 'uav', 30000);
    assert.deepStrictEqual(feed.end().sort(), ['חיפה', 'עכו'].sort());
    const body = feed.alerts();
    assert.deepStrictEqual(alertCities(body), []);
    assert.deepStrictEqual(endedCities(body), ['חיפה', 'עכו'].sort());
    assert.deepStrictEqual(body.find((e) => e.cat === '10')?.title, 'האירוע הסתיים', 'Oref all-clear format');
    assert.strictEqual(feed.status(), null);
  });

  it('ending one city ends only that city', () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    feed.fire(['חיפה', 'עכו'], 'rockets', 30000);
    assert.deepStrictEqual(feed.end(['עכו']), ['עכו']);
    const body = feed.alerts();
    assert.deepStrictEqual(alertCities(body), ['חיפה']);
    assert.deepStrictEqual(endedCities(body), ['עכו']);
  });

  it('serves one entry per category', () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    feed.fire(['חיפה'], 'rockets', 30000);
    feed.fire(['עכו'], 'uav', 30000);
    const body = feed.alerts();
    assert.deepStrictEqual(body.map((e) => [e.cat, e.data]).sort(), [['1', ['חיפה']], ['6', ['עכו']]]);
  });

  it('re-firing an ended city removes it from the all-clear; the TTL drops it later', () => {
    let t = 1000;
    feed = new MockAlertFeed({ endedTtlMs: 500, now: () => t });
    feed.fire(['חיפה', 'עכו'], 'rockets', 30000);
    feed.end();
    feed.fire(['חיפה'], 'rockets', 30000);
    assert.deepStrictEqual(alertCities(feed.alerts()), ['חיפה']);
    assert.deepStrictEqual(endedCities(feed.alerts()), ['עכו'], 'firing חיפה must not drop עכו\'s pending all-clear');
    t += 501;
    assert.deepStrictEqual(endedCities(feed.alerts()), []);
  });

  it('a fire\'s duration ends only the cities it still owns', async () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    feed.fire(['חיפה', 'עכו'], 'rockets', 30);
    feed.fire(['עכו'], 'rockets', 60000); // refreshed by a later fire
    await wait(60);
    assert.deepStrictEqual(alertCities(feed.alerts()), ['עכו']);
    assert.deepStrictEqual(endedCities(feed.alerts()), ['חיפה']);
  });

  it('category "eventended" ends the given cities (even ones the mock no longer knows)', () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    feed.fire(['חיפה', 'עכו'], 'rockets', 30000);
    const r = feed.fire(['חיפה', 'נהריה'], 'eventended', 30000);
    assert.ok(r.ok);
    assert.deepStrictEqual(alertCities(feed.alerts()), ['עכו']);
    assert.deepStrictEqual(endedCities(feed.alerts()), ['חיפה', 'נהריה'].sort());
  });

  it('WS: broadcasts alerts and ends for ws/both cities only; ws-only cities stay off /alerts', () => {
    const sent: MockEntry[][] = [];
    feed = new MockAlertFeed({ endedTtlMs: 60000, broadcast: (m) => sent.push(m) });
    feed.fire(['חיפה'], 'rockets', 30000, 'ws');
    feed.fire(['עכו'], 'rockets', 30000, 'http');
    assert.deepStrictEqual(alertCities(feed.alerts()), ['עכו']);
    feed.end();
    assert.deepStrictEqual(endedCities(feed.alerts()), ['עכו']);
    assert.deepStrictEqual(sent.map((m) => [m[0].cat, m[0].data]), [['1', ['חיפה']], ['99', ['חיפה']]]);
  });

  it('rejects empty and blank city lists and trims names', () => {
    feed = new MockAlertFeed({ endedTtlMs: 60000 });
    assert.strictEqual(feed.fire([], 'rockets', 30000).ok, false);
    assert.strictEqual(feed.fire(['  ', ''], 'rockets', 30000).ok, false);
    feed.fire([' חיפה '], 'rockets', 30000);
    assert.deepStrictEqual(alertCities(feed.alerts()), ['חיפה']);
  });
});
