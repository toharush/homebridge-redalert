import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MotionSensorAccessory } from './MotionSensorAccessory';
import { AlertState } from '../types';

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
      MotionSensor: 'MotionSensor',
    },
    Characteristic: {
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      MotionDetected: 'MotionDetected',
    },
  } as any;
}

function createMockPlatformAccessory() {
  let motionValue = false;
  const infoService = {
    setCharacteristic: mock.fn(function (this: any) { return this; }),
  };
  const motionService = {
    getCharacteristic: mock.fn(() => ({ value: motionValue })),
    updateCharacteristic: mock.fn((_char: any, value: boolean) => { motionValue = value; }),
  };

  return {
    accessory: {
      getService(type: any) {
        if (type === 'AccessoryInformation') return infoService;
        if (type === 'MotionSensor') return motionService;
        return null;
      },
      addService() { return motionService; },
    } as any,
    motionService,
    getMotionValue: () => motionValue,
  };
}

function activeState(cities: string[]): AlertState {
  const map = new Map<string, number>();
  for (const city of cities) map.set(city, Date.now());
  return { isActive: true, activeCities: map };
}

function inactiveState(): AlertState {
  return { isActive: false, activeCities: new Map() };
}

describe('MotionSensorAccessory', () => {
  let log: any;

  beforeEach(() => {
    log = createMockLogger();
  });

  describe('without turnoff delay', () => {
    it('should turn on when alert is active', () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory);

      sensor.updateAlertState(activeState(['תל אביב']));

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[0].arguments[1], true);
    });

    it('should turn off immediately when alert clears', () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 2);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[1].arguments[1], false);
    });

    it('should not update when state has not changed', () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory);

      sensor.updateAlertState(inactiveState());

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 0);
    });

    it('should not update when already active and receiving active again', () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(activeState(['תל אביב']));

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1);
    });
  });

  describe('with turnoff delay', () => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    afterEach(() => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    });

    it('should not turn off immediately when alert clears', () => {
      const { accessory, motionService, getMotionValue } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 5000);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());

      // Should only have the ON call, not OFF yet
      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1);
      assert.strictEqual(getMotionValue(), true);
    });

    it('should turn off after the delay expires', async () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 50);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1);

      await new Promise((r) => setTimeout(r, 100));

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 2);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[1].arguments[1], false);
    });

    it('should cancel delayed turn-off when new alert arrives', async () => {
      const { accessory, motionService, getMotionValue } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 50);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());

      // New alert arrives during delay
      sensor.updateAlertState(activeState(['חיפה']));

      await new Promise((r) => setTimeout(r, 100));

      // Should still be on - the delayed off was cancelled
      assert.strictEqual(getMotionValue(), true);
      // Only the initial ON call (no OFF was fired)
      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1);
    });

    it('should not start multiple timers for repeated inactive states', async () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 50);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());
      sensor.updateAlertState(inactiveState());
      sensor.updateAlertState(inactiveState());

      await new Promise((r) => setTimeout(r, 100));

      // Should have exactly ON + OFF
      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 2);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[1].arguments[1], false);
    });

    it('should log delayed turn-off message', () => {
      const { accessory } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 5000);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());

      assert.strictEqual(log.info.mock.calls.length, 1);
      assert.ok(log.info.mock.calls[0].arguments[0].includes('turning off in 5s'));
    });

    it('should log cancellation when alert re-activates during delay', () => {
      const { accessory } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 5000);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());
      sensor.updateAlertState(activeState(['חיפה']));

      assert.strictEqual(log.easyDebug.mock.calls.length >= 1, true);
    });

    it('should handle alert arriving exactly when turnoff delay expires', async () => {
      const { accessory, motionService, getMotionValue } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 50);

      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());

      // Wait almost until delay expires, then send new alert
      await new Promise((r) => setTimeout(r, 40));
      sensor.updateAlertState(activeState(['חיפה']));

      // Wait past the original delay
      await new Promise((r) => setTimeout(r, 30));

      // Should still be ON — delay was cancelled by new alert
      assert.strictEqual(getMotionValue(), true);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1); // only initial ON
    });

    it('should handle event ended then new alert then event ended during turnoff delay', async () => {
      const { accessory, motionService, getMotionValue } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 50);

      // Alert ON
      sensor.updateAlertState(activeState(['תל אביב']));
      assert.strictEqual(getMotionValue(), true);

      // Event ended — starts turnoff delay
      sensor.updateAlertState(inactiveState());

      // New alert during delay — cancels turnoff
      sensor.updateAlertState(activeState(['חיפה']));

      // Second event ended — starts new turnoff delay
      sensor.updateAlertState(inactiveState());

      await new Promise((r) => setTimeout(r, 100));

      // Should have turned off after second delay
      assert.strictEqual(getMotionValue(), false);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 2); // ON + OFF
    });

    it('should handle rapid ON/OFF/ON/OFF without waiting for timers', async () => {
      const { accessory, motionService, getMotionValue } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 50);

      // Rapid toggles without waiting
      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());
      sensor.updateAlertState(activeState(['חיפה']));
      sensor.updateAlertState(inactiveState());
      sensor.updateAlertState(activeState(['באר שבע']));

      // Should be ON — last state was active
      assert.strictEqual(getMotionValue(), true);

      // Wait for any pending timers
      await new Promise((r) => setTimeout(r, 100));

      // Should still be ON — last active cancelled the delay
      assert.strictEqual(getMotionValue(), true);
      // ON was called once (initial), delays were cancelled by re-activations
      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 1);
    });

    it('should handle full cycle: on -> delayed off -> on -> delayed off', async () => {
      const { accessory, motionService } = createMockPlatformAccessory();
      const sensor = new MotionSensorAccessory(log, 'Test', createMockHomekit(), accessory, 30);

      // First cycle
      sensor.updateAlertState(activeState(['תל אביב']));
      sensor.updateAlertState(inactiveState());
      await new Promise((r) => setTimeout(r, 60));

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 2);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[1].arguments[1], false);

      // Second cycle
      sensor.updateAlertState(activeState(['חיפה']));
      sensor.updateAlertState(inactiveState());
      await new Promise((r) => setTimeout(r, 60));

      assert.strictEqual(motionService.updateCharacteristic.mock.calls.length, 4);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[2].arguments[1], true);
      assert.strictEqual(motionService.updateCharacteristic.mock.calls[3].arguments[1], false);
    });
  });
});
