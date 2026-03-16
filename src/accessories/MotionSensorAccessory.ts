import { PlatformAccessory, Service } from 'homebridge';
import { AlertState } from '../types';
import type { RedAlertPlatform } from '../RedAlertPlatform';

export class MotionSensorAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: RedAlertPlatform,
    accessory: PlatformAccessory,
  ) {
    this.service =
      accessory.getService(this.platform.Service.MotionSensor) ||
      accessory.addService(this.platform.Service.MotionSensor, 'Red Alert', 'alerts');
  }

  updateAlertState(state: AlertState): void {
    const current = this.service.getCharacteristic(this.platform.Characteristic.MotionDetected).value as boolean;

    if (state.isActive && !current) {
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
      this.platform.log.easyDebug(() => `Sensor ON, active cities: ${JSON.stringify([...state.activeCities.keys()])}`);
    } else if (!state.isActive && current) {
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
      this.platform.log.info('All clear - safe to leave shelter');
    }
  }
}
