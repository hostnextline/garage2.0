import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCKS } from '../lib/dates';
import type { Job } from './types';
import { dayOrder } from './select';

const J = (id: string, block: string, o: Partial<Job> = {}): Job => ({ id, number: id.charCodeAt(0), block, stop_order: null, eta_min: null, ...o } as Job);
const ids = (list: Job[]) => list.slice().sort(dayOrder(DEFAULT_BLOCKS)).map((j) => j.id).join('');

describe('the order of a day\'s jobs', () => {
  it('blocks: morning, afternoon, evening, then the stop, then the number (as before)', () => {
    expect(ids([J('d', 'eve', { stop_order: 1 }), J('c', 'pm', { stop_order: 2 }), J('b', 'pm', { stop_order: 1 }), J('a', 'am', { stop_order: 3 }), J('e', 'eve')])).toBe('abcde');
  });
  it('arrival windows (every job \'day\'): the stop, then the planned arrival', () => {
    expect(ids([J('c', 'day', { stop_order: 2, eta_min: 600 }), J('a', 'day', { stop_order: 1, eta_min: 900 }), J('b', 'day', { stop_order: 1, eta_min: 950 }), J('d', 'day', { win_start: 480 }), J('e', 'day')])).toBe('abcde');
  });
  it('a day holding both: a \'day\' job goes with the block its arrival falls in, after that block\'s own jobs', () => {
    expect(ids([J('e', 'eve', { stop_order: 1 }), J('d', 'day', { eta_min: 800 }), J('c', 'pm', { stop_order: 1 }), J('b', 'day', { eta_min: 500 }), J('a', 'am', { stop_order: 2 }), J('f', 'day')])).toBe('abcdef');
  });
});
