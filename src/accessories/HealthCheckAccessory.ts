import { Characteristic, PlatformAccessory, Service } from 'homebridge';
import { DebugLogger } from '../utils/debugLogger';

interface HomekitServices {
  Service: typeof Service;
  Characteristic: typeof Characteristic;
}

export class HealthCheckAccessory {
  private readonly service: Service;
  private readonly contactState: typeof Characteristic.ContactSensorState;

  constructor(
    private readonly log: DebugLogger,
    homekit: HomekitServices,
    accessory: PlatformAccessory,
  ) {
    this.contactState = homekit.Characteristic.ContactSensorState;

    accessory.getService(homekit.Service.AccessoryInformation)!
      .setCharacteristic(homekit.Characteristic.Manufacturer, 'toharush')
      .setCharacteristic(homekit.Characteristic.Model, 'Red Alert Health Check')
      .setCharacteristic(homekit.Characteristic.SerialNumber, 'RA-HEALTH-CHECK');

    this.service =
      accessory.getService(homekit.Service.ContactSensor) ||
      accessory.addService(homekit.Service.ContactSensor, 'API Health', 'health-check');

    this.service.updateCharacteristic(this.contactState, 0);
  }

  updateHealth(healthy: boolean): void {
    this.service.updateCharacteristic(this.contactState, healthy ? 0 : 1);
    if (healthy) {
      this.log.info('Health check: OREF API is reachable');
    } else {
      this.log.warn('Health check: OREF API is UNREACHABLE');
    }
  }
}
