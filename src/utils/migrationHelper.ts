import fs from 'fs';
import _ from 'lodash';
import { Logger } from 'homebridge';
import { PLATFORM_NAME } from '../settings';

interface LegacySensorConfig {
  name: string;
  cities: string | string[];
  custom_cities?: string;
  categories?: string[];
  prefix_matching?: boolean;
}

interface MigratedSensorConfig {
  name: string;
  cities: string[];
  categories?: string[];
  prefix_matching?: boolean;
}

export function migrateConfig(configPath: string, log: Logger): void {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return;
  }

  let config: any;
  try {
    config = JSON.parse(raw);
  } catch {
    return;
  }

  const platforms: any[] = config.platforms ?? [];
  const pluginConfig = platforms.find((p: any) => p.platform === PLATFORM_NAME);
  if (!pluginConfig?.sensors) {
    return;
  }

  let changed = false;

  pluginConfig.sensors = pluginConfig.sensors.map((sensor: LegacySensorConfig): MigratedSensorConfig => {
    let cities: string[];

    if (_.isArray(sensor.cities)) {
      cities = _(sensor.cities).map(_.trim).compact().value();
    } else {
      cities = _(sensor.cities).split(',').map(_.trim).compact().value();
      changed = true;
    }

    if (sensor.custom_cities) {
      const custom = _(sensor.custom_cities).split(',').map(_.trim).compact().value();
      cities = _.uniq([...cities, ...custom]);
      changed = true;
    }

    const migrated: MigratedSensorConfig = {
      name: sensor.name,
      cities,
    };

    if (sensor.categories?.length) {
      migrated.categories = sensor.categories;
    }
    if (sensor.prefix_matching) {
      migrated.prefix_matching = true;
    }

    return migrated;
  });

  if (!changed) {
    return;
  }

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
    log.info('Config migrated: cities converted from string to array format');
  } catch (err) {
    log.warn(`Failed to write migrated config: ${err}`);
  }
}
