import { Logger, PlatformConfig } from 'homebridge';
import _ from 'lodash';
import { SensorConfig } from '../types';

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
