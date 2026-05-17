import { performance } from 'perf_hooks';
import { AlertPipeline } from './src/pipeline/AlertPipeline';
import { ExpiryStage } from './src/pipeline/ExpiryStage';
import { DeduplicationStage } from './src/pipeline/DeduplicationStage';
import { AlertHistory } from './src/pipeline/AlertHistory';
import { SensorFilter, parseAlerts } from './src/services/SensorFilter';
import { OrefCategory, OrefRealtimeAlert } from './src/types';
import { CATEGORY_MAP } from './src/types';

const log = { info() {}, warn() {}, error() {}, debug() {}, log() {}, success() {}, easyDebug() {}, prefix: '' } as any;

function allCategoryIds(): Set<number> {
  const ids = new Set<number>();
  for (const arr of Object.values(CATEGORY_MAP)) {
    for (const id of arr) ids.add(id);
  }
  return ids;
}

function makeAlerts(count: number): OrefRealtimeAlert[] {
  const alerts: OrefRealtimeAlert[] = [];
  for (let i = 0; i < count; i++) {
    alerts.push({
      id: `alert-${i}-${Date.now()}`,
      cat: String(OrefCategory.Rockets),
      title: 'ירי רקטות וטילים',
      data: [`city-${i}`, `city-${i + 100}`],
      desc: '',
    });
  }
  return alerts;
}

function makeSensors(count: number) {
  const sensors: { filter: SensorFilter; accessory: any }[] = [];
  for (let i = 0; i < count; i++) {
    const accessory = { updateAlertState() {} };
    const cities = [`city-${i}`, `city-${i + 1}`, `city-${i + 100}`];
    const filter = new SensorFilter(`sensor-${i}`, log, accessory, cities, allCategoryIds(), false);
    sensors.push({ filter, accessory });
  }
  return sensors;
}

// --- V2 Benchmark: Full pipeline with two sources (Oref + Tzofar) ---
function benchV2Pipeline(iterations: number, alertCount: number, sensorCount: number) {
  const pipeline = new AlertPipeline(log);
  const history = new AlertHistory(1000);

  pipeline.addStage(new DeduplicationStage(30000, undefined, history));
  pipeline.addStage(new ExpiryStage(1800000));
  pipeline.subscribe(history);

  const sensors = makeSensors(sensorCount);
  for (const { filter } of sensors) {
    pipeline.subscribe(filter);
  }

  const alerts = makeAlerts(alertCount);

  // Warm up
  for (let i = 0; i < 10; i++) {
    const warmAlerts = alerts.map((a) => ({ ...a, id: `warm-${i}-${a.id}` }));
    (pipeline as any).ingest('Pikud HaOref', warmAlerts);
    (pipeline as any).ingest('Tzofar', warmAlerts.map((a: any) => ({ ...a, id: `tz-warm-${i}-${a.id}` })));
  }

  history.clear();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const runAlerts = alerts.map((a) => ({ ...a, id: `run-${i}-${a.id}` }));
    // Oref delivers first
    (pipeline as any).ingest('Pikud HaOref', runAlerts);
    // Tzofar delivers same cities ~1-5s later (different IDs, same cat+city = dedup drops)
    (pipeline as any).ingest('Tzofar', runAlerts.map((a: any) => ({ ...a, id: `tz-${i}-${a.id}` })));
  }
  return performance.now() - start;
}

// --- V1 Benchmark: Direct parseAlerts + handleAlerts (no pipeline, no dedup) ---
// V1 has no dedup — when both sources deliver same alerts, sensors fire twice
function benchV1Direct(iterations: number, alertCount: number, sensorCount: number) {
  const sensors = makeSensors(sensorCount);
  const alerts = makeAlerts(alertCount);

  // Warm up
  for (let i = 0; i < 10; i++) {
    const parsed = parseAlerts(alerts);
    for (const { filter } of sensors) {
      filter.handleAlerts(parsed);
    }
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // V1 processes both source deliveries — no dedup to drop the second
    const parsed = parseAlerts(alerts);
    for (const { filter } of sensors) {
      filter.handleAlerts(parsed);
    }
    // Second source delivers same cities
    const parsed2 = parseAlerts(alerts);
    for (const { filter } of sensors) {
      filter.handleAlerts(parsed2);
    }
  }
  return performance.now() - start;
}

// --- V2 Short-circuit Benchmark: most sensors don't match ---
function benchV2ShortCircuit(iterations: number, alertCount: number, sensorCount: number) {
  const pipeline = new AlertPipeline(log);
  const history = new AlertHistory(1000);

  pipeline.addStage(new DeduplicationStage(30000, undefined, history));
  pipeline.addStage(new ExpiryStage(1800000));
  pipeline.subscribe(history);

  // Only 1 sensor matches, rest monitor unrelated cities
  for (let i = 0; i < sensorCount; i++) {
    const accessory = { updateAlertState() {} };
    const cities = i === 0
      ? [`city-0`, `city-1`, `city-2`]
      : [`unrelated-${i}-a`, `unrelated-${i}-b`, `unrelated-${i}-c`];
    const filter = new SensorFilter(`sensor-${i}`, log, accessory, cities, allCategoryIds(), false);
    pipeline.subscribe(filter);
  }

  const alerts = makeAlerts(alertCount);

  // Warm up (first broadcast establishes hasBroadcast flag)
  for (let i = 0; i < 5; i++) {
    const warmAlerts = alerts.map((a) => ({ ...a, id: `warm-${i}-${a.id}` }));
    (pipeline as any).ingest('Pikud HaOref', warmAlerts);
  }
  history.clear();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const runAlerts = alerts.map((a) => ({ ...a, id: `run-${i}-${a.id}` }));
    (pipeline as any).ingest('Pikud HaOref', runAlerts);
  }
  return performance.now() - start;
}

