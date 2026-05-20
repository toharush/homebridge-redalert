import { Characteristic, Perms, PlatformAccessory, Service } from 'homebridge';
import { DebugLogger } from '../utils/debugLogger';

interface HomekitServices {
  Service: typeof Service;
  Characteristic: typeof Characteristic;
}

export class HealthCheckAccessory {
  private readonly service: Service;
  private readonly on: typeof Characteristic.On;

  constructor(
    private readonly log: DebugLogger,
    homekit: HomekitServices,
    accessory: PlatformAccessory,
  ) {
    this.on = homekit.Characteristic.On;

    accessory.getService(homekit.Service.AccessoryInformation)!
      .setCharacteristic(homekit.Characteristic.Manufacturer, 'toharush')
      .setCharacteristic(homekit.Characteristic.Model, 'Red Alert Health Check')
      .setCharacteristic(homekit.Characteristic.SerialNumber, 'RA-HEALTH-CHECK');

    this.service =
      accessory.getService(homekit.Service.Switch) ||
      accessory.addService(homekit.Service.Switch, 'API Health', 'health-check');

    this.service.getCharacteristic(this.on)
      .setProps({ perms: [Perms.PAIRED_READ, Perms.NOTIFY] });

    this.service.updateCharacteristic(this.on, true);
  }

  updateHealth(status: { healthy: boolean }[]): void {
    const healthy = status.some((s) => s.healthy);
    this.service.updateCharacteristic(this.on, healthy);
    if (healthy) {
      this.log.info('Health check: at least one source is reachable');
    } else {
      this.log.warn('Health check: all sources UNREACHABLE');
    }
  }
}
