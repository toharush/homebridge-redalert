import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import {
  PLATFORM_NAME, PLUGIN_NAME, DEFAULT_POLLING_INTERVAL,
  DEFAULT_ALERT_TIMEOUT, DEFAULT_REQUEST_TIMEOUT, DEFAULT_TURNOFF_DELAY,
  DEFAULT_HEALTH_CHECK_THRESHOLD,
  TZOFAR_WS_URL, tzofarHeaders,
} from './settings';
import _ from 'lodash';
import { CATEGORY_MAP, ALL_CATEGORY_KEYS, SensorConfig } from './types';
import { validateConfig } from './utils/configValidator';
import { createDebugLogger, DebugLogger } from './utils/debugLogger';
import { AlertPipeline, DeduplicationStage } from './pipeline';
import { SensorFilter } from './services/SensorFilter';
import { OrefClient } from './clients/orefClient';
import { HttpSource, HttpSourceConfig } from './clients/httpSource';
import { WebSocketSource, WebSocketSourceConfig } from './clients/webSocketSource';
import { CategoryMapping } from './clients/categoryMapper';
import { parseTzofarMessage } from './clients/tzofarParser';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { HealthCheckAccessory } from './accessories/HealthCheckAccessory';
import { migrateConfig } from './utils/migrationHelper';

export class RedAlertPlatform implements DynamicPlatformPlugin {
  public readonly Service!: typeof Service;
  public readonly Characteristic!: typeof Characteristic;
  public readonly log: DebugLogger;

  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  private readonly sensorAccessories: MotionSensorAccessory[] = [];
  private pipeline: AlertPipeline | null = null;

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
    const healthCheckThreshold = _.get(config, 'health_check_threshold', DEFAULT_HEALTH_CHECK_THRESHOLD);
    const customSources: any[] = _.get(config, 'custom_sources', []);

    this.pipeline = this.buildPipeline(
      pollingInterval, requestTimeout, healthCheckThreshold, customSources,
    );

    this.log.easyDebug(`Finished initializing platform: ${PLATFORM_NAME}`);

    this.api.on('didFinishLaunching', () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      this.discoverDevices(this.pipeline!, validated.sensors, globalAlertTimeout, turnoffDelay);
    });

    this.api.on('shutdown', () => this.shutdown());
  }

  shutdown() {
    this.pipeline?.stop();
    for (const accessory of this.sensorAccessories) {
      accessory.destroy();
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.easyDebug(`Loading accessory from cache: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private discoverDevices(
    pipeline: AlertPipeline,
    sensors: SensorConfig[],
    globalAlertTimeout: number,
    turnoffDelay: number,
  ) {
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
      this.sensorAccessories.push(sensorAccessory);
      const filter = new SensorFilter(
        sensor.name, this.log, sensorAccessory, cities,
        allowedCategories, globalAlertTimeout, prefixMatching,
      );
      pipeline.subscribe(filter);

      this.log.info(
        `[${sensor.name}] Monitoring ${cities.length} cities, ${allowedCategories.size} category IDs, prefix=${prefixMatching}`,
      );
    }

    if (_.get(this.config, 'health_check', false)) {
      const healthAccessory = this.resolveAccessory('Red Alert Health');
      activeUUIDs.add(healthAccessory.UUID);
      const healthCheck = new HealthCheckAccessory(this.log, this, healthAccessory);
      pipeline.onHealthChange = (healthy) => healthCheck.updateHealth(healthy);
      this.log.info('Health check sensor enabled');
    }

    this.removeStaleAccessories(activeUUIDs);
    pipeline.start();
    this.log.info('Red Alert is running. You may close the config window.');
  }

  private buildPipeline(
    pollingInterval: number,
    requestTimeout: number,
    healthCheckThreshold: number,
    customSources: any[],
  ): AlertPipeline {
    const pipeline = new AlertPipeline(this.log);

    // Pipeline stages
    pipeline.addStage(new DeduplicationStage());

    // Built-in: Oref HTTP polling
    const orefClient = new OrefClient(requestTimeout, this.log);
    pipeline.addSource(new HttpSource(this.log, {
      name: 'Pikud HaOref',
      url: '',
      pollingInterval,
      requestTimeout,
      failureThreshold: healthCheckThreshold,
      fetchFn: () => orefClient.fetchAlerts(),
      adaptiveTimeout: true,
    }));

    // Built-in: Tzofar WebSocket (alerts + early warnings + exit notifications)
    pipeline.addSource(new WebSocketSource(this.log, {
      name: 'Tzofar',
      url: TZOFAR_WS_URL,
      headers: tzofarHeaders(),
      reconnectInterval: 10000,
      maxReconnectInterval: 60000,
      failureThreshold: healthCheckThreshold,
      pingInterval: 60000,
      pongTimeout: 420000,
      parseFn: parseTzofarMessage,
    }));

    // User-configured add-on sources
    for (const src of customSources) {
      const mapping: CategoryMapping = src.category_mapping ?? {};
      if (src.type === 'http') {
        const config: HttpSourceConfig = {
          name: src.name ?? 'custom-http',
          url: src.url,
          headers: src.headers,
          pollingInterval: src.polling_interval ?? pollingInterval,
          requestTimeout: src.request_timeout ?? requestTimeout,
          failureThreshold: src.failure_threshold ?? healthCheckThreshold,
          categoryMapping: mapping,
          responseFormat: src.response_format,
        };
        pipeline.addSource(new HttpSource(this.log, config));
      } else if (src.type === 'websocket') {
        const config: WebSocketSourceConfig = {
          name: src.name ?? 'custom-ws',
          url: src.url,
          headers: src.headers,
          reconnectInterval: src.reconnect_interval ?? 10000,
          maxReconnectInterval: src.max_reconnect_interval ?? 60000,
          failureThreshold: src.failure_threshold ?? healthCheckThreshold,
          categoryMapping: mapping,
          responseFormat: src.response_format,
          pingInterval: src.ping_interval ?? 60000,
          pongTimeout: src.pong_timeout ?? 420000,
          messageType: src.message_type,
          messageDataField: src.message_data_field,
        };
        pipeline.addSource(new WebSocketSource(this.log, config));
      } else {
        this.log.warn(`Unknown source type "${src.type}" for "${src.name}", skipping`);
      }
    }

    const total = 2 + customSources.length;
    this.log.info(`Alert sources: 2 built-in + ${customSources.length} add-on(s) = ${total} total`);
    return pipeline;
  }

  private parseCities(sensor: SensorConfig): string[] {
    if (_.isArray(sensor.cities)) {
      return _(sensor.cities).map(_.trim).compact().value();
    }
    return _(sensor.cities).split(',').map(_.trim).compact().value();
  }

  private resolveCategories(sensor: SensorConfig): Set<number> {
    const keys = sensor.categories?.length ? sensor.categories : ALL_CATEGORY_KEYS;
    const invalid = keys.filter((key) => !(key in CATEGORY_MAP));
    if (invalid.length > 0) {
      this.log.warn(`[${sensor.name}] Unknown categories: ${invalid.join(', ')} — these will be ignored`);
    }
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
        this.cachedAccessories.delete(uuid);
      }
    }
  }
}
