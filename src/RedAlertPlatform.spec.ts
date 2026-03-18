import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Service, Characteristic, uuid } from 'hap-nodejs';
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
    hap: { Service, Characteristic, uuid },
    platformAccessory: class {
      UUID: string;
      displayName: string;
      _services = new Map<string, any>();
      constructor(name: string, id: string) {
        this.UUID = id;
        this.displayName = name;
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
    emit(event: string) {
      for (const cb of listeners[event] || []) {
        cb();
      }
    },
    _registered: registered,
  };
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

  it('should not register didFinishLaunching when config is invalid', () => {
    const config = createConfig([]);
    platform = new RedAlertPlatform(logger, config, api as any);

    api.emit('didFinishLaunching');
    assert.strictEqual(api._registered.length, 0);
  });

  it('should register one accessory per sensor', () => {
    const config = createConfig([
      { name: 'Home', cities: 'תל אביב' },
      { name: 'Office', cities: 'חיפה' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    api.emit('didFinishLaunching');

    assert.strictEqual(api._registered.length, 2);
    assert.strictEqual(api._registered[0].displayName, 'Home');
    assert.strictEqual(api._registered[1].displayName, 'Office');
  });

  it('should reuse cached accessories instead of creating new ones', () => {
    const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
    const cachedAccessory = createMockAccessory('Home');

    platform = new RedAlertPlatform(logger, config, api as any);
    platform.configureAccessory(cachedAccessory as any);
    api.emit('didFinishLaunching');

    assert.strictEqual(api._registered.length, 0);
  });

  it('should remove stale accessories not in current config', () => {
    const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
    const staleAccessory = createMockAccessory('Old Sensor', uuid.generate('stale-id'));

    platform = new RedAlertPlatform(logger, config, api as any);
    platform.configureAccessory(staleAccessory as any);
    api.emit('didFinishLaunching');

    assert.strictEqual(api.unregisterPlatformAccessories.mock.calls.length, 1);
  });

  it('should skip sensors with empty cities', () => {
    const config = createConfig([
      { name: 'Empty', cities: '' },
      { name: 'Valid', cities: 'תל אביב' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    api.emit('didFinishLaunching');

    assert.strictEqual(api._registered.length, 1);
    assert.strictEqual(api._registered[0].displayName, 'Valid');
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });

  it('should generate unique UUIDs per sensor name', () => {
    const config = createConfig([
      { name: 'Home', cities: 'תל אביב' },
      { name: 'Office', cities: 'חיפה' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    api.emit('didFinishLaunching');

    const uuids = api._registered.map((a: any) => a.UUID);
    assert.strictEqual(new Set(uuids).size, 2);
  });

  it('should not remove cached accessories that match current config', () => {
    const config = createConfig([{ name: 'Home', cities: 'תל אביב' }]);
    const cachedAccessory = createMockAccessory('Home');

    platform = new RedAlertPlatform(logger, config, api as any);
    platform.configureAccessory(cachedAccessory as any);
    api.emit('didFinishLaunching');

    assert.strictEqual(api.unregisterPlatformAccessories.mock.calls.length, 0);
  });

  it('should log error and disable when no sensors configured', () => {
    const config = { platform: 'RedAlert' } as any;
    platform = new RedAlertPlatform(logger, config, api as any);

    assert.strictEqual(logger.error.mock.calls.length, 1);
  });

  it('should handle multiple sensors with different categories', () => {
    const config = createConfig([
      { name: 'Rockets Only', cities: 'תל אביב', categories: ['rockets'] },
      { name: 'All Alerts', cities: 'חיפה' },
    ]);
    platform = new RedAlertPlatform(logger, config, api as any);
    api.emit('didFinishLaunching');

    assert.strictEqual(api._registered.length, 2);
  });
});
