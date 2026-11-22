import { describe, it, expect } from 'vitest';
import { compareStops, sortStops, type Orderable } from './stopOrder';

const s = (block: string, status: string, order: number | null, etaMin: number | null = null, number: number | null = null): Orderable & { id: string } =>
  ({ id: `${block}-${status}-${order}-${etaMin}-${number}`, block, status, order, etaMin, number });

describe('the one order of a vehicle’s stops in a day', () => {
  it('morning, afternoon, evening; the windows of a day after the blocks', () => {
    expect(sortStops([s('eve', 'booked', 1), s('day', 'booked', 1), s('am', 'booked', 3), s('pm', 'booked', 1)]).map((x) => x.block)).toEqual(['am', 'pm', 'eve', 'day']);
  });
  it('inside a moment: done, then under way, then booked; then the stop number', () => {
    const list = [s('am', 'booked', 1), s('am', 'on_site', 3), s('am', 'done', 4), s('am', 'en_route', 2), s('am', 'booked', 0)];
    expect(sortStops(list).map((x) => [x.status, x.order])).toEqual([['done', 4], ['en_route', 2], ['on_site', 3], ['booked', 0], ['booked', 1]]);
  });
  it('the same stop number: the arrival, then the job number; never two answers for the same stops', () => {
    const a = s('day', 'booked', null, 600, 7), b = s('day', 'booked', null, 600, 3), c = s('day', 'booked', null, 540, 9);
    expect(sortStops([a, b, c])).toEqual([c, b, a]);
    expect(compareStops(a, a)).toBe(0);
  });
  it('does not change the list it is given', () => {
    const list = [s('pm', 'booked', 1), s('am', 'booked', 1)];
    sortStops(list);
    expect(list[0].block).toBe('pm');
  });
});
