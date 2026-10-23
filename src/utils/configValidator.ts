import { Logger, PlatformConfig } from 'homebridge';
import _ from 'lodash';
import { SensorConfig } from '../types';
import {
  DEFAULT_APPLE_TV_MAX_CITIES, DEFAULT_APPLE_TV_NAME, DEFAULT_APPLE_TV_RING_INTERVAL,
  MAX_APPLE_TV_MAX_CITIES, MIN_APPLE_TV_RING_INTERVAL,
} from '../settings';

export interface ValidatedConfig extends PlatformConfig {
  sensors: SensorConfig[];
}

export function validateConfig(config: PlatformConfig, log: Logger): ValidatedConfig | null {
  if (_.isEmpty(config.sensors)) {
    log.error(
      'No sensors found in configuration file, disabling plugin. '
      + 'Open plugin settings and add at least one sensor.',
    );
    return null;
  }

  validateCustomSources(config, log);
  validateWebhooks(config, log);
  validateAppleTv(config, log);

  return config as ValidatedConfig;
}

function validateCustomSources(config: PlatformConfig, log: Logger): void {
  const sources: any[] = _.get(config, 'custom_sources', []);
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const label = src.name || `custom_sources[${i}]`;

    if (!src.url) {
      log.warn(`[${label}] Missing "url" — source will be skipped`);
    }

    if (src.type !== 'http' && src.type !== 'websocket') {
      log.warn(`[${label}] Unknown type "${src.type}" — must be "http" or "websocket"`);
    }

    if (src.type === 'http' && src.polling_interval !== undefined) {
      const interval = Number(src.polling_interval);
      if (isNaN(interval) || interval < 500) {
        log.warn(`[${label}] polling_interval must be >= 500ms`);
      }
    }

    if (src.type === 'websocket' && src.reconnect_interval !== undefined) {
      const interval = Number(src.reconnect_interval);
      if (isNaN(interval) || interval < 1000) {
        log.warn(`[${label}] reconnect_interval must be >= 1000ms`);
      }
    }

    if (!src.category_mapping || Object.keys(src.category_mapping).length === 0) {
      log.warn(
        `[${label}] No category_mapping defined — this source will not produce any alerts. `
        + 'Add at least one mapping (e.g. "1" → "rockets").',
      );
    }
  }
}

function validateWebhooks(config: PlatformConfig, log: Logger): void {
  const hooks: any[] = _.get(config, 'webhooks', []);
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    const label = `webhooks[${i}]`;

    if (!hook.url || typeof hook.url !== 'string' || !hook.url.trim()) {
      log.warn(`[${label}] Missing or empty "url" — webhook will be skipped`);
      continue;
    }

    if (!/^https?:\/\/.+/.test(hook.url)) {
      log.warn(`[${label}] URL "${hook.url}" does not look like a valid HTTP(S) URL`);
    }

    if (hook.method && hook.method !== 'POST' && hook.method !== 'PUT') {
      log.warn(`[${label}] Invalid method "${hook.method}" — must be "POST" or "PUT"`);
    }
  }
}

export interface AppleTvConfig {
  name: string;
  minRingInterval: number;
  maxCities: number;
  /** Sensor names that ring the doorbell; empty means every sensor. */
  sensors: string[];
  /** Live video stream of the alert card (needs ffmpeg). */
  stream: boolean;
  /** Configured ffmpeg binary; empty means auto-detect. */
  ffmpegPath: string;
}

/** A number setting, or `fallback` when it is missing or blank. NaN when it isn't numeric. */
function numberSetting(config: PlatformConfig, key: string, fallback: number): number {
  const raw = _.get(config, key);
  return _.isNil(raw) || raw === '' ? fallback : _.toNumber(raw);
}

/**
 * The Apple TV settings the plugin actually runs with: numbers out of range are
 * clamped, non-numeric ones fall back to the default, and a sensor list that
 * isn't a list is ignored. validateAppleTv() warns about each of those.
 */
export function resolveAppleTvConfig(config: PlatformConfig): AppleTvConfig {
  const interval = numberSetting(config, 'apple_tv_min_ring_interval', DEFAULT_APPLE_TV_RING_INTERVAL);
  const maxCities = numberSetting(config, 'apple_tv_max_cities', DEFAULT_APPLE_TV_MAX_CITIES);
  const sensors: unknown = _.get(config, 'apple_tv_sensors');
  return {
    name: _.trim(_.get(config, 'apple_tv_name')) || DEFAULT_APPLE_TV_NAME,
    minRingInterval: _.isFinite(interval) ? Math.max(MIN_APPLE_TV_RING_INTERVAL, interval) : DEFAULT_APPLE_TV_RING_INTERVAL,
    // A fraction would show "ועוד 0.5" in the picture.
    maxCities: _.isFinite(maxCities) ? _.clamp(Math.floor(maxCities), 1, MAX_APPLE_TV_MAX_CITIES) : DEFAULT_APPLE_TV_MAX_CITIES,
    sensors: _.isArray(sensors) ? _.filter(sensors, _.isString) : [],
    stream: _.get(config, 'apple_tv_stream', false) === true,
    ffmpegPath: _.trim(_.get(config, 'apple_tv_ffmpeg_path')),
  };
}

function validateAppleTv(config: PlatformConfig, log: Logger): void {
  if (!_.get(config, 'apple_tv_alerts', false)) {
    return;
  }
  const resolved = resolveAppleTvConfig(config);

  const interval = numberSetting(config, 'apple_tv_min_ring_interval', DEFAULT_APPLE_TV_RING_INTERVAL);
  if (interval !== resolved.minRingInterval) {
    log.warn(
      `[AppleTV] apple_tv_min_ring_interval must be a number >= ${MIN_APPLE_TV_RING_INTERVAL}ms — using ${resolved.minRingInterval}ms`,
    );
  }

  const maxCities = numberSetting(config, 'apple_tv_max_cities', DEFAULT_APPLE_TV_MAX_CITIES);
  if (maxCities !== resolved.maxCities) {
    log.warn(`[AppleTV] apple_tv_max_cities must be a whole number between 1 and ${MAX_APPLE_TV_MAX_CITIES} — using ${resolved.maxCities}`);
  }

  const tvSensors: unknown = _.get(config, 'apple_tv_sensors', []);
  if (!_.isArray(tvSensors)) {
    log.warn('[AppleTV] apple_tv_sensors must be a list of sensor names — ignoring it, every sensor rings the doorbell');
    return;
  }
  const known = new Set(_.map(config.sensors as SensorConfig[], 'name'));
  const unknown = _.reject(tvSensors, (name) => known.has(name));
  if (_.isEmpty(unknown)) {
    return;
  }
  if (unknown.length === tvSensors.length) {
    log.warn(`[AppleTV] apple_tv_sensors has no known sensor names (${unknown.join(', ')}) — the doorbell will never ring`);
  } else {
    log.warn(`[AppleTV] apple_tv_sensors has unknown sensor names: ${unknown.join(', ')} — they will be ignored`);
  }
}
