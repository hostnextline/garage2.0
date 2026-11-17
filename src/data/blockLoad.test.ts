/* How full a block is (blockLoad), today: a job under way counts only for what it still needs, as the planner and the
   agenda count it, and a whole day of arrival windows starts at its last minute like the server says (R216). The clock
   is frozen at an instant of Montréal, so the test says the same on a machine in UTC or in Tokyo. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { replaceLocal, clearAll } from './store';
import { blockLoad, jobTimeLeft } from './select';
import type { Job } from './types';

const DAY = '2026-11-16';                     // a Monday, Montréal on EST (UTC−5)
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-05:00`);
const job = (p: Partial<Job> & { id: string }): Partial<Job> & { id: string } => ({ day: DAY, block: 'am', truck_id: 't1', status: 'booked', duration_min: 60, travel_min: 10, eta_min: null, arrived_at: null, stop_order: null, number: 1, deleted_at: null, ...p });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clearAll();
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 0, driver_id: null }]);
  replaceLocal('truck_days', [{ id: 'td1', truck_id: 't1', day: DAY, ranges: [[480, 1200]] }]);
});
afterEach(() => { vi.useRealTimers(); clearAll(); });

describe('blockLoad counts a job under way by the time it still needs (R216)', () => {
  it('on site since 10:00, a 120-minute job, at 11:00: 60 minutes used', () => {
    vi.setSystemTime(at('11:00'));
    replaceLocal('jobs', [job({ id: 'a', status: 'on_site', duration_min: 120, arrived_at: at('10:00').toISOString() })]);
    const t1 = blockLoad(DAY, 'am').trucks[0];
    expect(t1.used).toBe(60);
    // 11:00 → 12:00 left in the morning
    expect(t1.cap).toBe(60);
    expect(t1.left).toBe(0);
  });
  it('on the way: the drive left, then the work; booked: whole; done: nothing', () => {
    vi.setSystemTime(at('11:00'));
    replaceLocal('jobs', [
      job({ id: 'b', status: 'en_route', duration_min: 60, eta_min: 11 * 60 + 30 }),
      job({ id: 'c', status: 'booked', duration_min: 30, travel_min: 10 }),
      job({ id: 'd', status: 'done', duration_min: 90 })
    ]);
    expect(blockLoad(DAY, 'am').trucks[0].used).toBe(30 + 60 + 30 + 10);
  });
  it('another day: every job counts whole, as before', () => {
    vi.setSystemTime(at('11:00'));
    replaceLocal('truck_days', [{ id: 'td2', truck_id: 't1', day: '2026-11-17', ranges: [[480, 1200]] }]);
    replaceLocal('jobs', [job({ id: 'e', day: '2026-11-17', status: 'booked', duration_min: 120, travel_min: null })]);
    expect(blockLoad('2026-11-17', 'am').trucks[0].used).toBe(120 + 20);
  });
  it('an arrival of another day counts from midnight (never more than the work itself)', () => {
    expect(jobTimeLeft({ status: 'on_site', duration_min: 120, travel_min: null, eta_min: null, arrived_at: new Date('2026-11-15T17:00:00-05:00').toISOString() }, 9 * 60, 20, DAY)).toBe(0);
    expect(jobTimeLeft({ status: 'on_site', duration_min: 120, travel_min: null, eta_min: null, arrived_at: null }, 9 * 60, 20, DAY)).toBe(120);
  });
});

describe('a whole day of arrival windows has started at its last minute, as the server\'s block_open says (R216, agenda-11)', () => {
  it('19:30: still open to change; 20:00: started', () => {
    replaceLocal('jobs', []);
    vi.setSystemTime(at('19:30'));
    expect(blockLoad(DAY, 'day').started).toBe(false);
    vi.setSystemTime(at('20:00'));
    expect(blockLoad(DAY, 'day').started).toBe(true);
  });
  it('a block still starts at its first minute', () => {
    vi.setSystemTime(at('07:59'));
    expect(blockLoad(DAY, 'am').started).toBe(false);
    vi.setSystemTime(at('08:00'));
    expect(blockLoad(DAY, 'am').started).toBe(true);
  });
});
