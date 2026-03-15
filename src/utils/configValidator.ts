import { Logger, PlatformConfig } from 'homebridge';
import { ValidatedConfig } from '../types';

export function validateConfig(config: PlatformConfig, log: Logger): ValidatedConfig | null {
  if (!config.cities) {
    log.error(
      'No cities found in configuration file, disabling plugin. '
      + 'Open plugin settings and add your cities.',
    );
    return null;
  }
  if (config.cities === 'אזור_פיקוד_העורף_בעברית') {
    log.error(
      'Cities not configured, disabling plugin. '
      + 'Open plugin settings and configure your cities.',
    );
    return null;
  }
  return config as ValidatedConfig;
}
