import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateConfig } from './migrationHelper';

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    prefix: '',
  } as any;
}

function writeConfig(configPath: string, platforms: any[]) {
  const config = { bridge: { name: 'Test' }, platforms };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
}

function readPlatformConfig(configPath: string) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.platforms.find((p: any) => p.platform === 'RedAlert');
}

describe('migrateConfig', () => {
  let tmpDir: string;
  let configPath: string;
  let log: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-redalert-test-'));
    configPath = path.join(tmpDir, 'config.json');
    log = createMockLogger();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should migrate comma-separated string cities to array', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{ name: 'Home', cities: 'תל אביב, חיפה' }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה']);
    assert.strictEqual(log.info.mock.calls.length, 1);
  });

  it('should migrate single city string to array', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{ name: 'Home', cities: 'פתח תקווה' }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['פתח תקווה']);
  });

  it('should merge custom_cities into cities and remove it', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{
        name: 'Home',
        cities: ['תל אביב'],
        custom_cities: 'חיפה, באר שבע',
      }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה', 'באר שבע']);
    assert.strictEqual(result.sensors[0].custom_cities, undefined);
  });

  it('should migrate string cities AND merge custom_cities', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{
        name: 'Home',
        cities: 'תל אביב',
        custom_cities: 'חיפה',
      }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה']);
    assert.strictEqual(result.sensors[0].custom_cities, undefined);
  });

  it('should deduplicate cities when merging custom_cities', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{
        name: 'Home',
        cities: ['תל אביב', 'חיפה'],
        custom_cities: 'חיפה, באר שבע',
      }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה', 'באר שבע']);
  });

  it('should not modify config if already in new format', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{ name: 'Home', cities: ['תל אביב', 'חיפה'] }],
    }]);

    const before = fs.readFileSync(configPath, 'utf-8');
    migrateConfig(configPath, log);
    const after = fs.readFileSync(configPath, 'utf-8');

    assert.strictEqual(before, after);
    assert.strictEqual(log.info.mock.calls.length, 0);
  });

  it('should preserve other sensor fields during migration', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{
        name: 'Home',
        cities: 'תל אביב',
        categories: ['rockets', 'uav'],
        prefix_matching: true,
      }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב']);
    assert.deepStrictEqual(result.sensors[0].categories, ['rockets', 'uav']);
    assert.strictEqual(result.sensors[0].prefix_matching, true);
  });

  it('should preserve other platform config fields', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{ name: 'Home', cities: 'תל אביב' }],
      polling_interval: 2000,
      debug: true,
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.strictEqual(result.polling_interval, 2000);
    assert.strictEqual(result.debug, true);
  });

  it('should preserve other platforms in config', () => {
    writeConfig(configPath, [
      { platform: 'SomeOtherPlugin', foo: 'bar' },
      { platform: 'RedAlert', sensors: [{ name: 'Home', cities: 'תל אביב' }] },
    ]);

    migrateConfig(configPath, log);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.platforms.length, 2);
    assert.strictEqual(config.platforms[0].platform, 'SomeOtherPlugin');
    assert.strictEqual(config.platforms[0].foo, 'bar');
  });

  it('should handle multiple sensors with mixed formats', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [
        { name: 'Legacy', cities: 'תל אביב, חיפה' },
        { name: 'New', cities: ['באר שבע'] },
        { name: 'WithCustom', cities: ['אשדוד'], custom_cities: 'אשקלון' },
      ],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה']);
    assert.deepStrictEqual(result.sensors[1].cities, ['באר שבע']);
    assert.deepStrictEqual(result.sensors[2].cities, ['אשדוד', 'אשקלון']);
    assert.strictEqual(result.sensors[2].custom_cities, undefined);
  });

  it('should handle missing config file gracefully', () => {
    migrateConfig('/nonexistent/path/config.json', log);
    assert.strictEqual(log.info.mock.calls.length, 0);
    assert.strictEqual(log.warn.mock.calls.length, 0);
  });

  it('should handle malformed JSON gracefully', () => {
    fs.writeFileSync(configPath, 'not json', 'utf-8');
    migrateConfig(configPath, log);
    assert.strictEqual(log.info.mock.calls.length, 0);
  });

  it('should handle config without RedAlert platform', () => {
    writeConfig(configPath, [{ platform: 'SomeOther' }]);
    migrateConfig(configPath, log);
    assert.strictEqual(log.info.mock.calls.length, 0);
  });

  it('should trim whitespace from migrated cities', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{ name: 'Home', cities: '  תל אביב  ,  חיפה  ' }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה']);
  });

  it('should filter empty entries from migrated cities', () => {
    writeConfig(configPath, [{
      platform: 'RedAlert',
      sensors: [{ name: 'Home', cities: 'תל אביב,,, חיפה,' }],
    }]);

    migrateConfig(configPath, log);

    const result = readPlatformConfig(configPath);
    assert.deepStrictEqual(result.sensors[0].cities, ['תל אביב', 'חיפה']);
  });
});
