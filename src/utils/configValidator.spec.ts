import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { validateConfig, resolveAppleTvConfig } from './configValidator';

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

  describe('Apple TV alerts', () => {
    const sensors = [{ name: 'Home', cities: ['חיפה'] }];
    const warnings = (extra: Record<string, unknown>) => {
      const log = createMockLogger();
      validateConfig({ platform: 'test', sensors, apple_tv_alerts: true, ...extra } as any, log);
      return log.warn.mock.calls.map((c: any) => c.arguments[0] as string);
    };

    it('accepts valid settings without warnings', () => {
      assert.deepStrictEqual(warnings({ apple_tv_min_ring_interval: 20000, apple_tv_max_cities: 12, apple_tv_sensors: ['Home'] }), []);
    });

    it('warns when the ring interval is below 5000ms', () => {
      assert.ok(warnings({ apple_tv_min_ring_interval: 1000 }).some((w) => w.includes('apple_tv_min_ring_interval')));
    });

    it('warns when max cities is out of range', () => {
      assert.ok(warnings({ apple_tv_max_cities: 0 }).some((w) => w.includes('apple_tv_max_cities')));
      assert.ok(warnings({ apple_tv_max_cities: 50 }).some((w) => w.includes('apple_tv_max_cities')));
    });

    it('warns about unknown sensor names', () => {
      const w = warnings({ apple_tv_sensors: ['Home', 'Office'] });
      assert.strictEqual(w.length, 1);
      assert.ok(w[0].includes('Office') && !w[0].includes('Home,'));
    });

    it('does not check Apple TV settings when the feature is off', () => {
      const log = createMockLogger();
      validateConfig({ platform: 'test', sensors, apple_tv_max_cities: 0 } as any, log);
      assert.strictEqual(log.warn.mock.calls.length, 0);
    });

    it('warns when no listed sensor exists, since the doorbell would never ring', () => {
      const w = warnings({ apple_tv_sensors: ['Office'] });
      assert.strictEqual(w.length, 1);
      assert.ok(w[0].includes('never ring'));
    });

    it('warning text matches the value actually used', () => {
      assert.ok(warnings({ apple_tv_min_ring_interval: 'soon' }).some((w) => w.includes('using 20000ms')));
      assert.ok(warnings({ apple_tv_min_ring_interval: 1000 }).some((w) => w.includes('using 5000ms')));
      assert.ok(warnings({ apple_tv_max_cities: 0 }).some((w) => w.includes('using 1')));
      assert.ok(warnings({ apple_tv_max_cities: 2.5 }).some((w) => w.includes('using 2')));
    });
  });

  describe('resolveAppleTvConfig', () => {
    const resolve = (extra: Record<string, unknown>) => resolveAppleTvConfig({ platform: 'test', ...extra } as any);

    it('uses the defaults when nothing is set', () => {
      assert.deepStrictEqual(resolve({}), {
        name: 'Red Alert TV', minRingInterval: 20000, maxCities: 12, sensors: [], stream: false, ffmpegPath: '',
      });
    });

    it('reads the live stream settings', () => {
      assert.strictEqual(resolve({ apple_tv_stream: true }).stream, true);
      assert.strictEqual(resolve({ apple_tv_stream: 'yes' }).stream, false);
      assert.strictEqual(resolve({ apple_tv_ffmpeg_path: '  /usr/bin/ffmpeg ' }).ffmpegPath, '/usr/bin/ffmpeg');
    });

    it('clamps out-of-range numbers, floors fractions and falls back on non-numbers', () => {
      assert.strictEqual(resolve({ apple_tv_min_ring_interval: 100 }).minRingInterval, 5000);
      assert.strictEqual(resolve({ apple_tv_min_ring_interval: 'x' }).minRingInterval, 20000);
      assert.strictEqual(resolve({ apple_tv_min_ring_interval: '30000' }).minRingInterval, 30000);
      assert.strictEqual(resolve({ apple_tv_max_cities: 0 }).maxCities, 1);
      assert.strictEqual(resolve({ apple_tv_max_cities: 99 }).maxCities, 20);
      assert.strictEqual(resolve({ apple_tv_max_cities: 7.9 }).maxCities, 7);
      assert.strictEqual(resolve({ apple_tv_max_cities: null }).maxCities, 12);
    });

    it('ignores a sensor list that is not a list (a string would substring-match names)', () => {
      assert.deepStrictEqual(resolve({ apple_tv_sensors: 'Home' }).sensors, []);
      assert.deepStrictEqual(resolve({ apple_tv_sensors: ['Home', 3] }).sensors, ['Home']);
    });

    it('trims the name and falls back to the default when blank', () => {
      assert.strictEqual(resolve({ apple_tv_name: '  Salon  ' }).name, 'Salon');
      assert.strictEqual(resolve({ apple_tv_name: '   ' }).name, 'Red Alert TV');
    });
  });
});

