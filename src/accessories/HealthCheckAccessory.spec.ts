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
      ContactSensor: 'ContactSensor',
    },
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      ContactSensorState: 'ContactSensorState',
    },
  } as any;
}

function createMockPlatformAccessory() {
  let contactValue = 0;
  const infoService = {
    setCharacteristic: mock.fn(function (this: any) {
      return this;
    }),
  };
  const contactService = {
    getCharacteristic: mock.fn(() => ({ value: contactValue })),
    updateCharacteristic: mock.fn((_char: any, value: number) => {
      contactValue = value;
    }),
  };

  return {
    accessory: {
      getService(type: any) {
        if (type === 'AccessoryInformation') {
          return infoService;
        }
        if (type === 'ContactSensor') {
          return contactService;
        }
        return null;
      },
      addService() {
        return contactService;
      },
    } as any,
    contactService,
    getContactValue: () => contactValue,
  };
}

describe('HealthCheckAccessory', () => {
  let log: any;

  beforeEach(() => {
    log = createMockLogger();
  });

  it('should start as healthy (CONTACT_DETECTED = 0)', () => {
    const { accessory, getContactValue } = createMockPlatformAccessory();
    new HealthCheckAccessory(log, createMockHomekit(), accessory);

    assert.strictEqual(getContactValue(), 0);
  });

  it('should set CONTACT_NOT_DETECTED (1) when unhealthy', () => {
    const { accessory, getContactValue } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth(false);

    assert.strictEqual(getContactValue(), 1);
  });

  it('should set CONTACT_DETECTED (0) when recovering', () => {
    const { accessory, getContactValue } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth(false);
    assert.strictEqual(getContactValue(), 1);

    health.updateHealth(true);
    assert.strictEqual(getContactValue(), 0);
  });

  it('should log warning when unhealthy', () => {
    const { accessory } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth(false);

    assert.strictEqual(log.warn.mock.calls.length, 1);
    assert.ok(log.warn.mock.calls[0].arguments[0].includes('UNREACHABLE'));
  });

  it('should log info when recovering', () => {
    const { accessory } = createMockPlatformAccessory();
    const health = new HealthCheckAccessory(log, createMockHomekit(), accessory);

    health.updateHealth(true);

    assert.strictEqual(log.info.mock.calls.length, 1);
    assert.ok(log.info.mock.calls[0].arguments[0].includes('reachable'));
  });
});
