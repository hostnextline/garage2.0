import { describe, it, expect } from 'vitest';
import { blockOpen, closedJobs, otherKind, movesFor, windowOpen, jobOpen } from './closing';
import { DEFAULT_BLOCKS, type Range } from '../../lib/dates';
import type { Job, Truck } from '../../data/types';

const blockOf = (k: string) => DEFAULT_BLOCKS.find((b) => b.key === k)!;
const job = (id: string, day: string, block: string, o: Partial<Job> = {}) => ({ id, truck_id: 'car', status: 'booked', day, block, stop_order: 1, ...o }) as Job;
const car = { id: 'car', active: true, tire_machine: false } as Truck;
const truck = { id: 'truck', active: true, tire_machine: true } as Truck;
// 2026-11-17 is a Tuesday (2), the 18th a Wednesday (3)
const jobs = [job('a', '2026-11-17', 'am'), job('b', '2026-11-17', 'pm'), job('c', '2026-11-18', 'am'), job('d', '2026-11-17', 'am', { truck_id: 'truck' }), job('e', '2026-11-17', 'am', { status: 'done' })];

describe('a vehicle closes: the appointments touched', () => {
  it('a block is open while some hours cover a part of it', () => {
    expect(blockOpen([[480, 720]], blockOf('am'))).toBe(true);
    expect(blockOpen([[480, 720]], blockOf('pm'))).toBe(false);
    expect(blockOpen([], blockOf('am'))).toBe(false);
  });
  it('the whole day closed: its booked appointments on that date, in the order of the day; not the other dates, vehicles or done work', () => {
    expect(closedJobs(jobs, 'car', { 2: [] }, ['2026-11-17'], blockOf).map((j) => j.id)).toEqual(['a', 'b']);
  });
  it('only the afternoon closed: only the afternoon appointment', () => {
    expect(closedJobs(jobs, 'car', { 2: [[480, 720]] }, ['2026-11-17'], blockOf).map((j) => j.id)).toEqual(['b']);
  });
  it('the other kind only; each appointment goes to a vehicle open then; tire-machine work never to the car', () => {
    expect(otherKind([car, truck, { ...truck, id: 'old', active: false }], 'car').map((x) => x.id)).toEqual(['truck']);
    const hours = (id: string, day: string): Range[] => (id === 'truck' && day === '2026-11-17' ? [[480, 720]] : []);
    const m = movesFor(closedJobs(jobs, 'car', { 2: [], 3: [] }, ['2026-11-17', '2026-11-18'], blockOf), [truck], hours, blockOf);
    expect(m.map((x) => [x.job.id, x.target, x.why])).toEqual([['a', 'truck', null], ['b', null, 'closed'], ['c', null, 'closed']]);
    const back = movesFor([job('m', '2026-11-17', 'am', { truck_id: 'truck', needs_machine: true })], [car], () => [[480, 720]], blockOf);
    expect(back[0]).toMatchObject({ target: null, why: 'machine' });
  });
});

describe('a vehicle closes, « Plages d\'arrivée » (block \'day\'): the window told to the customer decides', () => {
  const dayBlock = (k: string) => (k === 'day' ? { key: 'day' as const, start: 480, end: 1200 } : blockOf(k));
  const w = (id: string, win: [number, number] | null, o: Partial<Job> = {}) =>
    job(id, '2026-11-17', 'day', { duration_min: 60, win_start: win ? win[0] : null, win_end: win ? win[1] : null, win_flex: !win, ...o });
  it('the hours hold a window while the vehicle can arrive inside it and finish the work before it closes', () => {
    expect(windowOpen([[480, 720]], [600, 840], 60)).toBe(true);     // arrive at 10 h, done at 11 h
    expect(windowOpen([[480, 720]], [690, 930], 60)).toBe(false);    // 11 h 30 + 1 h goes past noon
    expect(windowOpen([[480, 720]], [720, 960], 30)).toBe(false);    // the window opens when the vehicle closes
    expect(windowOpen([[480, 600], [900, 1080]], [660, 900], 60)).toBe(true); // back at 15 h, the end of the window
    expect(windowOpen([], [600, 840], 60)).toBe(false);
  });
  it('a job by window: its window; a flexible one: any time of the day; a block job: its block as before', () => {
    expect(jobOpen([[480, 720]], w('a', [840, 1080]), dayBlock)).toBe(false);
    expect(jobOpen([[480, 720]], w('b', [540, 780]), dayBlock)).toBe(true);
    expect(jobOpen([[480, 720]], w('c', null), dayBlock)).toBe(true);
    expect(jobOpen([[480, 520]], w('d', null), dayBlock)).toBe(false);  // 40 minutes left for an hour of work
    expect(jobOpen([[480, 720]], job('e', '2026-11-17', 'pm'), dayBlock)).toBe(false);
  });
  it('closing the afternoon touches only the windows the morning cannot hold, in the order of the route', () => {
    const list = [w('late', [840, 1080], { stop_order: 3, eta_min: 900 }), w('early', [480, 720], { stop_order: 1, eta_min: 500 }), w('mid', [780, 1020], { stop_order: 2, eta_min: 840 }), w('flex', null, { stop_order: 4 })];
    expect(closedJobs(list, 'car', { 2: [[480, 720]] }, ['2026-11-17'], dayBlock).map((j) => j.id)).toEqual(['mid', 'late']);
    expect(closedJobs(list, 'car', { 2: [] }, ['2026-11-17'], dayBlock).map((j) => j.id)).toEqual(['early', 'mid', 'late', 'flex']);
  });
  it('the other vehicle takes a job only when it works inside the window told (same day, same window)', () => {
    const hit = [w('mid', [780, 1020]), w('late', [840, 1080])];
    const m = movesFor(hit, [truck], () => [[480, 840]], dayBlock);
    expect(m.map((x) => [x.job.id, x.target, x.why])).toEqual([['mid', 'truck', null], ['late', null, 'closed']]);
  });
});
