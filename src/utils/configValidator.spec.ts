import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { validateConfig } from './configValidator';

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

describe('validateConfig', () => {
  it('should return null when sensors is missing', () => {
    const log = createMockLogger();
    const result = validateConfig({ platform: 'test' } as any, log);
    assert.strictEqual(result, null);
    assert.strictEqual(log.error.mock.calls.length, 1);
  });

  it('should return null when sensors is empty', () => {
    const log = createMockLogger();
    const result = validateConfig({ platform: 'test', sensors: [] } as any, log);
    assert.strictEqual(result, null);
    assert.strictEqual(log.error.mock.calls.length, 1);
  });

  it('should return ValidatedConfig when sensors are configured', () => {
    const log = createMockLogger();
    const config = {
      platform: 'test',
      sensors: [{ name: 'Home', cities: 'תל אביב' }],
    } as any;
    const result = validateConfig(config, log);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.sensors.length, 1);
    assert.strictEqual(log.error.mock.calls.length, 0);
  });
});
