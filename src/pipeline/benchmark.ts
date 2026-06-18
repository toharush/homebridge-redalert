/**
 * Micro-benchmark for the alert hot path: ExpiryStage → DeduplicationStage →
 * SensorFilter. Run with: npx tsx src/pipeline/benchmark.ts
 *
 * Not a test — a measurement tool. Reports ops/sec for ingesting a batch of
 * alerts end to end, across realistic workload sizes. Excluded from the
 * published build (tsconfig) since it is a developer tool, not runtime code.
 */
/* eslint-disable no-console */
import { DeduplicationStage } from './DeduplicationStage';
import { ExpiryStage } from './ExpiryStage';
import { SensorFilter, ParsedAlerts } from '../services/SensorFilter';
import { OrefRealtimeAlert, OrefCategory, CATEGORY_MAP } from '../types';
import cities from '../data/cities.json';

const CITY_NAMES: string[] = (cities as { name: string }[]).map((c) => c.name);

function noopLogger(): any {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop, log: noop, success: noop, easyDebug: noop, prefix: '' };
}

/** A listener target that mimics MotionSensorAccessory without HomeKit. */
function makeAccessory() {
  return { updateAlertState() {} };
}

function buildFilter(monitoredCities: string[]): SensorFilter {
  return new SensorFilter(
    'bench', noopLogger(), makeAccessory(), monitoredCities,
    new Set(Object.values(CATEGORY_MAP).flat()), false,
  );
}

function batchOf(cityCount: number, cat = OrefCategory.Rockets): OrefRealtimeAlert[] {
  const data = CITY_NAMES.slice(0, cityCount);
  return [{ id: 'b', cat: String(cat), title: 'ירי רקטות וטילים', data, desc: 'desc' }];
}

/** One full ingest pass, exactly as AlertPipeline.ingest wires it.
 *  freshEachPass=true clears dedup state per op so the FULL path runs every
 *  time (a fresh siren → filters fire). freshEachPass=false leaves dedup state,
 *  measuring the duplicate-drop path (repeat alerts within the 30s window). */
function makePipelineFn(filterCount: number, freshEachPass: boolean, citiesPerSensor = 5) {
  const dedup = new DeduplicationStage(30000);
  const expiry = new ExpiryStage(1800000);
  expiry.attachSeen(dedup.seen);
  dedup.setMinRetention(expiry.maxAgeMs);

  // Monitor a spread of real cities so the filter does real matching work.
  const filters = Array.from({ length: filterCount }, (_, i) =>
    buildFilter(CITY_NAMES.slice(i * citiesPerSensor, i * citiesPerSensor + citiesPerSensor)));

  return (alerts: OrefRealtimeAlert[]) => {
    if (freshEachPass) {
      dedup.seen.clear();
    }
    let current = expiry.process(alerts);
    current = dedup.process(current);
    if (current.length === 0) {
      return;
    }
    const parsed = dedup.parsed as ParsedAlerts;
    if (!parsed) {
      return;
    }
    for (let i = 0; i < filters.length; i++) {
      filters[i].handleAlerts(parsed);
    }
  };
}

function bench(label: string, fn: () => void, durationMs = 1500): void {
  // Warmup
  const warmupEnd = Date.now() + 200;
  while (Date.now() < warmupEnd) {
    fn();
  }
  // Measure
  let ops = 0;
  const end = Date.now() + durationMs;
  const t0 = process.hrtime.bigint();
  while (Date.now() < end) {
    fn();
    ops++;
  }
  const elapsedNs = Number(process.hrtime.bigint() - t0);
  const opsPerSec = (ops / elapsedNs) * 1e9;
  const usPerOp = elapsedNs / ops / 1000;
  console.log(
    `  ${label.padEnd(42)} ${opsPerSec.toFixed(0).padStart(12)} ops/sec   ${usPerOp.toFixed(3).padStart(9)} µs/op`,
  );
}

/** Pre-build a pool of distinct batches so the measured loop does ZERO
 *  allocation of its own — we measure pipeline work, not array building. */
function buildBatchPool(cityCount: number, poolSize = 64): OrefRealtimeAlert[][] {
  const pool: OrefRealtimeAlert[][] = [];
  for (let p = 0; p < poolSize; p++) {
    const data: string[] = new Array(cityCount);
    for (let i = 0; i < cityCount; i++) {
      data[i] = CITY_NAMES[(p * cityCount + i) % CITY_NAMES.length];
    }
    pool.push([{ id: `b${p}`, cat: '1', title: 't', data, desc: 'd' }]);
  }
  return pool;
}

console.log('\nAlert hot-path micro-benchmark (ExpiryStage → Dedup → SensorFilter)\n');

for (const [pathLabel, fresh] of [['FRESH alerts (filters fire)', true], ['DUPLICATE alerts (dedup drops)', false]] as const) {
  console.log(`\n### ${pathLabel} ###`);
  for (const sensors of [1, 10, 50]) {
    console.log(`── ${sensors} sensor(s) ──`);
    for (const cityCount of [1, 10, 50, 200]) {
      const run = makePipelineFn(sensors, fresh);
      const pool = buildBatchPool(cityCount);
      let n = 0;
      bench(`${cityCount} cities/batch`, () => {
        run(pool[(n++) & 63]);
      });
    }
  }
  void batchOf;
}

// Focused: a "whole country" sensor (monitors 200 cities) against a SMALL
// real-world batch (1–3 cities) — exposes whether iterating citySet vs. the
// alert set matters.
console.log('\n### WIDE sensor (200 cities) vs small fresh batch ###');
for (const cityCount of [1, 3, 10]) {
  const run = makePipelineFn(10, true, 200);
  const pool = buildBatchPool(cityCount);
  let n = 0;
  bench(`10 sensors×200 cities, batch=${cityCount}`, () => {
    run(pool[(n++) & 63]);
  });
}
