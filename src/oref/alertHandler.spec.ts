import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AlertHandler } from './alertHandler';
import { OrefCategory, CATEGORY_MAP, getCategoryName } from '../types';

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    prefix: '',
    easyDebug: mock.fn(),
  } as any;
}

function createMockSensor() {
  let motion = false;
  return {
    getMotionDetected: () => motion,
    setMotionDetected: (on: boolean) => {
      motion = on;
    },
    get value() {
      return motion;
    },
  };
}

function allCategoryIds(): Set<number> {
  const ids = new Set<number>();
  for (const arr of Object.values(CATEGORY_MAP)) {
    for (const id of arr) {
      ids.add(id);
    }
  }
  return ids;
}

describe('AlertHandler', () => {
  const cities = ['תל אביב', 'חיפה'];
  let log: any;
  let sensor: ReturnType<typeof createMockSensor>;
  let handler: AlertHandler;

  beforeEach(() => {
    log = createMockLogger();
    sensor = createMockSensor();
    handler = new AlertHandler(log, cities, allCategoryIds(), sensor);
  });

  it('should trigger sensor for matching city', () => {
    handler.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'ירי רקטות',
      data: 'תל אביב',
      category: OrefCategory.Rockets,
    }]);
    assert.strictEqual(sensor.value, true);
  });

  it('should turn off sensor when alerts clear', () => {
    handler.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'ירי רקטות',
      data: 'תל אביב',
      category: OrefCategory.Rockets,
    }]);
    assert.strictEqual(sensor.value, true);

    handler.handleAlerts([]);
    assert.strictEqual(sensor.value, false);
  });

  it('should turn off sensor when city disappears from alerts', () => {
    handler.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'ירי רקטות',
      data: 'תל אביב',
      category: OrefCategory.Rockets,
    }]);
    assert.strictEqual(sensor.value, true);

    handler.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'ירי רקטות',
      data: 'באר שבע',
      category: OrefCategory.Rockets,
    }]);
    assert.strictEqual(sensor.value, false);
  });

  it('should not trigger for cities not in config', () => {
    handler.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'ירי רקטות',
      data: 'באר שבע',
      category: OrefCategory.Rockets,
    }]);
    assert.strictEqual(sensor.value, false);
  });

  it('should ignore EventEnded category', () => {
    handler.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'האירוע הסתיים',
      data: 'תל אביב',
      category: OrefCategory.EventEnded,
    }]);
    assert.strictEqual(sensor.value, false);
  });

  it('should filter by allowed categories', () => {
    const rocketsOnly = new Set(CATEGORY_MAP['rockets']);
    const filtered = new AlertHandler(log, cities, rocketsOnly, sensor);

    filtered.handleAlerts([{
      alertDate: '2024-01-01 12:00:00',
      title: 'חדירת מחבלים',
      data: 'תל אביב',
      category: OrefCategory.TerroristInfiltration,
    }]);
    assert.strictEqual(sensor.value, false);

    filtered.handleAlerts([{
      alertDate: '2024-01-01 12:00:01',
      title: 'ירי רקטות',
      data: 'תל אביב',
      category: OrefCategory.Rockets,
    }]);
    assert.strictEqual(sensor.value, true);
  });

  it('should only log once while alert persists', () => {
    const alert = {
      alertDate: '2024-01-01 12:00:00',
      title: 'ירי רקטות',
      data: 'תל אביב',
      category: OrefCategory.Rockets,
    };

    handler.handleAlerts([alert]);
    handler.handleAlerts([alert]);
    handler.handleAlerts([alert]);

    const alertLogs = log.info.mock.calls.filter(
      (c: any) => c.arguments[0].startsWith('ALERT:'),
    );
    assert.strictEqual(alertLogs.length, 1);
  });
});

describe('getCategoryName', () => {
  it('should return correct names for known categories', () => {
    assert.strictEqual(getCategoryName(OrefCategory.Rockets), 'rockets');
    assert.strictEqual(getCategoryName(OrefCategory.UAVIntrusion), 'uav');
    assert.strictEqual(getCategoryName(OrefCategory.NonConventional), 'nonconventional');
    assert.strictEqual(getCategoryName(OrefCategory.Warning), 'warning');
    assert.strictEqual(getCategoryName(OrefCategory.EarthquakeAlert), 'earthquake');
    assert.strictEqual(getCategoryName(OrefCategory.EarthquakeWarning), 'earthquake');
    assert.strictEqual(getCategoryName(OrefCategory.CBRNE), 'cbrne');
    assert.strictEqual(getCategoryName(OrefCategory.TerroristInfiltration), 'terror');
    assert.strictEqual(getCategoryName(OrefCategory.Tsunami), 'tsunami');
    assert.strictEqual(getCategoryName(OrefCategory.HazardousMaterials), 'hazmat');
    assert.strictEqual(getCategoryName(OrefCategory.EventEnded), 'event_ended');
    assert.strictEqual(getCategoryName(OrefCategory.Flash), 'flash');
  });

  it('should return unknown for unrecognized categories', () => {
    assert.strictEqual(getCategoryName(999), 'unknown');
  });
});
