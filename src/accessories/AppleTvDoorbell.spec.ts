import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import * as hapNodejs from '@homebridge/hap-nodejs';
import { AppleTvDoorbell } from './AppleTvDoorbell';
import { AlertRenderer } from '../render/AlertImageRenderer';
import { WebhookPayload } from '../services/WebhookService';
import { PLATFORM_NAME } from '../settings';

function createMockLogger() {
  return { info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn(), easyDebug: mock.fn() } as any;
}

function createMockAPI() {
  const accessories: any[] = [];
  class FakeAccessory {
    info = { setCharacteristic: mock.fn(function (this: any) {
      return this;
    }) };

    configureController = mock.fn();
    constructor(public displayName: string, public UUID: string, public category: number) {
      accessories.push(this);
    }

    getService() {
      return this.info;
    }
  }
  return { hap: hapNodejs, platformAccessory: FakeAccessory, accessories } as any;
}

function alert(city: string): WebhookPayload {
  return { event: 'alert', sensor: 'Home', city, title: 'Threat 0', timestamp: Date.now(), category: 1 };
}

function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('AppleTvDoorbell', () => {
  let tv: AppleTvDoorbell | null = null;

  afterEach(() => {
    tv?.destroy();
    tv = null;
    mock.restoreAll();
  });

  it('builds a video doorbell with a stable UUID and configures the controller', () => {
    const api = createMockAPI();
    const renderer = { fallback: Buffer.alloc(0), idle: Buffer.alloc(0), render: mock.fn(), warmUp: mock.fn(), destroy: mock.fn() };
    tv = new AppleTvDoorbell(createMockLogger(), api, { name: 'Red Alert TV', minRingInterval: 20000, maxCities: 12 }, renderer as any);

    assert.strictEqual(tv.accessory.category, hapNodejs.Categories.VIDEO_DOORBELL);
    assert.strictEqual(tv.accessory.UUID, hapNodejs.uuid.generate(`${PLATFORM_NAME}-appletv-doorbell`));
    const configure = (tv.accessory as any).configureController;
    assert.strictEqual(configure.mock.calls.length, 1);
    assert.ok(configure.mock.calls[0].arguments[0] instanceof hapNodejs.DoorbellController);
  });

  it('a renderer that never finishes does not delay the ring', async () => {
    const order: string[] = [];
    mock.method(hapNodejs.DoorbellController.prototype, 'ringDoorbell', () => order.push('ring'));
    const renderer: AlertRenderer = {
      fallback: Buffer.alloc(0), idle: Buffer.alloc(0),

      render: mock.fn(() => {
        order.push('render');
        return new Promise<Buffer>(() => {}); // hangs forever
      }),
      warmUp: async () => {},
      destroy: () => {},
    };
    tv = new AppleTvDoorbell(createMockLogger(), createMockAPI(), { name: 'TV', minRingInterval: 20000, maxCities: 12 }, renderer);

    // A snapshot request that is stuck in the renderer before the alert arrives.
    (tv as any).delegate.handleSnapshotRequest({ width: 1280, height: 720 }, () => {});
    order.length = 0;

    tv.notifier.fire(alert('A'));
    assert.deepStrictEqual(order, [], 'fire() neither rings nor renders synchronously');

    await tick();
    assert.deepStrictEqual(order, ['ring'], 'the ring goes out before any rendering starts');

    await tick();
    assert.deepStrictEqual(order, ['ring', 'render'], 'the card renders after the ring');
  });

  it('rings again only after the cooldown, however slow rendering is', async () => {
    const ring = mock.method(hapNodejs.DoorbellController.prototype, 'ringDoorbell', () => {});
    const renderer: AlertRenderer = {
      fallback: Buffer.alloc(0), idle: Buffer.alloc(0),

      render: () => new Promise<Buffer>(() => {}),
      warmUp: async () => {},
      destroy: () => {},
    };
    tv = new AppleTvDoorbell(createMockLogger(), createMockAPI(), { name: 'TV', minRingInterval: 20000, maxCities: 12 }, renderer);
    tv.notifier.fire(alert('A'));
    await tick();
    tv.notifier.fire(alert('B'));
    await tick();
    assert.strictEqual(ring.mock.calls.length, 1);
  });

  it('destroy() stops the renderer', () => {
    const renderer = { fallback: Buffer.alloc(0), idle: Buffer.alloc(0), render: mock.fn(), warmUp: mock.fn(), destroy: mock.fn() };
    const options = { name: 'TV', minRingInterval: 20000, maxCities: 12 };
    const doorbell = new AppleTvDoorbell(createMockLogger(), createMockAPI(), options, renderer as any);
    doorbell.destroy();
    assert.strictEqual(renderer.destroy.mock.calls.length, 1);
  });
});
