import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { CompositeNotifier } from './AlertNotifier';
import { WebhookPayload } from './WebhookService';

const payload: WebhookPayload = { event: 'alert', sensor: 'Home', city: 'חיפה - מפרץ', title: 'Threat 0', timestamp: 1, category: 1 };

describe('CompositeNotifier', () => {
  it('returns null when no notifier is given', () => {
    assert.strictEqual(CompositeNotifier.of(), null);
    assert.strictEqual(CompositeNotifier.of(null, undefined), null);
  });

  it('returns the only child itself, with no wrapper', () => {
    const only = { fire: mock.fn() };
    assert.strictEqual(CompositeNotifier.of(null, only), only);
  });

  it('fans one event out to every child', () => {
    const a = { fire: mock.fn() };
    const b = { fire: mock.fn() };
    CompositeNotifier.of(a, b)!.fire(payload);

    assert.strictEqual(a.fire.mock.calls.length, 1);
    assert.strictEqual(b.fire.mock.calls.length, 1);
    assert.strictEqual(b.fire.mock.calls[0].arguments[0], payload);
  });

  it('keeps notifying the others when one child throws', () => {
    const bad = {
      fire: mock.fn(() => {
        throw new Error('boom');
      }),
    };
    const good = { fire: mock.fn() };
    const composite = CompositeNotifier.of(bad, good)!;

    assert.doesNotThrow(() => composite.fire(payload));
    assert.strictEqual(good.fire.mock.calls.length, 1);
  });
});
