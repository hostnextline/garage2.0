import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseOsrm, routeThrough, routeTrip, tripRoad, tripDue, knownLeg, knownTotal, allKnown, forgetRoads, neverRouted, routeFailed, plannersFor,
  departOf, sameMeasure, addedTotal, NOTHING, OSRM, OSRM_BACKUP, TOMTOM, TRIP_EVERY_MS, type LatLng } from './roads';

const centrale: LatLng = [45.5005, -73.6577];
const a: LatLng = [45.5307, -73.6702];
const b: LatLng = [45.4772, -73.6213];
const step = (pts: [number, number][]) => ({ geometry: { coordinates: pts.map(([lat, lng]) => [lng, lat]) } });
const osrm = { code: 'Ok', routes: [{ distance: 23456, duration: 1800, legs: [
  { steps: [step([[45.5006, -73.6578], [45.51, -73.66]]), step([[45.51, -73.66], [45.53, -73.67]])] },
  { steps: [step([[45.53, -73.67], [45.50, -73.64], [45.4773, -73.6214]])] }
] }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const urls = (f: unknown) => (f as { mock: { calls: [string, RequestInit?][] } }).mock.calls.map((c) => c[0]);
const who = (u: string) => (u.includes('tomtom') ? 'tomtom' : u.startsWith(OSRM_BACKUP) ? 'backup' : 'osrm');

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
  it('asks once per truck and keeps each leg: the planner’s own line, never a straight piece added to reach the stops', async () => {
    const f = vi.fn(async () => json(osrm)) as unknown as typeof fetch;
    const r = await routeThrough([centrale, a, b], f, 12000, '');
    expect(r).toMatchObject({ km: 23.5, minutes: 36, planner: 'osrm' });
    expect(urls(f)[0]).toBe(`${OSRM}/route/v1/driving/-73.657700,45.500500;-73.670200,45.530700;-73.621300,45.477200?overview=false&steps=true&geometries=geojson`);
    // from the street in front of the Centrale to the street in front of a: the stops themselves are not added
    expect(knownLeg(centrale, a)).toEqual([[45.5006, -73.6578], [45.51, -73.66], [45.53, -73.67]]);
    expect(knownLeg(a, b)).toEqual([[45.53, -73.67], [45.50, -73.64], [45.4773, -73.6214]]);
    expect(allKnown([centrale, a, b])).toBe(true);
    expect(knownTotal([centrale, a, b])).toEqual({ km: 23.5, minutes: 36, planner: 'osrm' });
    await routeThrough([centrale, a, b], f, 12000, '');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('the first planner down: the backup one draws the streets (the same planner: its total says « osrm »)', async () => {
    const two = { ...osrm, routes: [{ ...osrm.routes[0], legs: [osrm.routes[0].legs[0]] }] };
    const f = vi.fn(async (u: string) => (u.startsWith(OSRM_BACKUP) ? json(two) : new Response('busy', { status: 429 }))) as unknown as typeof fetch;
    expect(await routeThrough([centrale, a], f, 12000, '')).toMatchObject({ planner: 'osrm' });
    expect(knownLeg(centrale, a)!.length).toBeGreaterThan(2);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('without an answer: nothing drawn, the route says it failed, and the planners are asked again only a minute later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
      expect(await routeThrough([centrale, a], f, 12000, '')).toBeNull();
      expect(knownLeg(centrale, a)).toBeNull();
      expect(routeFailed([centrale, a])).toBe(true);
      expect(await routeThrough([centrale, a], f, 12000, '')).toBeNull();
      expect(f).toHaveBeenCalledTimes(2);   // the two planners, once
      vi.setSystemTime(Date.now() + 61 * 1000);
      await routeThrough([centrale, a], f, 12000, '');
      expect(f).toHaveBeenCalledTimes(4);
      // the road comes at last: the failure is forgotten
      vi.setSystemTime(Date.now() + 61 * 1000);
      const two = { ...osrm, routes: [{ ...osrm.routes[0], legs: [osrm.routes[0].legs[0]] }] };
      await routeThrough([centrale, a], (async () => json(two)) as unknown as typeof fetch, 12000, '');
      expect(routeFailed([centrale, a])).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe('the streets, robust', () => {
  beforeEach(() => forgetRoads());
  const ok = (legs: { steps: ReturnType<typeof step>[] }[]) => json({ code: 'Ok', routes: [{ distance: 5000, duration: 600, legs }] });
  it('two stops at the same address (two cars of one customer): the route is drawn, the stop is asked once', async () => {
    const asked: string[] = [];
    const f = vi.fn(async (u: string) => { asked.push(u); return ok([{ steps: [step([[45.5006, -73.6578], [45.53, -73.67]])] }, { steps: [step([[45.53, -73.67], [45.4773, -73.6214]])] }]); }) as unknown as typeof fetch;
    const r = await routeThrough([centrale, a, a, b], f, 12000, '');
    expect(r).not.toBeNull();
    expect(asked[0].split('?')[0].split('/').pop()!.split(';')).toHaveLength(3);    // centrale, a, b
    expect(knownLeg(a, a)).toEqual([]);                  // known, nothing to draw (no line of no length)
    expect(knownLeg(a, b)).toEqual([[45.53, -73.67], [45.4773, -73.6214]]);
    expect(allKnown([centrale, a, a, b])).toBe(true);
    expect(knownTotal([centrale, a, a, b])).toEqual({ km: 5, minutes: 12, planner: 'osrm' });
  });
  it('a leg the planner gives with a single point (two stops side by side): nothing drawn for it, the rest of the route is', async () => {
    const one = { code: 'Ok', routes: [{ distance: 10, duration: 5, legs: [{ steps: [step([[45.5, -73.6]]), step([[45.5, -73.6]])] }, { steps: [step([[45.5, -73.6], [45.51, -73.61]])] }] }] };
    expect(parseOsrm(one, 3)!.legs[0]).toEqual([[45.5, -73.6]]);
    await routeThrough([centrale, a, b], (async () => json(one)) as unknown as typeof fetch, 12000, '');
    expect(knownLeg(centrale, a)).toEqual([]);          // never the straight line from the Centrale to a
    expect(knownLeg(a, b)).toEqual([[45.5, -73.6], [45.51, -73.61]]);
  });
  it('a leg with no point at all is not an answer: the next planner draws the route (review F7)', async () => {
    const empty = { code: 'Ok', routes: [{ distance: 10, duration: 5, legs: [{ steps: [] }] }] };
    expect(parseOsrm(empty, 2)).toBeNull();
    const two = { ...osrm, routes: [{ ...osrm.routes[0], legs: [osrm.routes[0].legs[0]] }] };
    const f = vi.fn(async (u: string) => (u.startsWith(OSRM_BACKUP) ? json(two) : json(empty))) as unknown as typeof fetch;
    expect(await routeThrough([centrale, a], f, 12000, '')).not.toBeNull();
    expect(urls(f).map(who)).toEqual(['osrm', 'backup']);
    expect(knownLeg(centrale, a)!.length).toBeGreaterThan(2);
  });
  it('a route refused for good (no road) is never asked again; a busy planner is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = vi.fn(async () => json({ code: 'NoRoute' })) as unknown as typeof fetch;
      expect(await routeThrough([centrale, a], f, 12000, '')).toBeNull();
      expect(neverRouted([centrale, a])).toBe(true);
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      await routeThrough([centrale, a], f, 12000, '');
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
    await routeThrough([centrale, a], f, 12000, '');
    await routeThrough([centrale, b], f, 12000, '');
    expect(urls(f).map(who)).toEqual(['osrm', 'backup', 'backup']);
  });
  it('the same route asked twice at once is one request', async () => {
    let release: () => void = () => undefined;
    const f = vi.fn(() => new Promise<Response>((res) => { release = () => res(ok([{ steps: [step([[45.5, -73.6], [45.51, -73.61]])] }])); })) as unknown as typeof fetch;
    const one = routeThrough([centrale, a], f, 12000, '');
    const two = routeThrough([centrale, a], f, 12000, '');
    await Promise.resolve();
    release();
    expect(await one).toEqual(await two);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('with TomTom’s key: TomTom first, the free planners behind it', () => {
  beforeEach(() => forgetRoads());
  const tomtom = { routes: [{ summary: { lengthInMeters: 23456, travelTimeInSeconds: 1887 }, legs: [
    { points: [{ latitude: 45.5006, longitude: -73.6578 }, { latitude: 45.53, longitude: -73.67 }] },
    { points: [{ latitude: 45.53, longitude: -73.67 }, { latitude: 45.4773, longitude: -73.6214 }] }
  ] }] };
  it('no key: only the two free planners, as before', () => {
    expect(plannersFor('').map((p) => p.id)).toEqual([OSRM, OSRM_BACKUP]);
    expect(plannersFor('KEY').map((p) => p.id)).toEqual([TOMTOM, OSRM, OSRM_BACKUP]);
  });
  it('asks TomTom once, with the page’s address, and keeps its time as it is (the traffic is in it), marked « tomtom »', async () => {
    const f = vi.fn(async () => json(tomtom)) as unknown as typeof fetch;
    const r = await routeThrough([centrale, a, b], f, 12000, 'KEY');
    expect(urls(f)).toHaveLength(1);
    expect(urls(f)[0]).toContain('https://api.tomtom.com/routing/1/calculateRoute/45.500500,-73.657700:45.530700,-73.670200:45.477200,-73.621300/json?key=KEY');
    expect(new URL(urls(f)[0]).searchParams.get('departAt')).toBe('now');
    expect((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(r).toMatchObject({ km: 23.5, minutes: 31, planner: 'tomtom' });
    expect(knownLeg(centrale, a)).toEqual([[45.5006, -73.6578], [45.53, -73.67]]);
    expect(knownTotal([centrale, a, b])).toEqual({ km: 23.5, minutes: 31, planner: 'tomtom' });
  });
  it('TomTom refuses the key (its real 401 body), or its quota is used up: OSRM answers, and TomTom rests instead of being asked for each truck', async () => {
    const bodies: Record<number, unknown> = {
      401: { detailedError: { code: 'Unauthorized', message: 'You are missing valid authentication credentials' } },
      403: { detailedError: { code: 'Forbidden', message: 'Developer Inactive' } },
      429: {},
      400: { detailedError: { code: 'BadRequest', message: 'Invalid key format' } }
    };
    for (const status of [401, 403, 429, 400]) {
      forgetRoads();
      const f = vi.fn(async (u: string) => (u.includes('tomtom') ? json(bodies[status], status) : json(osrm))) as unknown as typeof fetch;
      const r = await routeThrough([centrale, a, b], f, 12000, 'KEY');
      expect(r, `HTTP ${status}`).toMatchObject({ km: 23.5, minutes: 36, planner: 'osrm' });   // OSRM's time + 20 %
      expect(urls(f).map(who)).toEqual(['tomtom', 'osrm']);
      await routeThrough([centrale, b], f, 12000, 'KEY');
      expect(urls(f).filter((u) => u.includes('tomtom')), `HTTP ${status}`).toHaveLength(1);   // not asked again right away
      expect(neverRouted([centrale, a, b])).toBe(false);
    }
  });
  it('TomTom answers 200 with an error, legs that are not the stops asked, or a leg without points: OSRM is asked', async () => {
    const bad = [
      { error: { description: 'Engine error' } },
      { routes: [{ summary: tomtom.routes[0].summary, legs: [tomtom.routes[0].legs[0]] }] },
      { routes: [{ summary: tomtom.routes[0].summary, legs: [tomtom.routes[0].legs[0], {}] }] }
    ];
    for (const body of bad) {
      forgetRoads();
      const f = vi.fn(async (u: string) => (u.includes('tomtom') ? json(body) : json(osrm))) as unknown as typeof fetch;
      expect(await routeThrough([centrale, a, b], f, 12000, 'KEY')).toMatchObject({ planner: 'osrm' });
      expect(urls(f).map(who)).toEqual(['tomtom', 'osrm']);
      expect(knownLeg(a, b)!.length).toBeGreaterThan(2);
    }
  });
  it('TomTom does not answer in time: it rests, OSRM answers; the next truck does not wait for TomTom again', async () => {
    const f = vi.fn((u: string, init?: RequestInit) => (u.includes('tomtom')
      ? new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
      : Promise.resolve(json(osrm)))) as unknown as typeof fetch;
    expect(await routeThrough([centrale, a, b], f, 30, 'KEY')).toMatchObject({ planner: 'osrm' });
    const two = { ...osrm, routes: [{ ...osrm.routes[0], legs: [osrm.routes[0].legs[0]] }] };
    (f as unknown as { mockImplementation: (x: unknown) => void }).mockImplementation(async () => json(two));
    await routeThrough([centrale, b], f, 30, 'KEY');
    expect(urls(f).map(who)).toEqual(['tomtom', 'osrm', 'osrm']);
  });
  it('the same stop twice in a row (two cars of one customer): TomTom is asked the distinct stops, each leg goes back to its place', async () => {
    const f = vi.fn(async () => json(tomtom)) as unknown as typeof fetch;
    const r = await routeThrough([centrale, a, a, b], f, 12000, 'KEY');
    expect(new URL(urls(f)[0]).pathname.split('/')[4].split(':')).toHaveLength(3);
    expect(r!.legs).toEqual([[[45.5006, -73.6578], [45.53, -73.67]], [], [[45.53, -73.67], [45.4773, -73.6214]]]);
    expect(knownLeg(a, a)).toEqual([]);
  });
  it('TomTom says there is no road: the free planners are asked too; all say no: never asked again', async () => {
    const f = vi.fn(async (u: string) => (u.includes('tomtom')
      ? json({ error: { description: 'NO_ROUTE_FOUND' } }, 400)
      : json({ code: 'NoRoute' }))) as unknown as typeof fetch;
    expect(await routeThrough([centrale, a], f, 12000, 'KEY')).toBeNull();
    expect(urls(f)).toHaveLength(3);
    expect(neverRouted([centrale, a])).toBe(true);
    expect(knownLeg(centrale, a)).toBeNull();   // nothing to draw: no line, never a straight one
  });
  it('TomTom said « no road » but OSRM was busy: a minute later only OSRM is asked (a « no » for good is not billed again)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const f = vi.fn(async (u: string) => (u.includes('tomtom') ? json({ error: { description: 'NO_ROUTE_FOUND' } }, 400) : json({}, 503))) as unknown as typeof fetch;
      expect(await routeThrough([centrale, a], f, 12000, 'KEY')).toBeNull();
      expect(urls(f).map(who)).toEqual(['tomtom', 'osrm', 'backup']);
      expect(neverRouted([centrale, a])).toBe(false);
      vi.setSystemTime(Date.now() + 61 * 1000);
      await routeThrough([centrale, a], f, 12000, 'KEY');
      expect(urls(f).map(who)).toEqual(['tomtom', 'osrm', 'backup', 'osrm', 'backup']);
    } finally { vi.useRealTimers(); }
  });
  it('nobody answers: no road, no time; asked again later', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await routeThrough([centrale, a], f, 12000, 'KEY')).toBeNull();
    expect(knownTotal([centrale, a])).toBeNull();
    expect(neverRouted([centrale, a])).toBe(false);
  });
});

describe('which moment a day’s routes are timed for (review F5)', () => {
  beforeEach(() => forgetRoads());
  it('today « now »; a day to come at its usual hours (11 h 30, no offset); a day gone at the same weekday to come', () => {
    expect(departOf('2026-11-19', '2026-11-19')).toBe('now');
    expect(departOf(undefined, '2026-11-19')).toBe('now');
    expect(departOf('not a day', '2026-11-19')).toBe('now');
    expect(departOf('2026-11-24', '2026-11-19')).toBe('2026-11-24T11:30:00');   // next Tuesday
    expect(departOf('2026-11-20', '2026-11-19')).toBe('2026-11-20T11:30:00');   // tomorrow
    expect(departOf('2026-11-18', '2026-11-19')).toBe('2026-11-25T11:30:00');   // yesterday (Wednesday) → next Wednesday
    expect(departOf('2026-11-12', '2026-11-19')).toBe('2026-11-26T11:30:00');   // last Thursday → next Thursday, never today
  });
  it('another day is asked at its usual hours, and its legs and total are kept apart from today’s', async () => {
    const tomtom = { routes: [{ summary: { lengthInMeters: 5000, travelTimeInSeconds: 600 }, legs: [{ points: [{ latitude: 45.5006, longitude: -73.6578 }, { latitude: 45.53, longitude: -73.67 }] }] }] };
    const later = { routes: [{ summary: { lengthInMeters: 5200, travelTimeInSeconds: 900 }, legs: [{ points: [{ latitude: 45.5007, longitude: -73.6579 }, { latitude: 45.52, longitude: -73.66 }, { latitude: 45.53, longitude: -73.67 }] }] }] };
    const day = departOf('2099-01-06').slice(0, 10);
    const f = vi.fn(async (u: string) => json(new URL(u).searchParams.get('departAt') === 'now' ? tomtom : later)) as unknown as typeof fetch;
    await routeThrough([centrale, a], f, 12000, 'KEY', day);
    expect(new URL(urls(f)[0]).searchParams.get('departAt')).toBe(`${day}T11:30:00`);
    expect(knownTotal([centrale, a], day)).toEqual({ km: 5.2, minutes: 15, planner: 'tomtom' });
    expect(knownTotal([centrale, a])).toBeNull();          // today knows nothing yet: never the other day’s time
    expect(knownLeg(centrale, a)).toBeNull();
    await routeThrough([centrale, a], f, 12000, 'KEY');
    expect(new URL(urls(f)[1]).searchParams.get('departAt')).toBe('now');
    expect(knownTotal([centrale, a])).toEqual({ km: 5, minutes: 10, planner: 'tomtom' });
    expect(knownLeg(centrale, a, day)).toHaveLength(3);
    expect(knownLeg(centrale, a)).toHaveLength(2);
  });
  it('today’s « now » is kept for that date only: yesterday evening’s rush time is not this morning’s (review-maps L2)', async () => {
    const tt = (min: number) => json({ routes: [{ summary: { lengthInMeters: 9000, travelTimeInSeconds: min * 60 }, legs: [{ points: [{ latitude: 45.5006, longitude: -73.6578 }, { latitude: 45.51, longitude: -73.66 }, { latitude: 45.5306, longitude: -73.6701 }] }] }] });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-19T22:00:00Z'));    // 17 h in Montréal
      const f = vi.fn(async () => tt(44)) as unknown as typeof fetch;
      expect((await routeThrough([centrale, a], f, 12000, 'KEY', '2026-11-19'))?.minutes).toBe(44);
      expect(knownTotal([centrale, a])?.minutes).toBe(44);
      vi.setSystemTime(new Date('2026-11-20T13:00:00Z'));    // 8 h the next morning, the map never closed
      expect(knownTotal([centrale, a], '2026-11-20')).toBeNull();
      expect(knownLeg(centrale, a)).toBeNull();
      const f2 = vi.fn(async () => tt(24)) as unknown as typeof fetch;
      const r = await routeThrough([centrale, a], f2, 12000, 'KEY', '2026-11-20');
      expect(f2).toHaveBeenCalledTimes(1);
      expect(new URL(urls(f2)[0]).searchParams.get('departAt')).toBe('now');
      expect(r?.minutes).toBe(24);
    } finally { vi.useRealTimers(); }
  });
});

describe('two totals are compared only when the same planner measured both (review F5)', () => {
  it('TomTom’s time with the traffic is never subtracted from OSRM’s + 20 %', () => {
    const tt = { km: 12, minutes: 25, planner: 'tomtom' as const };
    const os = { km: 10, minutes: 24, planner: 'osrm' as const };
    expect(sameMeasure(tt, os)).toBe(false);
    expect(addedTotal(tt, os)).toBeNull();
    expect(addedTotal(tt, { km: 9.7, minutes: 20, planner: 'tomtom' })).toEqual({ km: 2.3, minutes: 5, planner: 'tomtom' });
    expect(addedTotal(os, { km: 11, minutes: 30, planner: 'osrm' })).toEqual({ km: 0, minutes: 0, planner: 'osrm' });   // never below 0
  });
  it('a day with nothing to drive compares with anyone; nothing known says nothing', () => {
    expect(addedTotal({ km: 8, minutes: 14, planner: 'osrm' }, NOTHING)).toEqual({ km: 8, minutes: 14, planner: 'osrm' });
    expect(addedTotal(null, NOTHING)).toBeNull();
    expect(addedTotal({ km: 8, minutes: 14, planner: 'osrm' }, null)).toBeNull();
  });
  it('every point at the same place: 0 km for anyone, nothing drawn', async () => {
    forgetRoads();
    const f = vi.fn() as unknown as typeof fetch;
    expect(await routeThrough([a, a], f, 12000, 'KEY')).toEqual({ legs: [[]], ...NOTHING });
    expect(f).not.toHaveBeenCalled();
    expect(knownTotal([a, a])).toEqual(NOTHING);
  });
});

describe('a live trip without the server’s road: asked at most once a minute for the same stop (review F9)', () => {
  beforeEach(() => { forgetRoads(); vi.useFakeTimers({ toFake: ['Date'] }); });
  afterEach(() => vi.useRealTimers());
  const road = (from: LatLng): unknown => ({ code: 'Ok', routes: [{ distance: 4000, duration: 500, legs: [{ steps: [step([from, [45.51, -73.66], [45.515, -73.665], [45.52, -73.668], [45.5301, -73.6701]])] }] }] });
  it('the person moves every 30 s: one request a minute, whatever the moves; the line follows him along the road found', async () => {
    const f = vi.fn(async (u: string) => {
      const c = u.split('/driving/')[1].split('?')[0].split(';')[0].split(',').map(Number);
      return json(road([c[1], c[0]]));
    }) as unknown as typeof fetch;
    const p0: LatLng = [45.5005, -73.6577], p1: LatLng = [45.5101, -73.6601], p2: LatLng = [45.5149, -73.6649];
    expect(await routeTrip(p0, a, f, 12000, '')).not.toBeNull();
    expect(tripRoad(p0, a)[0]).toEqual(p0);
    vi.setSystemTime(Date.now() + 30 * 1000);
    expect(tripDue(a)).toBe(false);
    expect(await routeTrip(p1, a, f, 12000, '')).toBeNull();      // not asked: less than a minute
    expect(f).toHaveBeenCalledTimes(1);
    // drawn from the road found a minute ago, from its point nearest to him: a real road, never a straight line
    expect(tripRoad(p1, a)).toEqual([[45.51, -73.66], [45.515, -73.665], [45.52, -73.668], [45.5301, -73.6701]]);
    vi.setSystemTime(Date.now() + 31 * 1000);
    expect(tripDue(a)).toBe(true);
    expect(await routeTrip(p2, a, f, 12000, '')).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
    expect(TRIP_EVERY_MS).toBe(60 * 1000);
  });
  it('he left the road found (another way): nothing is drawn until the next answer', async () => {
    await routeTrip([45.5005, -73.6577], a, (async () => json(road([45.5005, -73.6577]))) as unknown as typeof fetch, 12000, '');
    expect(tripRoad([45.47, -73.75], a)).toEqual([]);
  });
  it('another stop is its own trip: asked at once', async () => {
    const f = vi.fn(async () => json(road([45.5005, -73.6577]))) as unknown as typeof fetch;
    await routeTrip([45.5005, -73.6577], a, f, 12000, '');
    await routeTrip([45.5005, -73.6577], b, f, 12000, '');
    expect(f).toHaveBeenCalledTimes(2);
  });
});
