import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { createDebugLogger } from './debugLogger';

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

describe('createDebugLogger', () => {
  it('should call log.info when debug is true', () => {
    const log = createMockLogger();
    const debugLog = createDebugLogger(log, true);
    debugLog.easyDebug('test message');
    assert.strictEqual(log.info.mock.calls.length, 1);
    assert.strictEqual(log.info.mock.calls[0].arguments[0], 'test message');
  });

  it('should not call log.info when debug is false', () => {
    const log = createMockLogger();
    const debugLog = createDebugLogger(log, false);
    debugLog.easyDebug('test message');
    assert.strictEqual(log.info.mock.calls.length, 0);
  });

  it('should accept a callback and only call it when debug is true', () => {
    const log = createMockLogger();
    const debugLog = createDebugLogger(log, true);
    const callback = mock.fn(() => 'lazy message');
    debugLog.easyDebug(callback);
    assert.strictEqual(callback.mock.calls.length, 1);
    assert.strictEqual(log.info.mock.calls[0].arguments[0], 'lazy message');
  });

  it('should not call the callback when debug is false', () => {
    const log = createMockLogger();
    const debugLog = createDebugLogger(log, false);
    const callback = mock.fn(() => 'lazy message');
    debugLog.easyDebug(callback);
    assert.strictEqual(callback.mock.calls.length, 0);
    assert.strictEqual(log.info.mock.calls.length, 0);
  });
});
