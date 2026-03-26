import { mock } from 'node:test';
import { CATEGORY_MAP, OrefRealtimeAlert, AlertState } from '../types';
import { OrefClient } from '../clients/orefClient';
import { AlertService } from './AlertService';
import { SensorFilter, AlertAccessory, parseAlerts } from './SensorFilter';
import { DEFAULT_ALERT_TIMEOUT } from '../settings';

// Re-export everything from orefClient.mock so consumers go through this layer
export {
  ROCKET_MISSILE_ALERT,
  HEADSUP_NOTICE_ALERT,
  EARTHQUAKE_ALERT,
  makeAlert,
  makeEventEnded,
  makeHeadsUpNotice,
  rocketMissilePayload,
  headsupNoticePayload,
} from '../clients/orefClient.mock';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

export const originalFetch = globalThis.fetch;

export function createMockLogger() {
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

export function createMockAccessory(): AlertAccessory & { lastState: AlertState | null } {
  return {
    lastState: null,
    updateAlertState(state: AlertState) {
      this.lastState = { ...state, activeCities: new Map(state.activeCities) };
    },
  };
}

export function allCategoryIds(): Set<number> {
  const ids = new Set<number>();
  for (const arr of Object.values(CATEGORY_MAP)) {
    for (const id of arr) {
      ids.add(id);
    }
  }
  return ids;
}

/** Mock globalThis.fetch to return a sequence of JSON responses */
export function mockFetchSequence(sequence: OrefRealtimeAlert[][]): (() => number) {
  let callIndex = 0;
  const jsonBodies = sequence.map((alerts) =>
    alerts.length > 0 ? JSON.stringify(alerts) : '',
  );
  globalThis.fetch = mock.fn(() => {
    const body = callIndex < jsonBodies.length ? jsonBodies[callIndex] : '';
    callIndex++;
    return Promise.resolve({
      text: () => Promise.resolve(body),
      status: 200,
    });
  }) as any;
  return () => (globalThis.fetch as any).mock.calls.length;
}

// ---------------------------------------------------------------------------
// TestPipeline — full flow:
//   globalThis.fetch (mocked) → OrefClient.fetchAlerts (JSON parse, BOM strip,
//   cat 10→99 remap) → parseAlerts → SensorFilter.handleAlerts → AlertAccessory
//
// Two modes:
//   pipeline.poll()       — step-by-step control
//   pipeline.runService() — real AlertService with actual polling timers
// ---------------------------------------------------------------------------

export interface SensorHandle {
  sensor: ReturnType<typeof createMockAccessory>;
  filter: SensorFilter;
  /** Direct access to SensorFilter's internal activeCities map */
  getActiveCities(): Map<string, number>;
}

export class TestPipeline {
  private readonly client: OrefClient;
  private readonly _filters: SensorFilter[] = [];
  readonly log: any;

  constructor(sequence: OrefRealtimeAlert[][]) {
    this.log = createMockLogger();
    mockFetchSequence(sequence);
    this.client = new OrefClient(3000);
  }

  addSensor(
    cities: string[],
    categories: Set<number>,
    opts?: { timeout?: number; prefix?: boolean; name?: string },
  ): SensorHandle {
    const sensor = createMockAccessory();
    const filter = new SensorFilter(
      opts?.name ?? 'Test',
      this.log,
      sensor,
      cities,
      categories,
      opts?.timeout ?? DEFAULT_ALERT_TIMEOUT,
      opts?.prefix ?? false,
    );
    this._filters.push(filter);
    return {
      sensor,
      filter,
      getActiveCities: () => (filter as any).activeCities as Map<string, number>,
    };
  }

  /** One poll: fetch (mocked) → OrefClient parse → parseAlerts → SensorFilter → Accessory */
  async poll(): Promise<void> {
    const alerts = await this.client.fetchAlerts();
    const parsed = parseAlerts(alerts);
    for (const f of this._filters) {
      f.handleAlerts(parsed);
    }
  }

  async pollN(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await this.poll();
    }
  }

  /** Real AlertService polling through OrefClient */
  async runService(opts?: { pollInterval?: number; waitMs?: number }): Promise<void> {
    const service = new AlertService(this.log, this.client, opts?.pollInterval ?? 10);
    for (const f of this._filters) {
      service.registerListener(f);
    }
    service.start();
    await new Promise((r) => setTimeout(r, opts?.waitMs ?? 200));
    service.stop();
  }
}
