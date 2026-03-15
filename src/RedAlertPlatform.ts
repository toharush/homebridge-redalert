import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, DEFAULT_POLLING_INTERVAL, DEFAULT_ALERT_TIMEOUT } from './settings';
import _ from 'lodash';
import { CATEGORY_MAP, ALL_CATEGORY_KEYS } from './types';
import { validateConfig } from './utils/configValidator';
import { createDebugLogger, DebugLogger } from './utils/debugLogger';
import { OrefClient } from './oref/orefClient';
import { AlertHandler } from './oref/alertHandler';

export class RedAlertPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  private readonly log: DebugLogger;
  private readonly cities: string[] = [];
  private readonly pollingInterval: number;
  private readonly alertTimeout: number;
  private readonly allowedCategories: Set<number>;
  private readonly accessoryUUID: string;

  private accessory: PlatformAccessory | null = null;
  private orefClient: OrefClient | null = null;
  private alertHandler: AlertHandler | null = null;

  constructor(
    log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.pollingInterval = _.get(config, 'polling_interval', DEFAULT_POLLING_INTERVAL);
    this.alertTimeout = _.get(config, 'alert_timeout', DEFAULT_ALERT_TIMEOUT);
    this.log = createDebugLogger(log, _.get(config, 'debug', false));
    this.accessoryUUID = this.api.hap.uuid.generate(PLATFORM_NAME);

    const selectedKeys: string[] = !_.isEmpty(config.categories)
      ? config.categories
      : ALL_CATEGORY_KEYS;
    this.allowedCategories = new Set(_.flatMap(selectedKeys, (key) => CATEGORY_MAP[key] || []));

    process.on('unhandledRejection', (reason) => {
      this.log.error(`${reason}`);
    });

    const validated = validateConfig(config, this.log);
    if (!validated) {
      return;
    }

    this.cities = _(validated.cities).split(',').map(_.trim).compact().value();
    this.log.easyDebug(`Finished initializing platform: ${PLATFORM_NAME}`);
    this.log.info(`Monitoring ${this.cities.length} cities, ${this.allowedCategories.size} category IDs enabled`);

    this.api.on('didFinishLaunching', () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    try {
      this.log.easyDebug(`Loading accessory from cache: ${accessory.displayName}`);

      const service = accessory.getService('alerts');
      if (!service) {
        accessory.addService(this.api.hap.Service.MotionSensor, 'Red Alert', 'alerts');
      }

      this.accessories.push(accessory);
      this.log.easyDebug('Accessory configured successfully');
    } catch (error) {
      this.log.error(`${error}`);
    }
  }

  discoverDevices() {
    const existing = _.find(this.accessories, (acc) => acc.UUID === this.accessoryUUID);
    if (existing) {
      this.accessory = existing;
    } else {
      this.accessory = new this.api.platformAccessory('Red Alert', this.accessoryUUID);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
      this.configureAccessory(this.accessory);
    }

    // Remove stale accessories (e.g. old per-city ones from previous versions)
    const stale = _.filter(this.accessories, (acc) => acc.UUID !== this.accessoryUUID);
    if (!_.isEmpty(stale)) {
      this.log.info(`Removing ${stale.length} stale accessory(ies)`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      this.accessories.length = 0;
      if (this.accessory) {
        this.accessories.push(this.accessory);
      }
    }

    this.startMonitoring();
  }

  private startMonitoring() {
    const service = this.accessory?.getService('alerts');
    if (!service) {
      return;
    }

    const motionChar = service.getCharacteristic(this.Characteristic.MotionDetected);

    this.alertHandler = new AlertHandler(
      this.log,
      this.cities,
      this.allowedCategories,
      {
        getMotionDetected: () => motionChar.value as boolean | null,
        setMotionDetected: (on) => {
          service.updateCharacteristic(this.Characteristic.MotionDetected, on);
        },
      },
      this.alertTimeout,
    );

    this.orefClient = new OrefClient(
      this.log,
      this.pollingInterval,
      (alerts) => this.alertHandler!.handleRealtimeAlerts(alerts),
    );

    this.orefClient.start();
  }
}
