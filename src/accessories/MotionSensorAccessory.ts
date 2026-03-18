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

  constructor(
    private readonly log: DebugLogger,
    private readonly name: string,
    homekit: HomekitServices,
    accessory: PlatformAccessory,
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

    if (state.isActive && !current) {
      this.service.updateCharacteristic(this.motionDetected, true);
      this.log.easyDebug(() => `[${this.name}] Sensor ON, active cities: ${JSON.stringify([...state.activeCities.keys()])}`);
    } else if (!state.isActive && current) {
      this.service.updateCharacteristic(this.motionDetected, false);
      this.log.info(`[${this.name}] All clear - safe to leave shelter`);
    }
  }
}
