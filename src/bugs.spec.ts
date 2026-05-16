import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { DeduplicationStage } from './pipeline/DeduplicationStage';
import { AlertHistory } from './pipeline/AlertHistory';
import { OrefClient } from './clients/orefClient';

// ---------------------------------------------------------------------------
// BUG #1 — Dedup window boundary
// Fixed-window buckets (now / windowMs | 0) allow duplicates at boundaries.
// Sliding window: drop if same city+cat seen within windowMs of last pass.
// ---------------------------------------------------------------------------

describe('BUG #1: Dedup sliding window', () => {
  it('should drop duplicate even when crossing a fixed-window boundary', () => {
    const stage = new DeduplicationStage(30000);
    const alert1 = { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };
    const alert2 = { id: '2', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };

    const realNow = Date.now;
    const boundaryTime = 30000 * 1000;
    let currentTime = boundaryTime - 1;
    Date.now = () => currentTime;

    const result1 = stage.process([alert1], 'SourceA');
    assert.strictEqual(result1.length, 1, 'First alert should pass');

    currentTime = boundaryTime + 1;
    const result2 = stage.process([alert2], 'SourceB');
    assert.strictEqual(result2.length, 0, 'Second alert 2ms later must be DROPPED');

    Date.now = realNow;
  });

  it('should allow same city+cat after the window expires', () => {
    const stage = new DeduplicationStage(30000);
    const alert = { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };

    const realNow = Date.now;
    let currentTime = 100000;
    Date.now = () => currentTime;

    const result1 = stage.process([alert], 'SourceA');
    assert.strictEqual(result1.length, 1);

    currentTime += 31000;
    const result2 = stage.process([alert], 'SourceA');
    assert.strictEqual(result2.length, 1, 'Alert after window expiry should pass');

    Date.now = realNow;
  });

  it('should drop at 15s into a 30s window (mid-window duplicate)', () => {
    const stage = new DeduplicationStage(30000);
    const alert = { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };

    const realNow = Date.now;
    let currentTime = 100000;
    Date.now = () => currentTime;

    stage.process([alert], 'SourceA');

    currentTime += 15000;
    const result = stage.process([alert], 'SourceB');
    assert.strictEqual(result.length, 0, '15s later is still within 30s window — must drop');

    Date.now = realNow;
  });
});

// ---------------------------------------------------------------------------
// BUG #2 — OREF client returns [] on HTTP errors instead of throwing
// HttpSource.catch() never fires → health check never triggers.
// ---------------------------------------------------------------------------

describe('BUG #2: OrefClient should throw on HTTP errors', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should throw on HTTP 500', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      ok: false, status: 500,
      text: () => Promise.resolve('Server Error'),
    })) as any;

    const client = new OrefClient(3000);
    await assert.rejects(
      () => client.fetchAlerts(),
      (err: Error) => err.message.includes('500'),
      'Must throw on HTTP 500 so HttpSource tracks failures',
    );
  });

  it('should throw on HTTP 403', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      ok: false, status: 403,
      text: () => Promise.resolve('Forbidden'),
    })) as any;

    const client = new OrefClient(3000);
    await assert.rejects(
      () => client.fetchAlerts(),
      (err: Error) => err.message.includes('403'),
      'Must throw on HTTP 403 so HttpSource tracks failures',
    );
  });

  it('should throw on malformed JSON', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve('not valid json{{{'),
    })) as any;

    const client = new OrefClient(3000);
    await assert.rejects(
      () => client.fetchAlerts(),
      'Must throw on invalid JSON so HttpSource tracks failures',
    );
  });
});

// ---------------------------------------------------------------------------
// BUG #6 — Invalid webhooks not filtered before passing to WebhookService
// ---------------------------------------------------------------------------

describe('BUG #6: Invalid webhooks should be filtered out', () => {
  it('should not fire for webhooks with empty URL', async () => {
    const { WebhookService } = await import('./services/WebhookService');

    const log = {
      info: mock.fn(), warn: mock.fn(), error: mock.fn(),
      debug: mock.fn(), log: mock.fn(), success: mock.fn(),
      easyDebug: mock.fn(), prefix: '',
    } as any;

    const configs = [
      { url: '' },
      { url: '   ' },
      { url: 'https://valid.example.com/hook' },
    ];

    const service = new WebhookService(configs, log);

    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = mock.fn((url: string) => {
      fetchCalls.push(url);
      return Promise.resolve({ ok: true });
    }) as any;

    service.fire({
      event: 'alert', sensor: 'Home', city: 'test', title: 'Test', timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(fetchCalls.length, 1, 'Only valid webhook should fire');
    const firedUrl = new URL(fetchCalls[0]);
    assert.strictEqual(firedUrl.hostname, 'valid.example.com');

    globalThis.fetch = originalFetch;
  });
});

// ---------------------------------------------------------------------------
// BUG #7 — History writes every 5s even when unchanged (dirty flag)
// ---------------------------------------------------------------------------

describe('BUG #7: History auto-persist', () => {
  it('should persist after add()', () => {
    const history = new AlertHistory(100);
    history.add('test', '1', 'Test', ['city1']);
    assert.strictEqual(history.getAll().length, 1);
  });

  it('should persist after markEnded()', () => {
    const history = new AlertHistory(100);
    history.add('test', '1', 'Test', ['city1']);
    history.markEnded('city1');
    assert.strictEqual(history.getAll()[0].status, 'ended');
  });
});

// ---------------------------------------------------------------------------
// Dedup passed entries should have status: 'active' in history
// ---------------------------------------------------------------------------

describe('Dedup passed entries have status active', () => {
  it('history entries from dedup pass should have status=active', () => {
    const history = new AlertHistory(100);
    const stage = new DeduplicationStage(30000, undefined, history);

    const alert = { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };
    stage.process([alert], 'Pikud HaOref');

    const entries = history.getAll();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].status, 'active');
  });

  it('markEnded should mark entries regardless of source name', () => {
    const history = new AlertHistory(100);
    history.add('Pikud HaOref', '1', 'Rockets', ['city1']);

    const result = history.markEnded('city1');
    assert.ok(result);
    assert.strictEqual(history.getAll()[0].status, 'ended');
  });

  it('should NOT create duplicate active entries — just refresh timestamp', () => {
    const history = new AlertHistory(100);
    const stage = new DeduplicationStage(30000, undefined, history);

    const alert = { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };
    const realNow = Date.now;
    let currentTime = 100000;
    Date.now = () => currentTime;

    stage.process([alert], 'Pikud HaOref');
    assert.strictEqual(history.getAll().length, 1);

    currentTime += 31000;
    stage.process([alert], 'Pikud HaOref');

    assert.strictEqual(history.getAll().length, 1, 'Should still be 1 entry — updated, not duplicated');
    assert.strictEqual(history.getAll()[0].timestamp, currentTime, 'Timestamp should be refreshed');

    Date.now = realNow;
  });
});
