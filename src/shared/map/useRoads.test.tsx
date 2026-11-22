/* useRoads: asks each route once (for the day shown), asks again a minute later when nobody answered, stops everything
   when the map goes; a live trip is asked at most once a minute and never when the server gave its road; what a new stop
   adds is said only when one planner measured both routes. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

// the tests choose the key themselves (a VITE_TOMTOM_KEY set in the shell must not change what they ask)
let KEY = '';
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), get TOMTOM_KEY() { return KEY; } }));
import { useRoads, routesOf, roadOf, roadTotal, roadState, roadAdded, type RoadTruck } from './useRoads';
import { forgetRoads, routeThrough, type LatLng } from './roads';
import type { Leg } from './assemble';

const truck = (from: LatLng, ...stops: LatLng[]): RoadTruck => ({ from, stops: stops.map(([lat, lng]) => ({ hasPos: true, lat, lng })) });
let renders = 0;
function Probe(p: { trucks: RoadTruck[]; day?: string }) { useRoads(p.trucks, p.day); renders++; return null; }
const step = (pts: LatLng[]) => ({ geometry: { coordinates: pts.map(([lat, lng]) => [lng, lat]) } });
const osrmOf = (u: string, extra = 0) => {
  // a road through the points asked, with a point between each two (so each leg has a line of its own)
  const pts = u.split('/driving/')[1].split('?')[0].split(';').map((c) => c.split(',').map(Number)).map(([lng, lat]) => [lat, lng] as LatLng);
  const legs = pts.slice(1).map((p, i) => ({ steps: [step([pts[i], [(pts[i][0] + p[0]) / 2 + 0.001, (pts[i][1] + p[1]) / 2], p])] }));
  return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 5000 + extra, duration: 600 + extra, legs }] }), { status: 200 });
};
const asked = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => String(c[0]));

describe('useRoads', () => {
  const box = document.createElement('div');
  beforeEach(() => { forgetRoads(); KEY = ''; renders = 0; vi.useFakeTimers(); });
  afterEach(() => { render(null, box); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('lists each truck’s day and each live trip without a road', () => {
    const tr = { ...truck([45.5, -73.6], [45.51, -73.61]), legs: [{ kind: 'trip' as const, points: [[45.49, -73.5], [45.51, -73.61]] as LatLng[] }] };
    expect(routesOf([tr, truck([45.5, -73.6])])).toEqual([[[45.5, -73.6], [45.51, -73.61]], [[45.49, -73.5], [45.51, -73.61]]]);
  });
  it('a live trip whose road the server gave is never asked (it is drawn as the server gave it)', () => {
    const road: LatLng[] = [[45.49, -73.5], [45.5, -73.55], [45.51, -73.61]];
    const tr = { ...truck([45.5, -73.6], [45.51, -73.61]), legs: [{ kind: 'trip' as const, points: road }] };
    expect(routesOf([tr])).toEqual([[[45.5, -73.6], [45.51, -73.61]]]);
    expect(roadOf(tr.legs[0])).toBe(road);
  });
  it('nobody answers: asked again a minute later, the screen draws again to say it; the map closed: nothing more is asked', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', f);
    const tr = truck([45.5, -73.6], [45.51, -73.61]);
    expect(roadState(tr)).toBe('asking');
    await act(async () => { render(<Probe trucks={[tr]} />, box); });
    const before = renders;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f).toHaveBeenCalledTimes(2);   // both planners, once
    expect(renders).toBeGreaterThan(before);   // « Route indisponible pour l'instant » can be said
    expect(roadState(tr)).toBe('down');
    await act(async () => { await vi.advanceTimersByTimeAsync(62 * 1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(f).toHaveBeenCalledTimes(4);
    expect(roadState(tr)).toBe('down');      // the words do not flip back and forth while it asks again
    await act(async () => { render(null, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(f).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);   // no retry left waiting after the map is gone
  });
  it('the road comes: known, drawn, its total said; nothing to route: nothing said', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => osrmOf(u)));
    const tr = truck([45.5, -73.6], [45.51, -73.61]);
    await act(async () => { render(<Probe trucks={[tr]} />, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(roadState(tr)).toBe('known');
    expect(roadTotal(tr)).toEqual({ km: 5, minutes: 12, planner: 'osrm' });
    expect(roadState(truck([45.5, -73.6]))).toBe('none');
    expect(roadState({ from: null, stops: [{ hasPos: true, lat: 45.5, lng: -73.6 }] })).toBe('none');
  });
  it('a route that will never be asked (more than 25 points): « never », not « for now » (review-maps L4)', () => {
    const stops = Array.from({ length: 25 }, (_, i) => ({ hasPos: true, lat: 45.5 + i / 1000, lng: -73.6 }));
    expect(roadState({ from: [45.49, -73.6], stops })).toBe('never');
  });
  it('every planner said « no road » for good: « never »; a planner only silent: « down » (asked again)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 400 })));
    const tr = truck([45.5, -73.6], [45.51, -73.61]);
    await act(async () => { render(<Probe trucks={[tr]} />, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(roadState(tr)).toBe('never');
  });
  it('another day: asked at its usual hours (TomTom), kept apart from today', async () => {
    KEY = 'KEY';
    const tt = (u: string) => new Response(JSON.stringify({ routes: [{ summary: { lengthInMeters: 6000, travelTimeInSeconds: new URL(u).searchParams.get('departAt') === 'now' ? 900 : 600 },
      legs: [{ points: [{ latitude: 45.5001, longitude: -73.6001 }, { latitude: 45.505, longitude: -73.605 }, { latitude: 45.5099, longitude: -73.6099 }] }] }] }), { status: 200 });
    const f = vi.fn(async (u: string) => tt(u));
    vi.stubGlobal('fetch', f);
    const tr = truck([45.5, -73.6], [45.51, -73.61]);
    await act(async () => { render(<Probe trucks={[tr]} day="2099-03-03" />, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(new URL(asked(f)[0]).searchParams.get('departAt')).toBe('2099-03-03T11:30:00');
    expect(roadTotal(tr, '2099-03-03')).toEqual({ km: 6, minutes: 10, planner: 'tomtom' });
    expect(roadTotal(tr)).toBeNull();
    expect(roadOf({ kind: 'todo', points: [[45.5, -73.6], [45.51, -73.61]] }, '2099-03-03')).toHaveLength(3);
    expect(roadOf({ kind: 'todo', points: [[45.5, -73.6], [45.51, -73.61]] })).toEqual([]);
  });
  it('a live trip without the server’s road: the person moves every 30 s, one request a minute (each TomTom answer is billed)', async () => {
    const f = vi.fn(async (u: string) => osrmOf(u));
    vi.stubGlobal('fetch', f);
    const stop: LatLng = [45.53, -73.67];
    const withTrip = (me: LatLng): RoadTruck => ({ from: null, stops: [{ hasPos: true, lat: stop[0], lng: stop[1] }], legs: [{ kind: 'trip', points: [me, stop] }] });
    // the truck has no day route of its own here (no start, one stop): every request is the trip's
    const trips = () => asked(f).filter((u) => u.includes('-73.670000,45.530000'));
    await act(async () => { render(<Probe trucks={[withTrip([45.5, -73.6])]} />, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(trips()).toHaveLength(1);
    for (const me of [[45.505, -73.61], [45.51, -73.62], [45.515, -73.63]] as LatLng[]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000); });
      await act(async () => { render(<Probe trucks={[withTrip(me)]} />, box); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    expect(trips()).toHaveLength(1);       // 48 s, three moves: still one request
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000); });
    await act(async () => { render(<Probe trucks={[withTrip([45.52, -73.64])]} />, box); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(trips()).toHaveLength(2);       // a minute passed: asked again from where he is
  });
});

describe('a leg as drawn', () => {
  beforeEach(() => { forgetRoads(); KEY = ''; });
  const from: LatLng = [45.5005, -73.6577], to: LatLng = [45.5307, -73.6702];
  it('nothing until its road is known: never the straight line between two stops, nor a straight piece to the door', async () => {
    expect(roadOf({ kind: 'todo', points: [from, to] } as Leg)).toEqual([]);
    const osrm = { code: 'Ok', routes: [{ distance: 5000, duration: 600, legs: [{ steps: [{ geometry: { coordinates: [[-73.6578, 45.5006], [-73.66, 45.51], [-73.6702, 45.5307]] } }] }] }] };
    await routeThrough([from, to], (async () => new Response(JSON.stringify(osrm), { status: 200 })) as unknown as typeof fetch, 12000, '');
    expect(roadOf({ kind: 'todo', points: [from, to] } as Leg)).toEqual([[45.5006, -73.6578], [45.51, -73.66], [45.5307, -73.6702]]);
  });
  it('a road the server already gave (a trip on its way) is drawn as it is', () => {
    const line: LatLng[] = [from, [45.51, -73.66], to];
    expect(roadOf({ kind: 'trip', points: line } as Leg)).toBe(line);
  });
  it('a live trip with no road yet: nothing (never the straight line from the person to the stop)', () => {
    expect(roadOf({ kind: 'trip', points: [from, to] } as Leg)).toEqual([]);
  });
});

describe('what a new stop adds to the day by the streets (review F5)', () => {
  beforeEach(() => { forgetRoads(); KEY = 'KEY'; });
  const c: LatLng = [45.5, -73.6], x: LatLng = [45.51, -73.61], y: LatLng = [45.52, -73.62];
  const tomtom = (km: number, min: number, n: number) => new Response(JSON.stringify({ routes: [{ summary: { lengthInMeters: km * 1000, travelTimeInSeconds: min * 60 },
    legs: Array.from({ length: n }, (_, i) => ({ points: [{ latitude: 45.5 + i / 100, longitude: -73.6 }, { latitude: 45.505 + i / 100, longitude: -73.6 }] })) }] }), { status: 200 });
  it('both routes measured by TomTom: the difference; one by TomTom, the other by OSRM: nothing said', async () => {
    const without = truck(c, x), withIt = truck(c, x, y);
    await routeThrough([c, x], (async () => tomtom(6, 12, 1)) as unknown as typeof fetch, 12000, 'KEY');
    await routeThrough([c, x, y], (async () => tomtom(9.5, 20, 2)) as unknown as typeof fetch, 12000, 'KEY');
    expect(roadAdded(withIt, without)).toEqual({ km: 3.5, minutes: 8, planner: 'tomtom' });
    forgetRoads();
    await routeThrough([c, x], (async () => tomtom(6, 12, 1)) as unknown as typeof fetch, 12000, 'KEY');
    // TomTom rests (refused a moment ago): OSRM measures the route with the new stop
    await routeThrough([c, x, y], (async (u: string) => (u.includes('tomtom') ? new Response('{}', { status: 403 }) : osrmOf(u, 300))) as unknown as typeof fetch, 12000, 'KEY');
    expect(roadTotal(withIt)!.planner).toBe('osrm');
    expect(roadAdded(withIt, without)).toBeNull();
  });
  it('a day with no other stop adds its whole route; a route not known yet says nothing', async () => {
    const withIt = truck(c, y);
    expect(roadAdded(withIt, truck(c))).toBeNull();
    await routeThrough([c, y], (async () => tomtom(4, 9, 1)) as unknown as typeof fetch, 12000, 'KEY');
    expect(roadAdded(withIt, truck(c))).toEqual({ km: 4, minutes: 9, planner: 'tomtom' });
    expect(roadAdded(withIt, null)).toEqual({ km: 4, minutes: 9, planner: 'tomtom' });
  });
});
