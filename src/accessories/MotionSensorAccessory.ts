import { PlatformAccessory, Service } from 'homebridge';
import { AlertState } from '../types';
import type { RedAlertPlatform } from '../RedAlertPlatform';
import { AlertAccessory } from '../services/SensorFilter';

export class MotionSensorAccessory implements AlertAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: RedAlertPlatform,
    accessory: PlatformAccessory,
    private readonly name: string,
  ) {
    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'toharush')
      .setCharacteristic(this.platform.Characteristic.Model, 'Red Alert Motion Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `RA-${name.replace(/\s+/g, '-').toUpperCase()}`);

    this.service =
      accessory.getService(this.platform.Service.MotionSensor) ||
      accessory.addService(this.platform.Service.MotionSensor, name, 'alerts');
  }

  updateAlertState(state: AlertState): void {
    const current = this.service.getCharacteristic(this.platform.Characteristic.MotionDetected).value as boolean;

    if (state.isActive && !current) {
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
      this.platform.log.easyDebug(() => `[${this.name}] Sensor ON, active cities: ${JSON.stringify([...state.activeCities.keys()])}`);
    } else if (!state.isActive && current) {
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
      this.platform.log.info(`[${this.name}] All clear - safe to leave shelter`);
    }
  }
}
