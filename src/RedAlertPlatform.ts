import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, DEFAULT_POLLING_INTERVAL, DEFAULT_ALERT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT } from './settings';
import _ from 'lodash';
import { CATEGORY_MAP, ALL_CATEGORY_KEYS } from './types';
import { validateConfig } from './utils/configValidator';
import { createDebugLogger, DebugLogger } from './utils/debugLogger';
import { AlertService } from './services/AlertService';
import { OrefClient } from './clients/orefClient';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';

export class RedAlertPlatform implements DynamicPlatformPlugin {
  public readonly Service!: typeof Service;
  public readonly Characteristic!: typeof Characteristic;
  public readonly log: DebugLogger;

  private readonly accessoryUUID: string;
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
    this.accessoryUUID = this.api.hap.uuid.generate(PLATFORM_NAME);

    const validated = validateConfig(config, this.log);
    if (!validated) {
      return;
    }

    const cities = _(validated.cities).split(',').map(_.trim).compact().value();
    const pollingInterval = _.get(config, 'polling_interval', DEFAULT_POLLING_INTERVAL);
    const alertTimeout = _.get(config, 'alert_timeout', DEFAULT_ALERT_TIMEOUT);
    const requestTimeout = _.get(config, 'request_timeout', DEFAULT_REQUEST_TIMEOUT);

    const selectedKeys: string[] = !_.isEmpty(config.categories) ? config.categories : ALL_CATEGORY_KEYS;
    const allowedCategories = new Set(_.flatMap(selectedKeys, (key) => CATEGORY_MAP[key] || []));

    const prefixMatching = _.get(config, 'prefix_matching', false);
    this.alertService = new AlertService(
      this.log, new OrefClient(requestTimeout), cities, allowedCategories,
      pollingInterval, alertTimeout, prefixMatching,
    );

    this.log.easyDebug(`Finished initializing platform: ${PLATFORM_NAME}`);
    this.log.info(`Monitoring ${cities.length} cities, ${allowedCategories.size} category IDs enabled`);

    this.api.on('didFinishLaunching', () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.easyDebug(`Loading accessory from cache: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private discoverDevices() {
    const existing = this.cachedAccessories.get(this.accessoryUUID);
    let accessory: PlatformAccessory;

    if (existing) {
      accessory = existing;
    } else {
      accessory = new this.api.platformAccessory('Red Alert', this.accessoryUUID);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.alertService!.registerAccessory(new MotionSensorAccessory(this, accessory));

    // Remove stale accessories (e.g. old per-city ones from previous versions)
    for (const [uuid, stale] of this.cachedAccessories) {
      if (uuid !== this.accessoryUUID) {
        this.log.info(`Removing stale accessory: ${stale.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [stale]);
      }
    }

    this.alertService!.start();
  }
}
