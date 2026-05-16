import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HealthCheckAccessory } from './HealthCheckAccessory';

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    prefix: '',
    easyDebug: mock.fn(),
  } as any;
}

function createMockHomekit() {
  return {
    Service: {
      AccessoryInformation: 'AccessoryInformation',
      Switch: 'Switch',
    },
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      On: 'On',
    },
  } as any;
}

function createMockPlatformAccessory() {
  let switchValue = true;
  const infoService = {
    setCharacteristic: mock.fn(function (this: any) {
      return this;
    }),
  };
  const switchService = {
    getCharacteristic: mock.fn(() => ({ onSet: mock.fn(), value: switchValue })),
    updateCharacteristic: mock.fn((_char: any, value: boolean) => {
      switchValue = value;
    }),
  };

  return {
    accessory: {
      getService(type: any) {
        if (type === 'AccessoryInformation') {
          return infoService;
        }
        if (type === 'Switch') {
          return switchService;
        }
        return null;
      },
      addService() {
        return switchService;
      },
    } as any,
    switchService,
    getSwitchValue: () => switchValue,
  };
}

describe('HealthCheckAccessory', () => {
  let log: any;

  beforeEach(() => {
    log = createMockLogger();
  });

  it('should start as healthy (switch ON)', () => {
    const { accessory, getSwitchValue } = createMockPlatformAccessory();
    new HealthCheckAccessory(log, createMockHomekit(), accessory);

    assert.strictEqual(getSwitchValue(), true);
  });

  it('should turn OFF when unhealthy', () => {
    const { accessory, getSwitchValue } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth([{ name: 'test', type: 'http', healthy: false }]);

    assert.strictEqual(getSwitchValue(), false);
  });

  it('should turn ON when recovering', () => {
    const { accessory, getSwitchValue } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth([{ name: 'test', type: 'http', healthy: false }]);
    assert.strictEqual(getSwitchValue(), false);

    health.updateHealth([{ name: 'test', type: 'http', healthy: true }]);
    assert.strictEqual(getSwitchValue(), true);
  });

  it('should log warning when unhealthy', () => {
    const { accessory } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth([{ name: 'test', type: 'http', healthy: false }]);

    assert.strictEqual(log.warn.mock.calls.length, 1);
    assert.ok(log.warn.mock.calls[0].arguments[0].includes('UNREACHABLE'));
  });

  it('should log info when recovering', () => {
    const { accessory } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth([{ name: 'test', type: 'http', healthy: true }]);

    assert.strictEqual(log.info.mock.calls.length, 1);
    assert.ok(log.info.mock.calls[0].arguments[0].includes('reachable'));
  });
});
