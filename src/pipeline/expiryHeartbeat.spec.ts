import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { AlertPipeline } from './AlertPipeline';
import { DeduplicationStage } from './DeduplicationStage';
import { ExpiryStage } from './ExpiryStage';
import { SensorFilter } from '../services/SensorFilter';
import { AlertSource } from '../clients/AlertSource';
import { OrefRealtimeAlert, OrefCategory, CATEGORY_MAP } from '../types';

function createLogger() {
  return {
    info: mock.fn(), warn: mock.fn(), error: mock.fn(),
    debug: mock.fn(), log: mock.fn(), success: mock.fn(),
    easyDebug: mock.fn(), prefix: '',
  } as any;
}

function createAccessory() {
  return {
    lastState: null as any,
    updateAlertState(state: any) {
      this.lastState = { ...state, activeCities: new Map(state.activeCities) };
    },
  };
}

/** Emits one alert on start, then goes silent — simulates a source that
 *  delivered an alert and then became unreachable (no further traffic). */
class OneShotSource implements AlertSource {
  readonly name = 'one-shot';
  readonly type = 'http' as const;
  private cb: ((alerts: OrefRealtimeAlert[]) => void) | null = null;
  constructor(private readonly alert: OrefRealtimeAlert) {}
  onAlerts(cb: (alerts: OrefRealtimeAlert[]) => void): void { this.cb = cb; }
  onHealthChange(): void {}
  isHealthy(): boolean { return false; }
  start(): void { this.cb?.([this.alert]); }
  stop(): void {}
}

describe('Expiry heartbeat (timer-driven, no source traffic)', () => {
  it('auto-clears a stuck sensor when no further alerts arrive', async () => {
    const pipeline = new AlertPipeline(createLogger());
    pipeline.addStage(new DeduplicationStage(30000));
    pipeline.addStage(new ExpiryStage(100)); // 100ms maxAge → ~25ms scan interval

    const accessory = createAccessory();
    pipeline.subscribe(new SensorFilter(
      'Home', createLogger(), accessory, ['city1'],
      new Set(CATEGORY_MAP['rockets']), false,
    ));

    pipeline.addSource(new OneShotSource({
      id: 'a1', cat: String(OrefCategory.Rockets), title: 'Rockets', data: ['city1'], desc: '',
    }));

    pipeline.start();
    // Let the one alert flow through and turn the sensor ON.
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(accessory.lastState?.isActive, true, 'sensor should be ON after the alert');

    // No more source traffic. Wait past maxAge — the heartbeat must drive expiry.
    await new Promise((r) => setTimeout(r, 300));
    pipeline.stop();

    assert.strictEqual(
      accessory.lastState?.isActive, false,
      'sensor must auto-clear via the expiry heartbeat even with no source traffic',
    );
  });
});
