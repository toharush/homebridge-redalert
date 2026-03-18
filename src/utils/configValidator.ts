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

  return config as ValidatedConfig;
}
