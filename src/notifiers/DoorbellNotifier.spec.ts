import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { DoorbellNotifier } from './DoorbellNotifier';
import { WebhookPayload } from '../services/WebhookService';

const MIN_RING = 20000;

function alert(city: string, sensor = 'Home'): WebhookPayload {
  return { event: 'alert', sensor, city, title: 'Threat 0', timestamp: Date.now(), category: 1 };
}

function ended(city: string, sensor = 'Home'): WebhookPayload {
  return { event: 'ended', sensor, city, title: 'Event Ended', timestamp: Date.now() };
}

describe('DoorbellNotifier', () => {
  let ring: ReturnType<typeof mock.fn>;
  let notifier: DoorbellNotifier;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'setImmediate', 'Date'], now: 1_000_000 });
    ring = mock.fn();
    notifier = new DoorbellNotifier(ring, MIN_RING);
  });

  afterEach(() => {
    notifier.destroy();
    mock.timers.reset();
  });

  it('does not ring synchronously; rings once after setImmediate', () => {
    notifier.fire(alert('A'));
    notifier.fire(alert('B'));
    assert.strictEqual(ring.mock.calls.length, 0, 'fire() must stay O(1) with no ring');

    mock.timers.tick(0);
    assert.strictEqual(ring.mock.calls.length, 1, 'one ring for the whole batch');
  });

  it('a city inside the cooldown does not ring but bumps the version', () => {
    notifier.fire(alert('A'));
    mock.timers.tick(0);
    const v = notifier.snapshot().version;

    mock.timers.tick(5000);
    notifier.fire(alert('B'));
    mock.timers.tick(0);

    assert.strictEqual(ring.mock.calls.length, 1);
    assert.strictEqual(notifier.snapshot().version, v + 1);
    assert.strictEqual(notifier.snapshot().active.size, 2);
  });

  it('several cities inside the cooldown give exactly one follow-up ring at its end', () => {
    notifier.fire(alert('A'));
    mock.timers.tick(0);

    mock.timers.tick(3000);
    notifier.fire(alert('B'));
    mock.timers.tick(0);
    mock.timers.tick(3000);
    notifier.fire(alert('C'));
    mock.timers.tick(0);
    assert.strictEqual(ring.mock.calls.length, 1);

    mock.timers.tick(MIN_RING - 6000 - 1);
    assert.strictEqual(ring.mock.calls.length, 1, 'not before the cooldown ends');
    mock.timers.tick(1);
    assert.strictEqual(ring.mock.calls.length, 2, 'one follow-up ring');

    mock.timers.tick(MIN_RING * 3);
    assert.strictEqual(ring.mock.calls.length, 2, 'and no more');
  });

  it('rings again on the leading edge once the cooldown has passed', () => {
    notifier.fire(alert('A'));
    mock.timers.tick(0);
    mock.timers.tick(MIN_RING);
    notifier.fire(alert('B'));
    mock.timers.tick(0);
    assert.strictEqual(ring.mock.calls.length, 2);
  });

  it('ended events alone never ring', () => {
    notifier.fire(alert('A'));
    mock.timers.tick(0);
    mock.timers.tick(MIN_RING * 2);

    notifier.fire(ended('A'));
    mock.timers.tick(0);
    mock.timers.tick(MIN_RING * 2);
    assert.strictEqual(ring.mock.calls.length, 1);
    assert.strictEqual(notifier.snapshot().active.size, 0);
  });

  it('ended for a city that was never active is ignored', () => {
    const v = notifier.snapshot().version;
    notifier.fire(ended('X'));
    mock.timers.tick(0);
    assert.strictEqual(notifier.snapshot().version, v);
    assert.strictEqual(ring.mock.calls.length, 0);
  });

  it('no follow-up ring if everything ended before the cooldown ran out', () => {
    notifier.fire(alert('A'));
    mock.timers.tick(0);
    mock.timers.tick(1000);
    notifier.fire(alert('B'));
    mock.timers.tick(0);
    notifier.fire(ended('A'));
    notifier.fire(ended('B'));
    mock.timers.tick(0);

    mock.timers.tick(MIN_RING);
    assert.strictEqual(ring.mock.calls.length, 1);
  });

  it('keys by sensor|city: a repeat from the same sensor is a no-op', () => {
    notifier.fire(alert('A'));
    const v = notifier.snapshot().version;
    notifier.fire(alert('A'));
    assert.strictEqual(notifier.snapshot().version, v);
    assert.strictEqual(notifier.snapshot().active.size, 1);
  });

  it('the same city from two sensors rings once and stays active until both end', () => {
    notifier.fire(alert('A', 'Home'));
    notifier.fire(alert('A', 'Office'));
    mock.timers.tick(0);
    assert.strictEqual(ring.mock.calls.length, 1);

    notifier.fire(ended('A', 'Home'));
    mock.timers.tick(0);
    assert.strictEqual(notifier.snapshot().active.size, 1, 'Office still has it');
  });

  it('destroy() cancels a pending follow-up ring', () => {
    notifier.fire(alert('A'));
    mock.timers.tick(0);
    mock.timers.tick(1000);
    notifier.fire(alert('B'));
    mock.timers.tick(0);
    notifier.destroy();
    mock.timers.tick(MIN_RING);
    assert.strictEqual(ring.mock.calls.length, 1);
  });

  it('destroy() cancels a ring that is still queued in setImmediate', () => {
    notifier.fire(alert('A'));
    notifier.destroy();
    mock.timers.tick(0);
    notifier.fire(alert('B'));
    mock.timers.tick(MIN_RING);
    assert.strictEqual(ring.mock.calls.length, 0);
  });

  it('a ring that throws does not escape the setImmediate (it would crash Homebridge)', () => {
    const throwing = new DoorbellNotifier(() => {
      throw new Error('HAP down');
    }, MIN_RING);
    throwing.fire(alert('A'));
    assert.doesNotThrow(() => mock.timers.tick(0));
    throwing.destroy();
  });
});
