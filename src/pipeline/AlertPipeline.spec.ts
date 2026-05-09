import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from './AlertPipeline';
import { DeduplicationStage } from './DeduplicationStage';
import { PipelineStage } from './PipelineStage';
import { OrefRealtimeAlert } from '../types';
import { ParsedAlerts } from '../services/SensorFilter';
import { AlertSource } from '../clients/AlertSource';

class MockSource implements AlertSource {
  readonly name = 'mock';
  readonly type = 'http' as const;
  private alertCb: ((alerts: OrefRealtimeAlert[]) => void) | null = null;
  private healthCb: ((healthy: boolean) => void) | null = null;
  private healthy = true;

  start() {}
  stop() {}
  isHealthy() { return this.healthy; }
  onAlerts(cb: (alerts: OrefRealtimeAlert[]) => void) { this.alertCb = cb; }
  onHealthChange(cb: (healthy: boolean) => void) { this.healthCb = cb; }

  emit(alerts: OrefRealtimeAlert[]) { this.alertCb?.(alerts); }
  setHealth(h: boolean) { this.healthy = h; this.healthCb?.(h); }
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
    log() {},
    success() {},
    easyDebug() {},
    prefix: '',
  } as any;
}

describe('AlertPipeline', () => {
  it('passes alerts from source through stages to listener', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    const received: ParsedAlerts[] = [];

    pipeline.addSource(source);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    source.emit([
      { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ]);

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].relevantCities.has('city1'), true);
  });

  it('deduplication stage filters duplicates', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    const received: ParsedAlerts[] = [];

    pipeline.addStage(new DeduplicationStage());
    pipeline.addSource(source);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    const alert = { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' };
    source.emit([alert]);
    source.emit([alert]);

    assert.strictEqual(received.length, 1);
  });

  it('skips empty alerts', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    const received: ParsedAlerts[] = [];

    pipeline.addSource(source);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    source.emit([]);
    assert.strictEqual(received.length, 0);
  });

  it('custom stage can filter alerts', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    const received: ParsedAlerts[] = [];

    const filterStage: PipelineStage = {
      process(alerts) { return alerts.filter(a => a.cat !== '99'); },
    };

    pipeline.addStage(filterStage);
    pipeline.addSource(source);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    source.emit([
      { id: '1', cat: '99', title: 'Filtered', data: ['city1'], desc: '' },
    ]);
    assert.strictEqual(received.length, 0);

    source.emit([
      { id: '2', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ]);
    assert.strictEqual(received.length, 1);
  });

  it('health is true if any source is healthy', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source1 = new MockSource();
    const source2 = new MockSource();

    pipeline.addSource(source1);
    pipeline.addSource(source2);

    assert.strictEqual(pipeline.isHealthy(), true);
    source1.setHealth(false);
    assert.strictEqual(pipeline.isHealthy(), true);
    source2.setHealth(false);
    assert.strictEqual(pipeline.isHealthy(), false);
  });

  it('fires onHealthChange when aggregate health changes', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    const healthEvents: boolean[] = [];

    pipeline.addSource(source);
    pipeline.onHealthChange = (h) => healthEvents.push(h);

    source.setHealth(false);
    source.setHealth(true);

    assert.deepStrictEqual(healthEvents, [false, true]);
  });

  it('two sources emit same alert simultaneously — listener fires only once', () => {
    const pipeline = new AlertPipeline(createLogger());
    const oref = new MockSource();
    const tzofar = new MockSource();
    const received: ParsedAlerts[] = [];

    pipeline.addStage(new DeduplicationStage());
    pipeline.addSource(oref);
    pipeline.addSource(tzofar);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    const alert: OrefRealtimeAlert = { id: '1', cat: '1', title: 'Rockets', data: ['תל אביב', 'חיפה'], desc: '' };

    // Both sources fire the same alert at the same time
    oref.emit([alert]);
    tzofar.emit([alert]);

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].relevantCities.has('תל אביב'), true);
    assert.strictEqual(received[0].relevantCities.has('חיפה'), true);
  });

  it('one valid alert + one malformed alert — only valid one reaches listener', () => {
    const pipeline = new AlertPipeline(createLogger());
    const goodSource = new MockSource();
    const badSource = new MockSource();
    const received: ParsedAlerts[] = [];

    pipeline.addStage(new DeduplicationStage());
    pipeline.addSource(goodSource);
    pipeline.addSource(badSource);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    // Good source: valid alert
    goodSource.emit([
      { id: '1', cat: '1', title: 'Rockets', data: ['תל אביב'], desc: '' },
    ]);

    // Bad source: invalid category (0), empty data, missing fields
    badSource.emit([
      { id: '2', cat: '0', title: '', data: [], desc: '' },
    ]);

    // Only the valid alert should reach listener
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].relevantCities.has('תל אביב'), true);
    assert.strictEqual(received[0].relevantCities.size, 1);
  });

  it('two sources emit different cities for same category — both reach listener', () => {
    const pipeline = new AlertPipeline(createLogger());
    const oref = new MockSource();
    const tzofar = new MockSource();
    const received: ParsedAlerts[] = [];

    pipeline.addStage(new DeduplicationStage());
    pipeline.addSource(oref);
    pipeline.addSource(tzofar);
    pipeline.subscribe({ handleAlerts(p) { received.push(p); } });
    pipeline.start();

    oref.emit([{ id: '1', cat: '1', title: 'Rockets', data: ['תל אביב'], desc: '' }]);
    tzofar.emit([{ id: '2', cat: '1', title: 'Rockets', data: ['חיפה'], desc: '' }]);

    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].relevantCities.has('תל אביב'), true);
    assert.strictEqual(received[1].relevantCities.has('חיפה'), true);
  });
});
