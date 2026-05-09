import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DeduplicationStage } from './DeduplicationStage';
import { OrefCategory } from '../types';

describe('DeduplicationStage', () => {
  it('passes through unique alerts', () => {
    const stage = new DeduplicationStage(30000);
    const alerts = [
      { id: '1', cat: '1', title: 'Rockets', data: ['city1', 'city2'], desc: '' },
    ];
    const result = stage.process(alerts);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].data, ['city1', 'city2']);
  });

  it('filters duplicate cities in same window', () => {
    const stage = new DeduplicationStage(30000);
    const alerts = [
      { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ];
    stage.process(alerts);

    const duplicates = [
      { id: '2', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ];
    const result = stage.process(duplicates);
    assert.strictEqual(result.length, 0);
  });

  it('allows same city with different category', () => {
    const stage = new DeduplicationStage(30000);
    stage.process([
      { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ]);

    const result = stage.process([
      { id: '2', cat: '6', title: 'UAV', data: ['city1'], desc: '' },
    ]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cat, '6');
  });

  it('always passes EventEnded alerts', () => {
    const stage = new DeduplicationStage(30000);
    const ended = [
      { id: '1', cat: String(OrefCategory.EventEnded), title: 'Ended', data: ['city1'], desc: '' },
    ];
    const result1 = stage.process(ended);
    const result2 = stage.process(ended);
    assert.strictEqual(result1.length, 1);
    assert.strictEqual(result2.length, 1);
  });

  it('filters only duplicate cities, keeps new ones', () => {
    const stage = new DeduplicationStage(30000);
    stage.process([
      { id: '1', cat: '1', title: 'Rockets', data: ['city1'], desc: '' },
    ]);

    const result = stage.process([
      { id: '2', cat: '1', title: 'Rockets', data: ['city1', 'city2'], desc: '' },
    ]);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].data, ['city2']);
  });
});
