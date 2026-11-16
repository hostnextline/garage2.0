import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseOsrm, routeThrough, knownLeg, knownTotal, allKnown, forgetRoads, OSRM, OSRM_BACKUP, type LatLng } from './roads';

const centrale: LatLng = [45.5005, -73.6577];
const a: LatLng = [45.5307, -73.6702];
const b: LatLng = [45.4772, -73.6213];
const step = (pts: [number, number][]) => ({ geometry: { coordinates: pts.map(([lat, lng]) => [lng, lat]) } });
const osrm = { code: 'Ok', routes: [{ distance: 23456, duration: 1800, legs: [
  { steps: [step([[45.5006, -73.6578], [45.51, -73.66]]), step([[45.51, -73.66], [45.53, -73.67]])] },
  { steps: [step([[45.53, -73.67], [45.50, -73.64], [45.4773, -73.6214]])] }
] }] };

describe('the truck’s day by the streets', () => {
  beforeEach(() => forgetRoads());
  it('reads one line per leg, without the same point twice, in km and minutes (with a margin for traffic)', () => {
    const r = parseOsrm(osrm, 3)!;
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0]).toEqual([[45.5006, -73.6578], [45.51, -73.66], [45.53, -73.67]]);
    expect(r.km).toBe(23.5);
    expect(r.minutes).toBe(36);
    expect(parseOsrm({ code: 'NoRoute' }, 3)).toBeNull();
    expect(parseOsrm(osrm, 4)).toBeNull();   // not the legs asked for
  });
  it('asks once per truck and keeps each leg (starting and ending on the stops)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(osrm), { status: 200 })) as unknown as typeof fetch;
    const r = await routeThrough([centrale, a, b], f);
    expect(r).not.toBeNull();
    expect((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
      .toBe(`${OSRM}/route/v1/driving/-73.657700,45.500500;-73.670200,45.530700;-73.621300,45.477200?overview=false&steps=true&geometries=geojson`);
    const leg = knownLeg(centrale, a)!;
    expect(leg[0]).toEqual(centrale);
    expect(leg[leg.length - 1]).toEqual(a);
    expect(leg.length).toBeGreaterThan(2);
    expect(allKnown([centrale, a, b])).toBe(true);
    expect(knownTotal([centrale, a, b])).toEqual({ km: 23.5, minutes: 36 });
    await routeThrough([centrale, a, b], f);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('the first planner down: the backup one draws the streets', async () => {
    const two = { ...osrm, routes: [{ ...osrm.routes[0], legs: [osrm.routes[0].legs[0]] }] };
    const f = vi.fn(async (u: string) => (u.startsWith(OSRM_BACKUP) ? new Response(JSON.stringify(two), { status: 200 }) : new Response('busy', { status: 429 }))) as unknown as typeof fetch;
    expect(await routeThrough([centrale, a], f)).not.toBeNull();
    expect(knownLeg(centrale, a)!.length).toBeGreaterThan(2);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('without an answer: straight lines stay, and the planners are asked again only a minute later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
      expect(await routeThrough([centrale, a], f)).toBeNull();
      expect(knownLeg(centrale, a)).toBeNull();
      expect(await routeThrough([centrale, a], f)).toBeNull();
      expect(f).toHaveBeenCalledTimes(2);   // the two planners, once
      vi.setSystemTime(Date.now() + 61 * 1000);
      await routeThrough([centrale, a], f);
      expect(f).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });
});
