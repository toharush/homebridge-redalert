import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { DeduplicationStage } from './DeduplicationStage';
import { OrefCategory } from '../types';

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    log: mock.fn(),
    success: mock.fn(),
    easyDebug: mock.fn(),
    prefix: '',
  } as any;
}

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

  it('real scenario: Tzofar arrives first, Pikud HaOref 5s later — only one passes', () => {
    const log = createMockLogger();
    const stage = new DeduplicationStage(30000, log);

    const tzofarAlert = {
      id: 'tzofar-1778835536091',
      cat: '6',
      title: 'Threat 5',
      data: ['שומרה'],
      desc: '',
    };

    const orefAlert = {
      id: '134233091340000000',
      cat: '6',
      title: 'חדירת כלי טיס עוין',
      data: ['שומרה'],
      desc: 'היכנסו מייד למרחב המוגן ',
    };

    const result1 = stage.process([tzofarAlert], 'Tzofar');
    assert.strictEqual(result1.length, 1, 'Tzofar alert should pass through');
    assert.deepStrictEqual(result1[0].data, ['שומרה']);

    const result2 = stage.process([orefAlert], 'Pikud HaOref');
    assert.strictEqual(result2.length, 0, 'Pikud HaOref duplicate should be dropped');

    assert(log.easyDebug.mock.calls.length > 0, 'Debug logs should have been emitted');
    const logMessages = log.easyDebug.mock.calls.map((c: any) => {
      const arg = c.arguments[0];
      return typeof arg === 'function' ? arg() : arg;
    });
    assert(logMessages.some((m: string) => m.includes('WINNER') && m.includes('Tzofar')));
    assert(logMessages.some((m: string) => m.includes('DROP') && m.includes('Pikud HaOref')));
  });

  it('real scenario: event-ended from both sources — both pass through', () => {
    const log = createMockLogger();
    const stage = new DeduplicationStage(30000, log);

    const tzofarEnded = {
      id: 'tzofar-exit-1778836112281',
      cat: '99',
      title: 'עדכון פיקוד העורף - סיום אירוע',
      data: ['רחבי הארץ'],
      desc: 'האירוע הסתיים באבן מנחם, זרעית, שומרה',
    };

    const orefEnded = {
      id: '134233097100000000',
      cat: '99',
      title: 'האירוע הסתיים',
      data: ['אבן מנחם', 'זרעית', 'שומרה'],
      desc: 'השוהים במרחב המוגן יכולים לצאת. בעת קבלת הנחיה או התרעה, יש לפעול בהתאם להנחיות פיקוד העורף.',
    };

    const result1 = stage.process([tzofarEnded], 'Tzofar');
    assert.strictEqual(result1.length, 1, 'Tzofar event-ended should pass');

    const result2 = stage.process([orefEnded], 'Pikud HaOref');
    assert.strictEqual(result2.length, 1, 'Pikud HaOref event-ended should also pass');
  });

  it('real scenario: Pikud HaOref wins if it arrives first', () => {
    const log = createMockLogger();
    const stage = new DeduplicationStage(30000, log);

    const orefAlert = {
      id: '134233091340000000',
      cat: '6',
      title: 'חדירת כלי טיס עוין',
      data: ['שומרה'],
      desc: 'היכנסו מייד למרחב המוגן ',
    };

    const tzofarAlert = {
      id: 'tzofar-1778835536091',
      cat: '6',
      title: 'Threat 5',
      data: ['שומרה'],
      desc: '',
    };

    const result1 = stage.process([orefAlert], 'Pikud HaOref');
    assert.strictEqual(result1.length, 1, 'Pikud HaOref alert should pass through');

    const result2 = stage.process([tzofarAlert], 'Tzofar');
    assert.strictEqual(result2.length, 0, 'Tzofar duplicate should be dropped');

    const logMessages = log.easyDebug.mock.calls.map((c: any) => {
      const arg = c.arguments[0];
      return typeof arg === 'function' ? arg() : arg;
    });
    assert(logMessages.some((m: string) => m.includes('WINNER') && m.includes('Pikud HaOref')));
    assert(logMessages.some((m: string) => m.includes('DROP') && m.includes('Tzofar')));
  });
});