// --- V1 Benchmark with non-matching sensors (no short-circuit) ---
function benchV1NoShortCircuit(iterations: number, alertCount: number, sensorCount: number) {
  const sensors: { filter: SensorFilter; accessory: any }[] = [];
  for (let i = 0; i < sensorCount; i++) {
    const accessory = { updateAlertState() {} };
    const cities = i === 0
      ? [`city-0`, `city-1`, `city-2`]
      : [`unrelated-${i}-a`, `unrelated-${i}-b`, `unrelated-${i}-c`];
    const filter = new SensorFilter(`sensor-${i}`, log, accessory, cities, allCategoryIds(), false);
    sensors.push({ filter, accessory });
  }
  const alerts = makeAlerts(alertCount);

  // Warm up
  for (let i = 0; i < 5; i++) {
    const parsed = parseAlerts(alerts);
    for (const { filter } of sensors) {
      filter.handleAlerts(parsed);
    }
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const parsed = parseAlerts(alerts);
    for (const { filter } of sensors) {
      filter.handleAlerts(parsed);
    }
  }
  return performance.now() - start;
}

// --- Run benchmarks ---
const ITERATIONS = 10000;
const scenarios = [
  { alerts: 1, sensors: 1, label: '1 alert, 1 sensor' },
  { alerts: 5, sensors: 3, label: '5 alerts, 3 sensors' },
  { alerts: 20, sensors: 10, label: '20 alerts, 10 sensors' },
  { alerts: 50, sensors: 20, label: '50 alerts, 20 sensors' },
  { alerts: 1000, sensors: 10, label: '1000 alerts, 50 sensors' },
];

console.log(`\n${'═'.repeat(70)}`);
console.log('  BENCHMARK: v1 (direct) vs v2 (full pipeline)');
console.log(`  ${ITERATIONS.toLocaleString()} iterations per scenario`);
console.log(`${'═'.repeat(70)}\n`);

console.log(`${'Scenario'.padEnd(25)} ${'v1 (ms)'.padStart(10)} ${'v2 (ms)'.padStart(10)} ${'v2/v1'.padStart(8)} ${'per-op v2'.padStart(12)}`);
console.log(`${'-'.repeat(70)}`);

for (const { alerts, sensors, label } of scenarios) {
  const v1 = benchV1Direct(ITERATIONS, alerts, sensors);
  const v2 = benchV2Pipeline(ITERATIONS, alerts, sensors);
  const ratio = (v2 / v1).toFixed(2);
  const perOp = ((v2 / ITERATIONS) * 1000).toFixed(1);
  console.log(`${label.padEnd(25)} ${v1.toFixed(1).padStart(10)} ${v2.toFixed(1).padStart(10)} ${(ratio + 'x').padStart(8)} ${(perOp + 'µs').padStart(12)}`);
}

console.log(`\n${'═'.repeat(70)}`);
console.log('  v1 = parseAlerts + handleAlerts (no dedup, no expiry, no history)');
console.log('  v2 = ExpiryStage + DeduplicationStage + AlertHistory + handleAlerts');
console.log(`${'═'.repeat(70)}\n`);

// --- Short-circuit benchmark ---
const scScenarios = [
  { alerts: 5, sensors: 10, label: '5 alerts, 10 sensors (1 match)' },
  { alerts: 20, sensors: 20, label: '20 alerts, 20 sensors (1 match)' },
  { alerts: 50, sensors: 50, label: '50 alerts, 50 sensors (1 match)' },
];

console.log(`\n${'═'.repeat(70)}`);
console.log('  SHORT-CIRCUIT: non-matching sensors skip full iteration');
console.log(`  ${ITERATIONS.toLocaleString()} iterations per scenario`);
console.log(`${'═'.repeat(70)}\n`);

console.log(`${'Scenario'.padEnd(35)} ${'no-skip (ms)'.padStart(12)} ${'skip (ms)'.padStart(12)} ${'speedup'.padStart(10)}`);
console.log(`${'-'.repeat(70)}`);

for (const { alerts, sensors, label } of scScenarios) {
  const noSkip = benchV1NoShortCircuit(ITERATIONS, alerts, sensors);
  const skip = benchV2ShortCircuit(ITERATIONS, alerts, sensors);
  const speedup = (noSkip / skip).toFixed(2);
  console.log(`${label.padEnd(35)} ${noSkip.toFixed(1).padStart(12)} ${skip.toFixed(1).padStart(12)} ${(speedup + 'x').padStart(10)}`);
}

console.log(`\n${'═'.repeat(70)}`);
console.log('  no-skip = v1 style (all sensors iterate all configured cities)');
console.log('  skip    = v2 short-circuit (idle sensors bail after Set.has check)');
console.log(`${'═'.repeat(70)}\n`);
