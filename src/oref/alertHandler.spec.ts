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

function makeRealtimeAlert(cat: OrefCategory, cities: string[]) {
  return {
    id: '134180679120000000',
    cat: String(cat),
    title: 'test alert',
    data: cities,
    desc: 'היכנסו מייד למרחב המוגן',
  };
}

function makeHistoryAlert(category: OrefCategory, city: string) {
  return {
    alertDate: '2026-03-15 19:00:00',
    title: 'האירוע הסתיים',
    data: city,
    category,
  };
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
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(sensor.value, true);
  });

  it('should trigger when matching city is in array with others', () => {
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['באר שבע', 'חיפה', 'אשדוד'])]);
    assert.strictEqual(sensor.value, true);
  });

  it('should NOT turn off sensor when realtime alerts clear', () => {
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(sensor.value, true);

    handler.handleRealtimeAlerts([]);
    assert.strictEqual(sensor.value, true, 'Sensor should stay on until EventEnded');
  });

  it('should turn off sensor when EventEnded received for city', () => {
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(sensor.value, true);

    handler.handleHistoryAlerts([makeHistoryAlert(OrefCategory.EventEnded, 'תל אביב')]);
    assert.strictEqual(sensor.value, false);
  });

  it('should stay on if EventEnded only for some cities', () => {
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['תל אביב', 'חיפה'])]);
    assert.strictEqual(sensor.value, true);

    handler.handleHistoryAlerts([makeHistoryAlert(OrefCategory.EventEnded, 'תל אביב')]);
    assert.strictEqual(sensor.value, true, 'Sensor should stay on - חיפה still active');

    handler.handleHistoryAlerts([makeHistoryAlert(OrefCategory.EventEnded, 'חיפה')]);
    assert.strictEqual(sensor.value, false);
  });

  it('should not trigger for cities not in config', () => {
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['באר שבע'])]);
    assert.strictEqual(sensor.value, false);
  });

  it('should ignore EventEnded in realtime alerts', () => {
    handler.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.EventEnded, ['תל אביב'])]);
    assert.strictEqual(sensor.value, false);
  });

  it('should filter by allowed categories', () => {
    const rocketsOnly = new Set(CATEGORY_MAP['rockets']);
    const filtered = new AlertHandler(log, cities, rocketsOnly, sensor);

    filtered.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.TerroristInfiltration, ['תל אביב'])]);
    assert.strictEqual(sensor.value, false);

    filtered.handleRealtimeAlerts([makeRealtimeAlert(OrefCategory.Rockets, ['תל אביב'])]);
    assert.strictEqual(sensor.value, true);
  });

  it('should only log once per city while alert persists', () => {
    const alert = makeRealtimeAlert(OrefCategory.Rockets, ['תל אביב']);

    handler.handleRealtimeAlerts([alert]);
    handler.handleRealtimeAlerts([alert]);
    handler.handleRealtimeAlerts([alert]);

    const alertLogs = log.info.mock.calls.filter(
      (c: any) => c.arguments[0].startsWith('ALERT:'),
    );
    assert.strictEqual(alertLogs.length, 1);
  });

  it('should skip alerts with invalid category', () => {
    const badAlert = {
      id: '1',
      cat: 'invalid',
      title: 'bad',
      data: ['תל אביב'],
      desc: '',
    };
    handler.handleRealtimeAlerts([badAlert]);
    assert.strictEqual(sensor.value, false);
    assert.strictEqual(log.warn.mock.calls.length, 1);
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
