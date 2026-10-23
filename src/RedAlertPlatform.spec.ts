import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as hapNodejs from '@homebridge/hap-nodejs';
import { Service, uuid } from '@homebridge/hap-nodejs';
import { RedAlertPlatform } from './RedAlertPlatform';
import { PLATFORM_NAME } from './settings';

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    prefix: 'RedAlert',
  } as any;
}

function createMockAccessory(name: string, id?: string) {
  const services = new Map<string, any>();
  const accessoryUUID = id ?? uuid.generate(`${PLATFORM_NAME}-${name}`);

  const infoService = createMockService();
  services.set(Service.AccessoryInformation.UUID, infoService);

  return {
    UUID: accessoryUUID,
    displayName: name,
    getService(serviceType: any) {
      return services.get(serviceType.UUID) ?? null;
    },
    addService(serviceType: any) {
      const svc = createMockService();
      services.set(serviceType.UUID, svc);
      return svc;
    },
  };
}

function createMockService() {
  return {
    setCharacteristic: mock.fn(function (this: any) {
      return this;
    }),
    getCharacteristic: mock.fn(() => ({ value: false })),
    updateCharacteristic: mock.fn(),
  };
}

function createMockAPI() {
  const listeners: Record<string, Array<() => void>> = {};
  const registered: any[] = [];

  return {
    hap: hapNodejs,
    platformAccessory: class {
      UUID: string;
      displayName: string;
      category?: number;
      _services = new Map<string, any>();
      configureController = mock.fn();
      constructor(name: string, id: string, category?: number) {
        this.UUID = id;
        this.displayName = name;
        this.category = category;
        this._services.set(Service.AccessoryInformation.UUID, createMockService());
      }

      getService(serviceType: any) {
        return this._services.get(serviceType.UUID) ?? null;
      }

      addService(serviceType: any) {
        const svc = createMockService();
        this._services.set(serviceType.UUID, svc);
        return svc;
      }
    },
    on(event: string, cb: () => void) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    registerPlatformAccessories: mock.fn((_p: string, _n: string, accessories: any[]) => {
      registered.push(...accessories);
    }),
    unregisterPlatformAccessories: mock.fn(),
    publishExternalAccessories: mock.fn(),
    emit(event: string) {
      for (const cb of listeners[event] || []) {
        cb();
      }
    },
    _registered: registered,
    user: { configPath: () => '/tmp/test-config.json', storagePath: () => '/tmp' },
  };
}

// didFinishLaunching is async (it loads the Tzofar city map first), so wait for it to settle.
async function launch(api: { emit(event: string): void }) {
  api.emit('didFinishLaunching');
  await new Promise((r) => setTimeout(r, 20));
}

function createConfig(sensors: any[], overrides: Record<string, any> = {}) {
  return {
    platform: 'RedAlert',
    sensors,
    polling_interval: 999999,
    ...overrides,
  } as any;
}

