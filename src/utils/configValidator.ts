import { Logger, PlatformConfig } from 'homebridge';
import _ from 'lodash';
import { SensorConfig } from '../types';

export interface ValidatedConfig extends PlatformConfig {
  cities?: string;
  polling_interval?: number;
  debug?: boolean;
  categories?: string[];
  sensors?: SensorConfig[];
}

export function validateConfig(config: PlatformConfig, log: Logger): ValidatedConfig | null {
  const hasSensors = !_.isEmpty(config.sensors);
  const hasCities = config.cities && config.cities !== 'אזור_פיקוד_העורף_בעברית';

  if (!hasSensors && !hasCities) {
    log.error(
      'No cities or sensors found in configuration file, disabling plugin. '
      + 'Open plugin settings and add your cities or configure sensors.',
    );
    return null;
  }

  return config as ValidatedConfig;
}
