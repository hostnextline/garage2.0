import { describe, it, expect } from 'vitest';
import { routeOf, putFirst, moveBy, isManual, sameOrder } from './stopOrder';
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
