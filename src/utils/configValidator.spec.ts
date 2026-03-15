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
  it('should return null when cities is missing', () => {
    const log = createMockLogger();
    const result = validateConfig({ platform: 'test' } as any, log);
    assert.strictEqual(result, null);
    assert.strictEqual(log.error.mock.calls.length, 1);
  });

  it('should return null when cities is the default placeholder', () => {
    const log = createMockLogger();
    const result = validateConfig({
      platform: 'test',
      cities: 'אזור_פיקוד_העורף_בעברית',
    } as any, log);
    assert.strictEqual(result, null);
    assert.strictEqual(log.error.mock.calls.length, 1);
  });

  it('should return ValidatedConfig when config is valid', () => {
    const log = createMockLogger();
    const config = {
      platform: 'test',
      cities: 'תל אביב, חיפה',
    } as any;
    const result = validateConfig(config, log);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.cities, 'תל אביב, חיפה');
    assert.strictEqual(log.error.mock.calls.length, 0);
  });
});
