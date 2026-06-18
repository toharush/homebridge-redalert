import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import { HealthStatusService, SourceHealth } from './HealthStatusService';

const tick = () => new Promise((r) => setImmediate(r));

describe('HealthStatusService', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('never has two writes in flight at once (no shared-tmp corruption)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    const written: string[] = [];

    mock.method(fs.promises, 'writeFile', (_path: string, data: string) => {
      written.push(data);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((res) => {
        resolvers.push(() => {
          inFlight--;
          res();
        });
      });
    });
    mock.method(fs.promises, 'rename', () => Promise.resolve());

    const svc = new HealthStatusService('/tmp/redalert-status-test.json');
    const a: SourceHealth[] = [{ name: 'A', type: 'http', healthy: true }];
    const b: SourceHealth[] = [{ name: 'A', type: 'http', healthy: false }];

    // Two rapid updates, as in discoverDevices vs. a health-change callback.
    svc.update(a);
    svc.update(b);

    // Drain the (serialized) write chain.
    while (resolvers.length > 0) {
      resolvers.shift()!();
      await tick();
    }

    assert.strictEqual(maxInFlight, 1, 'at most one write may be in flight at a time');
    assert.strictEqual(
      JSON.parse(written[written.length - 1])[0].healthy,
      false,
      'the latest status must win',
    );
  });
});
