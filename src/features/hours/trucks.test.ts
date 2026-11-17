import { describe, it, expect } from 'vitest';
import { comingTouched, touchedWho } from './trucks';
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

describe('the question names the appointments it is about (R90)', () => {
  const name = (x: Job) => ({ a: 'Marie', b: 'Paul' } as Record<string, string>)[x.id] || '';
  it('by name and day, in day order; no name: the job number', () => {
    const list = [j('b', { day: '2026-11-21' }), j('a', { day: '2026-11-20' }), j('n', { day: '2026-11-22', number: 1024 })];
    expect(touchedWho(list, name, 'fr', '2026-11-16')).toBe('Marie (20 novembre), Paul (21 novembre) et #1024 (22 novembre)');
    expect(touchedWho(list.slice(0, 1), name, 'en', '2026-11-16')).toBe('Paul (November 21)');
  });
  it('many: the first ones named, the rest counted', () => {
    const list = Array.from({ length: 8 }, (_, k) => j(`x${k}`, { day: '2026-11-2' + k, number: 100 + k }));
    const fr = touchedWho(list, () => '', 'fr', '2026-11-16');
    expect(fr.startsWith('#100 (20 novembre), #101 (21 novembre)')).toBe(true);
    expect(fr.endsWith('et 4 autres')).toBe(true);
    expect(touchedWho(list, () => '', 'en', '2026-11-16').endsWith('and 4 others')).toBe(true);
  });
});
