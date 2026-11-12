import { describe, it, expect } from 'vitest';
import { blockOpen, closedJobs, otherKind, movesFor } from './closing';
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
