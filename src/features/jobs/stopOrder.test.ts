import { describe, it, expect } from 'vitest';
import { routeOf, putFirst, moveBy, isManual, sameOrder, guessEtas, brokenWindows } from './stopOrder';
import type { Job } from '../../data/types';

const J = (id: string, o: Partial<Job>): Job => ({ id, number: 1000 + id.charCodeAt(0), truck_id: 't1', day: '2026-11-07', block: 'pm', status: 'booked', stop_order: null, deleted_at: null, ...o } as Job);

describe('the order of the stops', () => {
  const jobs = [
    J('a', { stop_order: 2 }), J('b', { stop_order: 1, status: 'on_site' }), J('c', { stop_order: 3 }), J('d', { stop_order: 4 }),
    J('e', { stop_order: 1, truck_id: 't2' }), J('f', { stop_order: 5, status: 'done' }), J('g', { stop_order: 1, block: 'eve' }), J('h', { stop_order: 6, deleted_at: 'x' })
  ];
  it('the route of the truck in its block: on the way or there, then the booked ones in order', () => {
    const r = routeOf(jobs[0], jobs);
    expect(r.live.map((j) => j.id)).toEqual(['b']);
    expect(r.booked.map((j) => j.id)).toEqual(['a', 'c', 'd']);
    expect(routeOf({ truck_id: null, day: '2026-11-07', block: 'pm' }, jobs)).toEqual({ live: [], booked: [] });
  });
  it('first, up, down', () => {
    expect(putFirst(['a', 'c', 'd'], 'd')).toEqual(['d', 'a', 'c']);
    expect(putFirst(['a', 'c'], 'z')).toEqual(['a', 'c']);
    expect(moveBy(['a', 'c', 'd'], 'c', -1)).toEqual(['c', 'a', 'd']);
    expect(moveBy(['a', 'c', 'd'], 'c', 1)).toEqual(['a', 'd', 'c']);
    expect(moveBy(['a', 'c', 'd'], 'a', -1)).toEqual(['a', 'c', 'd']);
    expect(moveBy(['a', 'c', 'd'], 'd', 1)).toEqual(['a', 'c', 'd']);
  });
  it('chosen by hand, same order', () => {
    expect(isManual([J('a', {}), J('c', { manual_order: 1 })])).toBe(true);
    expect(isManual([J('a', {})])).toBe(false);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('the order of the stops, « Plages d\'arrivée » (block \'day\')', () => {
  const W = (id: string, eta: number | null, win: [number, number] | null, o: Partial<Job> = {}) =>
    J(id, { block: 'day', eta_min: eta, duration_min: 60, travel_min: 15, win_start: win ? win[0] : null, win_end: win ? win[1] : null, ...o });
  const day = [W('a', 540, [480, 720], { stop_order: 1 }), W('b', 615, [540, 780], { stop_order: 2 }), W('c', 690, [600, 840], { stop_order: 3 }), W('d', 765, [720, 960], { stop_order: 4 })];
  it('the route is the truck\'s whole day', () => {
    const r = routeOf(day[0], [...day, J('x', { block: 'pm' }), W('y', 600, null, { truck_id: 't2' })]);
    expect(r.booked.map((j) => j.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('guesses the arrivals of a new order from the times shown: work, then the drive', () => {
    expect([...guessEtas(['a', 'b', 'c', 'd'], day)!.values()]).toEqual([540, 615, 690, 765]);
    // d first: it waits for its window (12 h) before working, the others come after
    expect([...guessEtas(['d', 'a', 'b', 'c'], day)!]).toEqual([['d', 540], ['a', 795], ['b', 870], ['c', 945]]);
  });
  it('an unknown drive counts the garage\'s usual one; a missing arrival time: nothing can be said', () => {
    expect([...guessEtas(['a', 'b'], [day[0], { ...day[1], travel_min: null }], 20)!.values()]).toEqual([540, 620]);
    expect(guessEtas(['a', 'b'], [day[0], { ...day[1], eta_min: null }])).toBeNull();
    expect(brokenWindows(['a', 'b'], [day[0], { ...day[1], eta_min: null }])).toBeNull();
    expect(guessEtas([], day)).toBeNull();
  });
  it('says who would be reached after their window; early is fine (the truck waits)', () => {
    expect(brokenWindows(['a', 'b', 'c', 'd'], day)).toEqual([]);
    expect(brokenWindows(['d', 'a', 'b', 'c'], day)!.map((x) => [x.job.id, x.eta])).toEqual([['a', 795], ['b', 870], ['c', 945]]);
    // a flexible stop (no window yet) is never « hors plage »
    expect(brokenWindows(['d', 'f'], [day[3], W('f', 800, null)])).toEqual([]);
  });
});
