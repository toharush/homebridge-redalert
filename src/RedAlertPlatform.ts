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
import { AlertPipeline, DeduplicationStage, AlertHistory } from './pipeline';
import * as fs from 'fs';
import * as path from 'path';
import { SensorFilter } from './services/SensorFilter';
import { WebhookService, WebhookConfig } from './services/WebhookService';
import { OrefClient } from './clients/orefClient';
import { HttpSource, HttpSourceConfig } from './clients/httpSource';
import { WebSocketSource, WebSocketSourceConfig } from './clients/webSocketSource';
import { CategoryMapping, DEFAULT_RESPONSE_FORMAT } from './clients/categoryMapper';
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
  private history: AlertHistory | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private readonly statusFilePath: string;
  private readonly historyFilePath: string;

  constructor(
    logger: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log = createDebugLogger(logger, _.get(config, 'debug', false));
    this.statusFilePath = path.join(api.user.storagePath(), 'redalert-status.json');
    this.historyFilePath = path.join(api.user.storagePath(), 'redalert-history.json');

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
    const reconnectInterval = _.get(config, 'reconnect_interval', 10000);
    const maxReconnectInterval = _.get(config, 'max_reconnect_interval', 60000);
    const pingInterval = _.get(config, 'ping_interval', 60000);
    const pongTimeout = _.get(config, 'pong_timeout', 420000);
    const customSources: any[] = _.get(config, 'custom_sources', []);
    const webhookConfigs: WebhookConfig[] = _.get(config, 'webhooks', []);
    const webhook = webhookConfigs.length > 0 ? new WebhookService(webhookConfigs, this.log) : null;

    this.pipeline = this.buildPipeline(
      pollingInterval, requestTimeout, healthCheckThreshold, customSources,
      { reconnectInterval, maxReconnectInterval, pingInterval, pongTimeout },
    );

    this.log.easyDebug(`Finished initializing platform: ${PLATFORM_NAME}`);

    this.api.on('didFinishLaunching', () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      this.discoverDevices(this.pipeline!, validated.sensors, globalAlertTimeout, turnoffDelay, webhook);
    });

    this.api.on('shutdown', () => this.shutdown());
  }

  shutdown() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.pipeline?.stop();
    for (const accessory of this.sensorAccessories) {
      accessory.destroy();
    }
    try {
      fs.unlinkSync(this.statusFilePath);
    } catch {
      // ignore
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
    webhook: WebhookService | null,
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
        allowedCategories, globalAlertTimeout, prefixMatching, this.history!, webhook ?? undefined,
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
    this.writeStatus();
    this.statusTimer = setInterval(() => this.writeStatus(), 5000);
    this.log.info('Red Alert is running. You may close the config window.');
  }

  private writeStatus(): void {
    try {
      const status = this.pipeline?.getSourceStatus() ?? [];
      const tmpStatus = this.statusFilePath + '.tmp';
      fs.writeFileSync(tmpStatus, JSON.stringify(status));
      fs.renameSync(tmpStatus, this.statusFilePath);
    } catch {
      // ignore
    }
    if (this.history?.isDirty()) {
      try {
        const entries = this.history.getAll();
        const tmpHistory = this.historyFilePath + '.tmp';
        fs.writeFileSync(tmpHistory, JSON.stringify(entries));
        fs.renameSync(tmpHistory, this.historyFilePath);
        this.history.clearDirty();
      } catch {
        // ignore
      }
    }
  }

  private buildPipeline(
    pollingInterval: number,
    requestTimeout: number,
    healthCheckThreshold: number,
    customSources: any[],
    ws: { reconnectInterval: number; maxReconnectInterval: number; pingInterval: number; pongTimeout: number },
  ): AlertPipeline {
    const pipeline = new AlertPipeline(this.log);
    this.history = new AlertHistory(1000);

    pipeline.addStage(new DeduplicationStage(30000, this.log, this.history, _.get(this.config, 'debug', false)));

    const orefClient = new OrefClient(requestTimeout);
    pipeline.addSource(new HttpSource(this.log, {
      name: 'Pikud HaOref',
      url: '',
      pollingInterval,
      requestTimeout,
      failureThreshold: healthCheckThreshold,
      fetchFn: () => orefClient.fetchAlerts(),
      adaptiveTimeout: true,
    }));

    pipeline.addSource(new WebSocketSource(this.log, {
      name: 'Tzofar',
      url: TZOFAR_WS_URL,
      headers: tzofarHeaders(),
      reconnectInterval: ws.reconnectInterval,
      maxReconnectInterval: ws.maxReconnectInterval,
      failureThreshold: healthCheckThreshold,
      pingInterval: ws.pingInterval,
      pongTimeout: ws.pongTimeout,
      parseFn: parseTzofarMessage,
    }));

    for (const src of customSources) {
      if (!src.url) {
        continue;
      }
      const mapping: CategoryMapping = src.category_mapping ?? {};
      const responseFormat = src.response_format ?? (src.category_field
        ? { ...DEFAULT_RESPONSE_FORMAT, category_field: src.category_field }
        : undefined);
      if (src.type === 'http') {
        const config: HttpSourceConfig = {
          name: src.name ?? 'custom-http',
          url: src.url,
          headers: src.headers,
          pollingInterval: src.polling_interval ?? pollingInterval,
          requestTimeout: src.request_timeout ?? requestTimeout,
          failureThreshold: src.failure_threshold ?? healthCheckThreshold,
          categoryMapping: mapping,
          responseFormat,
        };
        pipeline.addSource(new HttpSource(this.log, config));
      } else if (src.type === 'websocket') {
        const config: WebSocketSourceConfig = {
          name: src.name ?? 'custom-ws',
          url: src.url,
          headers: src.headers,
          reconnectInterval: src.reconnect_interval ?? ws.reconnectInterval,
          maxReconnectInterval: src.max_reconnect_interval ?? ws.maxReconnectInterval,
          failureThreshold: src.failure_threshold ?? healthCheckThreshold,
          categoryMapping: mapping,
          responseFormat,
          pingInterval: src.ping_interval ?? ws.pingInterval,
          pongTimeout: src.pong_timeout ?? ws.pongTimeout,
          messageType: src.message_type,
          messageDataField: src.message_data_field,
        };
        pipeline.addSource(new WebSocketSource(this.log, config));
      } else {
        this.log.warn(`Unknown source type "${src.type}" for "${src.name}", skipping`);
      }
    }

    const customCount = pipeline.getSourceStatus().length - 2;
    this.log.info(`Alert sources: 2 built-in + ${customCount} add-on(s) = ${2 + customCount} total`);
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
