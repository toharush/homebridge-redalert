import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, DEFAULT_POLLING_INTERVAL, DEFAULT_ALERT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT } from './settings';
import _ from 'lodash';
import { CATEGORY_MAP, ALL_CATEGORY_KEYS, SensorConfig } from './types';
import { validateConfig } from './utils/configValidator';
import { createDebugLogger, DebugLogger } from './utils/debugLogger';
import { AlertService } from './services/AlertService';
import { SensorFilter } from './services/SensorFilter';
import { OrefClient } from './clients/orefClient';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';

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

    const validated = validateConfig(config, this.log);
    if (!validated) {
      return;
    }

    const pollingInterval = _.get(config, 'polling_interval', DEFAULT_POLLING_INTERVAL);
    const requestTimeout = _.get(config, 'request_timeout', DEFAULT_REQUEST_TIMEOUT);

    this.alertService = new AlertService(this.log, new OrefClient(requestTimeout), pollingInterval);

    this.log.easyDebug(`Finished initializing platform: ${PLATFORM_NAME}`);

    this.api.on('didFinishLaunching', () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.easyDebug(`Loading accessory from cache: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private getSensorConfigs(): SensorConfig[] {
    if (!_.isEmpty(this.config.sensors)) {
      return this.config.sensors;
    }
    // Backward compatibility: no sensors array → single sensor from top-level config
    return [{
      name: 'Red Alert',
      cities: this.config.cities,
      categories: this.config.categories,
      prefix_matching: this.config.prefix_matching,
      alert_timeout: this.config.alert_timeout,
    }];
  }

  private discoverDevices() {
    const sensorConfigs = this.getSensorConfigs();
    const activeUUIDs = new Set<string>();
    const globalAlertTimeout = _.get(this.config, 'alert_timeout', DEFAULT_ALERT_TIMEOUT);

    for (const sensorConfig of sensorConfigs) {
      const cities = _(sensorConfig.cities).split(',').map(_.trim).compact().value();
      if (_.isEmpty(cities)) {
        this.log.warn(`Sensor "${sensorConfig.name}" has no cities configured, skipping`);
        continue;
      }

      const selectedKeys = !_.isEmpty(sensorConfig.categories) ? sensorConfig.categories! : ALL_CATEGORY_KEYS;
      const allowedCategories = new Set(_.flatMap(selectedKeys, (key) => CATEGORY_MAP[key] || []));
      const prefixMatching = sensorConfig.prefix_matching ?? false;
      const alertTimeout = sensorConfig.alert_timeout ?? globalAlertTimeout;

      const uuid = this.api.hap.uuid.generate(`${PLATFORM_NAME}-${sensorConfig.name}`);
      activeUUIDs.add(uuid);

      const existing = this.cachedAccessories.get(uuid);
      let accessory: PlatformAccessory;

      if (existing) {
        accessory = existing;
      } else {
        accessory = new this.api.platformAccessory(sensorConfig.name, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      const motionAccessory = new MotionSensorAccessory(this, accessory, sensorConfig.name);
      const filter = new SensorFilter(
        sensorConfig.name, this.log, motionAccessory, cities,
        allowedCategories, alertTimeout, prefixMatching,
      );
      this.alertService!.registerListener(filter);

      this.log.info(
        `[${sensorConfig.name}] Monitoring ${cities.length} cities, ${allowedCategories.size} category IDs, prefix=${prefixMatching}`,
      );
    }

    // Remove stale accessories
    for (const [uuid, stale] of this.cachedAccessories) {
      if (!activeUUIDs.has(uuid)) {
        this.log.info(`Removing stale accessory: ${stale.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [stale]);
      }
    }

    this.alertService!.start();
  }
}
