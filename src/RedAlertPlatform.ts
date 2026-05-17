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
import { AlertPipeline, ExpiryStage, DeduplicationStage, AlertHistory } from './pipeline';
import * as fs from 'fs';
import * as path from 'path';
import { SensorFilter } from './services/SensorFilter';
import { WebhookService, WebhookConfig } from './services/WebhookService';
import { HealthStatusService } from './services/HealthStatusService';
import { OrefClient } from './clients/orefClient';
import { HttpSource, HttpSourceConfig } from './clients/httpSource';
import { WebSocketSource, WebSocketSourceConfig } from './clients/webSocketSource';
import { CategoryMapping, DEFAULT_RESPONSE_FORMAT } from './clients/categoryMapper';
import { parseTzofarMessage, loadTzofarCityMap } from './clients/tzofarParser';
import { MotionSensorAccessory } from './accessories/MotionSensorAccessory';
import { HealthCheckAccessory } from './accessories/HealthCheckAccessory';
import { migrateConfig } from './utils/migrationHelper';
import { TelegramSource, SharedTelegramClient, createSharedTelegramClient } from './clients/telegramSource';
import { buildCityIndex } from './clients/telegramParser';

export class RedAlertPlatform implements DynamicPlatformPlugin {
  public readonly Service!: typeof Service;
  public readonly Characteristic!: typeof Characteristic;
  public readonly log: DebugLogger;

  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  private readonly sensorAccessories: MotionSensorAccessory[] = [];
  private pipeline: AlertPipeline | null = null;
  private history: AlertHistory | null = null;
  private sharedTgClient: SharedTelegramClient | null = null;
  private telegramSources: TelegramSource[] = [];
  private readonly historyFilePath: string;

  constructor(
    logger: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log = createDebugLogger(logger, _.get(config, 'debug', false));
    this.historyFilePath = path.join(api.user.storagePath(), 'redalert-history.json');

    migrateConfig(api.user.configPath(), this.log);

    const validated = validateConfig(config, this.log);
    if (!validated) {
      return;
    }

    const pollingInterval = _.get(config, 'polling_interval', DEFAULT_POLLING_INTERVAL);
    const requestTimeout = _.get(config, 'request_timeout', DEFAULT_REQUEST_TIMEOUT);
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

    this.api.on('didFinishLaunching', async () => {
      this.log.easyDebug('Executed didFinishLaunching callback');
      await loadTzofarCityMap().catch(() => {});
      this.discoverDevices(this.pipeline!, validated.sensors, turnoffDelay, webhook);
    });

    this.api.on('shutdown', () => this.shutdown());
  }

  shutdown() {
    this.pipeline?.stop();
    this.sharedTgClient?.stop();
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
        allowedCategories, prefixMatching, webhook ?? undefined,
      );
      pipeline.subscribe(filter);

      this.log.info(
        `[${sensor.name}] Monitoring ${cities.length} cities, ${allowedCategories.size} category IDs, prefix=${prefixMatching}`,
      );
    }

    const statusPath = path.join(this.api.user.storagePath(), 'redalert-status.json');
    const statusService = new HealthStatusService(statusPath);
    statusService.clear();

    if (_.get(this.config, 'health_check', false)) {
      const healthAccessory = this.resolveAccessory('Red Alert Health');
      activeUUIDs.add(healthAccessory.UUID);
      const healthCheck = new HealthCheckAccessory(this.log, this, healthAccessory);
      pipeline.onHealthChange = (status) => {
        healthCheck.updateHealth(status);
        statusService.update(status);
      };
      this.log.info('Health check sensor enabled');
    } else {
      pipeline.onHealthChange = (status) => statusService.update(status);
    }

    this.removeStaleAccessories(activeUUIDs);
    pipeline.start();
    statusService.update(pipeline.getSourceStatus());
    this.log.info('Red Alert is running. You may close the config window.');
  }

  private buildPipeline(
    pollingInterval: number,
    requestTimeout: number,
    healthCheckThreshold: number,
    customSources: any[],
    ws: { reconnectInterval: number; maxReconnectInterval: number; pingInterval: number; pongTimeout: number },
  ): AlertPipeline {
    const pipeline = new AlertPipeline(this.log);
    this.history = new AlertHistory(1000, this.historyFilePath);

    pipeline.addStage(new DeduplicationStage(30000, undefined, this.history));
    pipeline.addStage(new ExpiryStage(_.get(this.config, 'alert_timeout', DEFAULT_ALERT_TIMEOUT)));
    pipeline.subscribe(this.history);

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

    const telegramConfigs = customSources.filter((s: any) => s.type === 'telegram');
    if (telegramConfigs.length > 0) {
      const apiId = _.get(this.config, 'telegram_api_id', '');
      const apiHash = _.get(this.config, 'telegram_api_hash', '');
      if (!apiId || !apiHash) {
        this.log.warn('[Telegram] telegram_api_id and telegram_api_hash are required. Skipping telegram sources.');
      } else {
        const sessionPath = path.join(this.api.user.storagePath(), 'redalert-telegram-session.txt');
        const cityList = this.loadCityList();
        this.initTelegram(pipeline, telegramConfigs, apiId, apiHash, sessionPath, cityList, healthCheckThreshold);
      }
    }

    for (const src of customSources) {
      if (!src.url || src.type === 'telegram') {
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
          failureThreshold: src.failure_threshold ?? 1,
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
          failureThreshold: src.failure_threshold ?? 1,
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

  private initTelegram(
    pipeline: AlertPipeline,
    telegramConfigs: any[],
    apiId: string,
    apiHash: string,
    sessionPath: string,
    cityList: string[],
    healthCheckThreshold: number,
  ): void {
    for (const src of telegramConfigs) {
      const channelName = (src.url || '').replace('https://t.me/', '');
      if (!channelName) {
        this.log.warn(`[Telegram] Missing url for source "${src.name}", skipping`);
        continue;
      }
      const tgSource = new TelegramSource(this.log, {
        name: src.name ?? channelName,
        channel: channelName,
        fallbackCategory: src.category ?? 'rockets',
        failureThreshold: src.failure_threshold ?? healthCheckThreshold,
        cityList,
      });
      this.telegramSources.push(tgSource);
      pipeline.addSource(tgSource);
    }

    if (this.telegramSources.length === 0) {
      return;
    }

    createSharedTelegramClient(this.log, Number(apiId), apiHash, sessionPath).then((client) => {
      this.sharedTgClient = client;
      for (const tgSource of this.telegramSources) {
        tgSource.bindClient(client);
      }
      return client.connect();
    }).then(() => {
      this.log.info('[Telegram] Connected successfully');
      for (const tgSource of this.telegramSources) {
        tgSource.setHealthy(true);
      }
    }).catch((err) => {
      this.log.error(`[Telegram] Failed to connect: ${err}`);
    });
  }

  private loadCityList(): string[] {
    try {
      const citiesPath = path.join(__dirname, 'data', 'cities.json');
      const raw = JSON.parse(fs.readFileSync(citiesPath, 'utf-8')) as { name: string }[];
      return buildCityIndex(raw.map((c) => c.name));
    } catch (err) {
      this.log.warn(`Failed to load cities.json: ${err}`);
      return [];
    }
  }
}
