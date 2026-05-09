import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from './AlertPipeline';
import { ParsedAlerts } from '../services/SensorFilter';
import { AlertListener } from './AlertBus';
import { OrefRealtimeAlert } from '../types';
import { AlertSource } from '../clients/AlertSource';

class MockSource implements AlertSource {
  readonly name = 'mock';
  readonly type = 'http' as const;
  private alertCb: ((alerts: OrefRealtimeAlert[]) => void) | null = null;
  start() {}
  stop() {}
  isHealthy() { return true; }
  onAlerts(cb: (alerts: OrefRealtimeAlert[]) => void) { this.alertCb = cb; }
  onHealthChange() {}
  emit(alerts: OrefRealtimeAlert[]) { this.alertCb?.(alerts); }
}

function createLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, log() {}, success() {}, easyDebug() {}, prefix: '' } as any;
}

describe('AlertPipeline: subscribe/publish', () => {
  it('publishes to all subscribers', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    const received: ParsedAlerts[] = [];

    const listener: AlertListener = { handleAlerts(parsed) { received.push(parsed); } };
    pipeline.addSource(source);
    pipeline.subscribe(listener);
    pipeline.subscribe(listener);
    pipeline.start();

    source.emit([{ id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' }]);

    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].relevantCities.has('city1'), true);
  });

  it('does nothing with no subscribers', () => {
    const pipeline = new AlertPipeline(createLogger());
    const source = new MockSource();
    pipeline.addSource(source);
    pipeline.start();
    source.emit([{ id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' }]);
    // no error thrown
  });
});
