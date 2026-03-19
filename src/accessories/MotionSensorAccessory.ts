import { Characteristic, PlatformAccessory, Service } from 'homebridge';
import { AlertState } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertAccessory } from '../services/SensorFilter';

interface HomekitServices {
  Service: typeof Service;
  Characteristic: typeof Characteristic;
}

export class MotionSensorAccessory implements AlertAccessory {
  private readonly service: Service;
  private readonly motionDetected: typeof Characteristic.MotionDetected;
  private turnoffTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly log: DebugLogger,
    private readonly name: string,
    homekit: HomekitServices,
    accessory: PlatformAccessory,
    private readonly turnoffDelay: number = 0,
  ) {
    this.motionDetected = homekit.Characteristic.MotionDetected;

    accessory.getService(homekit.Service.AccessoryInformation)!
      .setCharacteristic(homekit.Characteristic.Manufacturer, 'toharush')
      .setCharacteristic(homekit.Characteristic.Model, 'Red Alert Motion Sensor')
      .setCharacteristic(homekit.Characteristic.SerialNumber, `RA-${name.replace(/\s+/g, '-').toUpperCase()}`);

    this.service =
      accessory.getService(homekit.Service.MotionSensor) ||
      accessory.addService(homekit.Service.MotionSensor, name, 'alerts');
  }

  updateAlertState(state: AlertState): void {
    const current = this.service.getCharacteristic(this.motionDetected).value as boolean;

    if (state.isActive) {
      if (this.turnoffTimer) {
        clearTimeout(this.turnoffTimer);
        this.turnoffTimer = undefined;
        this.log.easyDebug(() => `[${this.name}] Delayed turn-off cancelled, alert still active`);
      }
      if (!current) {
        this.service.updateCharacteristic(this.motionDetected, true);
        this.log.easyDebug(() => `[${this.name}] Sensor ON, active cities: ${JSON.stringify([...state.activeCities.keys()])}`);
      }
    } else if (!state.isActive && current && !this.turnoffTimer) {
      if (this.turnoffDelay > 0) {
        this.log.info(`[${this.name}] All clear - turning off in ${this.turnoffDelay / 1000}s`);
        this.turnoffTimer = setTimeout(() => {
          this.turnoffTimer = undefined;
          this.service.updateCharacteristic(this.motionDetected, false);
          this.log.info(`[${this.name}] All clear - safe to leave shelter`);
        }, this.turnoffDelay);
      } else {
        this.service.updateCharacteristic(this.motionDetected, false);
        this.log.info(`[${this.name}] All clear - safe to leave shelter`);
      }
    }
  }
}