describe('RedAlertPlatform', () => {
  let logger: any;
  let api: ReturnType<typeof createMockAPI>;
  let platform: RedAlertPlatform;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    logger = createMockLogger();
    api = createMockAPI();
    // Mock fetch to prevent real network calls from the polling loop
    globalThis.fetch = mock.fn(() => Promise.resolve(new Response('[]'))) as any;
  });

  afterEach(() => {
    platform?.shutdown();
    globalThis.fetch = originalFetch;
  });

  it('should not register didFinishLaunching when config is invalid', async () => {
    const config = createConfig([]);
    platform = new RedAlertPlatform(logger, config, api as any);

    await launch(api);
    assert.strictEqual(api._registered.length, 0);
  });

  it('should register one accessory per sensor', async () => {
    const config = createConfig([
      { name: 'Home', cities: 'תל אביב' },
      { name: 'Office', cities: 'חיפה' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    await launch(api);

    assert.strictEqual(api._registered.length, 2);
    assert.strictEqual(api._registered[0].displayName, 'Home');
    assert.strictEqual(api._registered[1].displayName, 'Office');
  });

  it('should reuse cached accessories instead of creating new ones', async () => {
    const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
    const cachedAccessory = createMockAccessory('Home');

    platform = new RedAlertPlatform(logger, config, api as any);
    platform.configureAccessory(cachedAccessory as any);
    await launch(api);

    assert.strictEqual(api._registered.length, 0);
  });

  it('should remove stale accessories not in current config', async () => {
    const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
    const staleAccessory = createMockAccessory('Old Sensor', uuid.generate('stale-id'));

    platform = new RedAlertPlatform(logger, config, api as any);
    platform.configureAccessory(staleAccessory as any);
    await launch(api);

    assert.strictEqual(api.unregisterPlatformAccessories.mock.calls.length, 1);
  });

  it('should skip sensors with empty cities', async () => {
    const config = createConfig([
      { name: 'Empty', cities: '' },
      { name: 'Valid', cities: 'תל אביב' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    await launch(api);

    assert.strictEqual(api._registered.length, 1);
    assert.strictEqual(api._registered[0].displayName, 'Valid');
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });

  it('should generate unique UUIDs per sensor name', async () => {
    const config = createConfig([
      { name: 'Home', cities: 'תל אביב' },
      { name: 'Office', cities: 'חיפה' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    await launch(api);

    const uuids = api._registered.map((a: any) => a.UUID);
    assert.strictEqual(new Set(uuids).size, 2);
  });

  it('should not remove cached accessories that match current config', async () => {
    const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
    const cachedAccessory = createMockAccessory('Home');

    platform = new RedAlertPlatform(logger, config, api as any);
    platform.configureAccessory(cachedAccessory as any);
    await launch(api);

    assert.strictEqual(api.unregisterPlatformAccessories.mock.calls.length, 0);
  });

  it('should log error and disable when no sensors configured', async () => {
    const config = { platform: 'RedAlert' } as any;
    platform = new RedAlertPlatform(logger, config, api as any);

    assert.strictEqual(logger.error.mock.calls.length, 1);
  });

  it('should handle multiple sensors with different categories', async () => {
    const config = createConfig([
      { name: 'Rockets Only', cities: 'תל אביב', categories: ['rockets'] },
      { name: 'All Alerts', cities: 'חיפה' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    await launch(api);

    assert.strictEqual(api._registered.length, 2);
  });

  describe('migration: cities format', () => {
    it('should accept cities as array (new format)', async () => {
      const config = createConfig([
        { name: 'Home', cities: ['תל אביב - יפו', 'חיפה'] },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
    });

    it('should migrate comma-separated string to array (legacy format)', async () => {
      const config = createConfig([
        { name: 'Home', cities: 'תל אביב, חיפה' },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
    });

    it('should migrate single city string', async () => {
      const config = createConfig([
        { name: 'Home', cities: 'פתח תקווה' },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
    });

    it('should skip sensors with empty cities array', async () => {
      const config = createConfig([
        { name: 'Empty', cities: [] },
        { name: 'Valid', cities: ['תל אביב - יפו'] },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
      assert.strictEqual(api._registered[0].displayName, 'Valid');
    });

    it('should skip sensors with empty string cities (legacy)', async () => {
      const config = createConfig([
        { name: 'Empty', cities: '' },
        { name: 'Valid', cities: 'חיפה' },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
      assert.strictEqual(api._registered[0].displayName, 'Valid');
    });

    it('should handle whitespace-only legacy string', async () => {
      const config = createConfig([
        { name: 'Whitespace', cities: '  ,  , ' },
        { name: 'Valid', cities: ['חיפה'] },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
      assert.strictEqual(api._registered[0].displayName, 'Valid');
    });

    it('should trim whitespace from legacy comma-separated cities', async () => {
      const config = createConfig([
        { name: 'Home', cities: '  תל אביב  ,  חיפה  ' },
      ]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api._registered.length, 1);
    });
  });

  describe('Apple TV alerts', () => {
    it('publishes one external video doorbell when enabled', async () => {
      const config = createConfig([{ name: 'Home', cities: 'תל אביב' }], { apple_tv_alerts: true });
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api.publishExternalAccessories.mock.calls.length, 1);
      const [plugin, accessories] = api.publishExternalAccessories.mock.calls[0].arguments as any[];
      assert.strictEqual(plugin, '@toharush/homebridge-redalert');
      assert.strictEqual(accessories.length, 1);
      assert.strictEqual(accessories[0].category, 18);
      assert.strictEqual(accessories[0].displayName, 'Red Alert TV');
      assert.ok(!api._registered.includes(accessories[0]), 'not registered as a bridged accessory');
      assert.strictEqual(api._registered.length, 1, 'only the sensor is bridged');
    });

    it('uses the configured doorbell name', async () => {
      const config = createConfig([{ name: 'Home', cities: 'תל אביב' }], { apple_tv_alerts: true, apple_tv_name: 'Salon TV' });
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      const [, accessories] = api.publishExternalAccessories.mock.calls[0].arguments as any[];
      assert.strictEqual(accessories[0].displayName, 'Salon TV');
    });

    it('does not publish anything when disabled', async () => {
      const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
      platform = new RedAlertPlatform(logger, config, api as any);
      await launch(api);

      assert.strictEqual(api.publishExternalAccessories.mock.calls.length, 0);
    });
  });
});
