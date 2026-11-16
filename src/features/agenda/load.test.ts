import { describe, it, expect } from 'vitest';
import { timeLeft, usedBy, dayState, blockState, hasRoom } from './load';

const job = (o: Partial<{ status: string; duration_min: number; travel_min: number | null; eta_min: number | null; arrived: number | null }>) =>
  ({ status: 'booked', duration_min: 60, travel_min: 20, eta_min: null, arrived: null, ...o });

describe('what a truck’s jobs still take (agenda-04)', () => {
  it('counts a job under way only for the time it still needs, today', () => {
    // 14 h: on site since 12 h for a 120 min job: 0 left of it... a 150 min one: 30 min left
    expect(timeLeft(job({ status: 'on_site', duration_min: 120 }), 840, 720, 20)).toBe(0);
    expect(timeLeft(job({ status: 'on_site', duration_min: 150 }), 840, 720, 20)).toBe(30);
    // on the way, arriving at 14 h 10: 10 min of road, then the work
    expect(timeLeft(job({ status: 'en_route', eta_min: 850 }), 840, null, 20)).toBe(70);
    expect(timeLeft(job({ status: 'done' }), 840, null, 20)).toBe(0);
    expect(timeLeft(job({ travel_min: null }), 840, null, 20)).toBe(80);
  });
  it('fits the rest of the day where the old count said « Complet, 1 h 30 de trop »', () => {
    // the finding's case: 14 h, the truck works until 17 h (180 min left); one done, one on site since 12 h (120 min),
    // two booked (60 + 30, 20 min of road each)
    const jobs = [job({ status: 'done' }), job({ status: 'on_site', duration_min: 120, arrived: 720 }), job({}), job({ duration_min: 30 })];
    const used = usedBy(jobs, 840, (j) => j.arrived, 20);
    expect(used).toBe(130);
    expect(180 - used).toBeGreaterThan(0);
    // the old count: every job not done whole (120 + 20 + 80 + 50 = 270)
    expect(usedBy(jobs, null, (j) => j.arrived, 20)).toBe(270);
  });
  it('counts every job whole on another day, as before', () => {
    expect(usedBy([job({}), job({ status: 'on_site' })], null, () => 600, 20)).toBe(160);
  });
});

describe('a whole day as a place (« Plages d’arrivée »)', () => {
  const today = '2026-11-14';
  const span: [number, number] = [480, 1200];
  it('stays open until its last hour, while a truck has hours left', () => {
    expect(dayState('2026-11-15', today, 600, span, [720], 45, true)).toEqual({ started: false, open: true, closed: false });
    expect(dayState(today, today, 600, span, [300], 45, true)).toEqual({ started: false, open: true, closed: false });
    expect(dayState(today, today, 1200, span, [0], 45, true)).toEqual({ started: true, open: false, closed: false });
    expect(dayState('2026-11-13', today, 600, span, [0], 45, true)).toEqual({ started: true, open: false, closed: false });
  });
  it('late in the day is neither open nor « Fermé » while the trucks still work (agenda-06)', () => {
    expect(dayState(today, today, 990, span, [30], 45, true)).toEqual({ started: false, open: false, closed: false });
    expect(dayState(today, today, 1170, span, [30], 45, true)).toEqual({ started: false, open: false, closed: false });
  });
  it('is closed only when nobody works that day', () => {
    expect(dayState('2026-11-15', today, 600, span, [], 45, false)).toEqual({ started: false, open: false, closed: true });
    expect(dayState('2026-11-15', today, 600, span, [0, 0], 45, false)).toEqual({ started: false, open: false, closed: true });
  });
  it('a block is closed when it neither books nor has started, as before', () => {
    expect(blockState({ started: false, open: false })).toEqual({ started: false, open: false, closed: true });
    expect(blockState({ started: true, open: false }).closed).toBe(false);
  });
  it('has room for a short job by the garage’s own shortest block, not a number in the code (agenda-11)', () => {
    expect(hasRoom([{ cap: 240, left: 40 }], 30)).toBe(true);
    expect(hasRoom([{ cap: 240, left: 40 }], 45)).toBe(false);
    expect(hasRoom([{ cap: 20, left: 20 }], 15)).toBe(true);
  });
});
