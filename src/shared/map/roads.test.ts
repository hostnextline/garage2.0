import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseOsrm, routeThrough, knownLeg, knownTotal, allKnown, forgetRoads, neverRouted, OSRM, OSRM_BACKUP, type LatLng } from './roads';

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

describe('the streets, robust', () => {
  beforeEach(() => forgetRoads());
  const ok = (legs: { steps: ReturnType<typeof step>[] }[]) => new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 5000, duration: 600, legs }] }), { status: 200 });
  it('two stops at the same address (two cars of one customer): the route is drawn, the stop is asked once', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (u: string) => { urls.push(u); return ok([{ steps: [step([[45.5006, -73.6578], [45.53, -73.67]])] }, { steps: [step([[45.53, -73.67], [45.4773, -73.6214]])] }]); }) as unknown as typeof fetch;
    const r = await routeThrough([centrale, a, a, b], f);
    expect(r).not.toBeNull();
    expect(urls[0].split('?')[0].split('/').pop()!.split(';')).toHaveLength(3);    // centrale, a, b
    expect(knownLeg(a, a)).toEqual([a, a]);
    expect(knownLeg(a, b)!.length).toBeGreaterThan(2);
    expect(allKnown([centrale, a, a, b])).toBe(true);
    expect(knownTotal([centrale, a, a, b])).toEqual({ km: 5, minutes: 12 });
  });
  it('a leg the planner gives with a single point is drawn from stop to stop, not a reason to drop the whole route', () => {
    const one = { code: 'Ok', routes: [{ distance: 10, duration: 5, legs: [{ steps: [step([[45.5, -73.6]]), step([[45.5, -73.6]])] }, { steps: [step([[45.5, -73.6], [45.51, -73.61]])] }] }] };
    const r = parseOsrm(one, 3)!;
    expect(r).not.toBeNull();
    expect(r.legs[0]).toEqual([[45.5, -73.6]]);
  });
  it('a route refused for good (no road) is never asked again; a busy planner is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 })) as unknown as typeof fetch;
      expect(await routeThrough([centrale, a], f)).toBeNull();
      expect(neverRouted([centrale, a])).toBe(true);
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      await routeThrough([centrale, a], f);
      expect(f).toHaveBeenCalledTimes(2);   // once per planner, never again
      expect(neverRouted([centrale, b])).toBe(false);
      expect(neverRouted(Array.from({ length: 26 }, (_, i) => [45 + i / 100, -73.6] as LatLng))).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('a first planner that does not answer is skipped for the next trucks of the same round', async () => {
    const f = vi.fn(async (u: string) => {
      if (u.startsWith(OSRM_BACKUP)) return ok([{ steps: [step([[45.5, -73.6], [45.51, -73.61]])] }]);
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await routeThrough([centrale, a], f);
    await routeThrough([centrale, b], f);
    const asked = (f as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0].startsWith(OSRM_BACKUP) ? 'backup' : 'osrm');
    expect(asked).toEqual(['osrm', 'backup', 'backup']);
  });
  it('the same route asked twice at once is one request', async () => {
    let release: () => void = () => undefined;
    const f = vi.fn(() => new Promise<Response>((res) => { release = () => res(ok([{ steps: [step([[45.5, -73.6], [45.51, -73.61]])] }])); })) as unknown as typeof fetch;
    const one = routeThrough([centrale, a], f);
    const two = routeThrough([centrale, a], f);
    await Promise.resolve();
    release();
    expect(await one).toEqual(await two);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
