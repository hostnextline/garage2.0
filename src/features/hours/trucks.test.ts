import { describe, it, expect } from 'vitest';
import { comingTouched } from './trucks';
import type { Job } from '../../data/types';

const j = (id: string, o: Partial<Job> = {}) => ({ id, truck_id: 't1', status: 'booked', day: '2026-11-20', ...o }) as Job;
const jobs = [j('a'), j('b', { needs_machine: true }), j('old', { day: '2026-11-01' }), j('done', { status: 'done' }), j('other', { truck_id: 't2' })];
const truck = { id: 't1', active: true, tire_machine: true };

describe('a truck changed while it has coming appointments (map-hours-08)', () => {
  it('out of service: every coming booked appointment of that truck', () => {
    expect(comingTouched(jobs, truck, { active: false, tire_machine: true }, '2026-11-16')).toEqual({ why: 'off', jobs: [jobs[0], jobs[1]] });
  });
  it('the tire machine taken away: only the work that needs it', () => {
    expect(comingTouched(jobs, truck, { active: true, tire_machine: false }, '2026-11-16')).toEqual({ why: 'machine', jobs: [jobs[1]] });
  });
  it('nothing coming, or nothing that matters changed: no question', () => {
    expect(comingTouched(jobs, truck, { active: true, tire_machine: true }, '2026-11-16')).toBeNull();
    expect(comingTouched([], truck, { active: false, tire_machine: true }, '2026-11-16')).toBeNull();
    expect(comingTouched(jobs, { ...truck, active: false }, { active: false, tire_machine: true }, '2026-11-16')).toBeNull();
  });
});
