/* useRoads: asks each route once, asks again a minute later when nobody answered, and stops everything when the map goes. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useRoads, routesOf, type RoadTruck } from './useRoads';
import { forgetRoads, type LatLng } from './roads';

const truck = (from: LatLng, ...stops: LatLng[]): RoadTruck => ({ from, stops: stops.map(([lat, lng]) => ({ hasPos: true, lat, lng })) });
function Probe(p: { trucks: RoadTruck[] }) { useRoads(p.trucks); return null; }

describe('useRoads', () => {
  const box = document.createElement('div');
  beforeEach(() => { forgetRoads(); vi.useFakeTimers(); });
  afterEach(() => { render(null, box); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('lists each truck’s day and each live trip without a road', () => {
    const tr = { ...truck([45.5, -73.6], [45.51, -73.61]), legs: [{ kind: 'trip' as const, points: [[45.49, -73.5], [45.51, -73.61]] as LatLng[] }] };
    expect(routesOf([tr, truck([45.5, -73.6])])).toEqual([[[45.5, -73.6], [45.51, -73.61]], [[45.49, -73.5], [45.51, -73.61]]]);
  });
  it('nobody answers: asked again a minute later; the map closed: nothing more is asked', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', f);
    await act(async () => { render(<Probe trucks={[truck([45.5, -73.6], [45.51, -73.61])]} />, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f).toHaveBeenCalledTimes(2);   // both planners, once
    await act(async () => { await vi.advanceTimersByTimeAsync(62 * 1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f).toHaveBeenCalledTimes(4);
    await act(async () => { render(null, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(f).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);   // no retry left waiting after the map is gone
  });
});
