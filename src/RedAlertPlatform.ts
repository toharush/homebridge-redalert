import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import {
  PLATFORM_NAME, PLUGIN_NAME, DEFAULT_POLLING_INTERVAL,
  DEFAULT_ALERT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT, DEFAULT_TURNOFF_DELAY,
} from './settings';
import _ from 'lodash';
import { CATEGORY_MAP, ALL_CATEGORY_KEYS, SensorConfig } from './types';
import { validateConfig } from './utils/configValidator';
import { createDebugLogger, DebugLogger } from './utils/debugLogger';
import { AlertService } from './services/AlertService';
import { SensorFilter } from './services/SensorFilter';
import { OrefClient } from './clients/orefClient';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { migrateConfig } from './utils/migrationHelper';

export class RedAlertPlatform implements DynamicPlatformPlugin {
  public readonly Service!: typeof Service;
  public readonly Characteristic!: typeof Characteristic;
  public readonly log: DebugLogger;

  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  private alertService: AlertService | null = null;

  constructor(
    logger: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log = createDebugLogger(logger, _.get(config, 'debug', false));

    migrateConfig(api.user.configPath(), this.log);

    const validated = validateConfig(config, this.log);
    if (!validated) {
      return;
    }

    const pollingInterval = _.get(config, 'polling_interval', DEFAULT_POLLING_INTERVAL);
    const requestTimeout = _.get(config, 'request_timeout', DEFAULT_REQUEST_TIMEOUT);
    const globalAlertTimeout = _.get(config, 'alert_timeout', DEFAULT_ALERT_TIMEOUT);
    const turnoffDelay = _.get(config, 'turnoff_delay', DEFAULT_TURNOFF_DELAY);
    this.alertService = new AlertService(this.log, new OrefClient(requestTimeout), pollingInterval);

    this.log.easyDebug(`Finished initializing platform: ${PLATFORM_NAME}`);

    this.api.on('didFinishLaunching', () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      this.discoverDevices(this.alertService!, validated.sensors, globalAlertTimeout, turnoffDelay);
    });
  }

  shutdown() {
    this.alertService?.stop();
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.easyDebug(`Loading accessory from cache: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private discoverDevices(alertService: AlertService, sensors: SensorConfig[], globalAlertTimeout: number, turnoffDelay: number) {
    const activeUUIDs = new Set<string>();

    for (const sensor of sensors) {
      const cities = this.parseCities(sensor);
      if (_.isEmpty(cities)) {
        this.log.warn(`Sensor "${sensor.name}" has no cities configured, skipping`);
        continue;
      }

      const allowedCategories = this.resolveCategories(sensor);
      const prefixMatching = sensor.prefix_matching ?? false;
      const accessory = this.resolveAccessory(sensor.name);
      activeUUIDs.add(accessory.UUID);

      const sensorAccessory = new MotionSensorAccessory(this.log, sensor.name, this, accessory, turnoffDelay);
      const filter = new SensorFilter(
        sensor.name, this.log, sensorAccessory, cities,
        allowedCategories, globalAlertTimeout, prefixMatching,
      );
      alertService.registerListener(filter);

      this.log.info(
        `[${sensor.name}] Monitoring ${cities.length} cities, ${allowedCategories.size} category IDs, prefix=${prefixMatching}`,
      );
    }

    this.removeStaleAccessories(activeUUIDs);
    alertService.start();
  }

  private parseCities(sensor: SensorConfig): string[] {
    if (_.isArray(sensor.cities)) {
      return _(sensor.cities).map(_.trim).compact().value();
    }
    return _(sensor.cities).split(',').map(_.trim).compact().value();
  }

  private resolveCategories(sensor: SensorConfig): Set<number> {
    const keys = sensor.categories?.length ? sensor.categories : ALL_CATEGORY_KEYS;
    return new Set(_.flatMap(keys, (key) => CATEGORY_MAP[key] || []));
  }

  private resolveAccessory(name: string): PlatformAccessory {
    const uuid = this.api.hap.uuid.generate(`${PLATFORM_NAME}-${name}`);
    const existing = this.cachedAccessories.get(uuid);
    if (existing) {
      return existing;
    }
    const accessory = new this.api.platformAccessory(name, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    return accessory;
  }

  private removeStaleAccessories(activeUUIDs: Set<string>) {
    for (const [uuid, stale] of this.cachedAccessories) {
      if (!activeUUIDs.has(uuid)) {
        this.log.info(`Removing stale accessory: ${stale.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [stale]);
      }
    }
  }
}
