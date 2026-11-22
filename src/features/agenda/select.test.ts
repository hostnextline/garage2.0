/* How the agenda draws a day, in both modes (x-dualmode-19), and who sees what. Real store rows, a fixed clock. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import type { Access } from '../../data/types';
import { dayPlan, laneShown, jobShown, workingTrucks } from './select';

const TODAY = '2026-11-17';   // a Tuesday
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const saleh = { id: 'saleh', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;

function garage(windows: boolean) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: windows, min_block_min: 45, unknown_min: 20 } }]);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, driver_id: null, color: null }, { id: 't2', name: 'Voiture', active: true, sort: 2, driver_id: null, color: null }]);
  // both work Tuesday and Wednesday, 8 h – 16 h
  replaceLocal('truck_week', [2, 3].flatMap((dow) => [{ id: `w1-${dow}`, truck_id: 't1', dow, ranges: [[480, 960]] }, { id: `w2-${dow}`, truck_id: 't2', dow, ranges: [[480, 960]] }]));
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T09:00:00-05:00')); });
afterEach(() => { vi.useRealTimers(); clearAll(); access.value = null; });

describe('a day of blocks', () => {
  it('has its three blocks, each truck a lane with its jobs', () => {
    garage(false);
    access.value = owner;
    replaceLocal('jobs', [{ id: 'a', day: '2026-11-18', block: 'am', truck_id: 't1', status: 'booked', duration_min: 60, travel_min: 20, number: 1, stop_order: 1 }]);
    const plan = dayPlan('2026-11-18', TODAY);
    expect(plan.window).toBe(false);
    expect(plan.views.map((v) => v.key)).toEqual(['am', 'pm', 'eve']);
    const am = plan.views[0];
    expect(am.lanes.find((x) => x.truck.id === 't1')).toMatchObject({ used: 80, cap: 240, left: 160 });
    expect(am).toMatchObject({ open: true, started: false, closed: false, room: true, jobs: 1 });
    // the evening: nobody works after 16 h
    expect(plan.views[2]).toMatchObject({ open: false, closed: true });
    expect(workingTrucks(plan)).toBe(2);
  });
});

describe('a day of arrival windows', () => {
  it('is ONE place, then the blocks that still hold jobs right after the switch', () => {
    garage(true);
    access.value = owner;
    replaceLocal('jobs', [
      { id: 'w', day: '2026-11-18', block: 'day', truck_id: 't1', status: 'booked', duration_min: 60, travel_min: 20, number: 1, stop_order: 1, win_start: 540, win_end: 780 },
      { id: 'old', day: '2026-11-18', block: 'pm', truck_id: 't2', status: 'booked', duration_min: 60, travel_min: 20, number: 2, stop_order: 1 }
    ]);
    const plan = dayPlan('2026-11-18', TODAY);
    expect(plan.window).toBe(true);
    expect(plan.views.map((v) => v.key)).toEqual(['day', 'pm']);
  });
  it('today late: still working, no longer booking, never « Fermé » (agenda-06)', () => {
    garage(true);
    access.value = owner;
    vi.setSystemTime(new Date('2026-11-17T16:30:00-05:00'));
    const day = dayPlan(TODAY, TODAY).views[0];
    expect(day).toMatchObject({ key: 'day', open: false, started: false, closed: false });
  });
  it('today: a job under way counts only for what it still needs (agenda-04)', () => {
    garage(true);
    access.value = owner;
    vi.setSystemTime(new Date('2026-11-17T14:00:00-05:00'));
    // this truck works until 17 h today: 180 min left at 14 h
    replaceLocal('truck_days', [{ id: 'd1', truck_id: 't1', day: TODAY, ranges: [[480, 1020]], note: null }]);
    replaceLocal('jobs', [
      { id: 'site', day: TODAY, block: 'day', truck_id: 't1', status: 'on_site', duration_min: 120, travel_min: 20, number: 1, stop_order: 1, arrived_at: new Date('2026-11-17T12:00:00-05:00').toISOString() },
      { id: 'b1', day: TODAY, block: 'day', truck_id: 't1', status: 'booked', duration_min: 60, travel_min: 20, number: 2, stop_order: 2 },
      { id: 'b2', day: TODAY, block: 'day', truck_id: 't1', status: 'booked', duration_min: 30, travel_min: 20, number: 3, stop_order: 3 }
    ]);
    const lane = dayPlan(TODAY, TODAY).views[0].lanes.find((x) => x.truck.id === 't1')!;
    expect(lane.cap).toBe(180);
    expect(lane.used).toBe(130);
    expect(lane.left).toBe(50);
  });
});

describe('a job under way counts as the pickers count it (S06)', () => {
  const onSite = (arrived: string) => [{ id: 'site', day: TODAY, block: 'am', truck_id: 't1', status: 'on_site', duration_min: 120, travel_min: 20, number: 1, stop_order: 1, arrived_at: new Date(arrived).toISOString() }];
  const lane = () => dayPlan(TODAY, TODAY).views[0].lanes.find((x) => x.truck.id === 't1')!;
  it('on site since yesterday 15:00: its time is over at 10:00, not 420 min still to come', () => {
    garage(false);
    access.value = owner;
    vi.setSystemTime(new Date('2026-11-17T10:00:00-05:00'));
    replaceLocal('jobs', onSite('2026-11-16T15:00:00-05:00'));
    expect(lane()).toMatchObject({ used: 0, cap: 120, left: 120 });
  });
  it('on site since 10:00 today, at 11:00: 60 min still to do', () => {
    garage(false);
    access.value = owner;
    vi.setSystemTime(new Date('2026-11-17T11:00:00-05:00'));
    replaceLocal('jobs', onSite('2026-11-17T10:00:00-05:00'));
    expect(lane()).toMatchObject({ used: 60, cap: 60, left: 0 });
  });
});

describe('who sees what', () => {
  it('a mechanic without « agenda » keeps to his truck’s lanes and jobs (and the ones he booked)', () => {
    access.value = saleh;
    expect(laneShown('t1')).toBe(true);
    expect(laneShown('t2')).toBe(false);
    expect(jobShown({ truck_id: 't2', created_by: 'saleh' })).toBe(true);
    expect(jobShown({ truck_id: 't2', created_by: 'nadia' })).toBe(false);
    access.value = owner;
    expect(laneShown('t2')).toBe(true);
  });
});
