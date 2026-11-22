/* The road of « Je pars » as the server reads it from TomTom (supabase/functions/_shared/tomtom.ts, used by enroute), and
   enroute's own route(): TomTom with the server's key, else or when TomTom fails OSRM (+20 %), else NO road and NO time
   (never a straight-line estimate). route() is run for real here, its network answered by a pretend fetch; the modules
   that need the Deno server's packages (database, texts, once) are replaced, they are not used by route(). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tomtomRouteUrl, readTomtomRoad } from '../../../supabase/functions/_shared/tomtom';
import { thinRoad } from '../../../supabase/functions/_shared/road';
import tomtomSource from '../../../supabase/functions/_shared/tomtom.ts?raw';

vi.mock('../../../supabase/functions/_shared/db.ts', () => ({ adminDb: () => null, caller: async () => null, settings: async () => ({}), secret: async () => null }));
vi.mock('../../../supabase/functions/_shared/once.ts', () => ({ claimMessage: async () => null, finishMessage: async () => null, dropMessage: async () => null }));
vi.mock('../../../supabase/functions/_shared/ghl.ts', () => ({ sendSms: async () => null }));
type Pt = { lat: number; lng: number };
type RouteFn = (a: Pt, b: Pt) => Promise<{ km: number; minutes: number; line: [number, number][]; source: string } | null>;
/** enroute's route(), loaded by a name the type checker does not follow (the handler is Deno code, outside tsconfig) */
async function enrouteRoute(): Promise<RouteFn> {
  const path = ['..', '..', '..', 'supabase', 'functions', 'enroute', 'handler.ts'].join('/');
  return ((await import(/* @vite-ignore */ path)) as { route: RouteFn }).route;
}

describe('the server’s road from TomTom', () => {
  it('asks the route from the truck to the customer, leaving now, with the traffic of now', () => {
    const u = new URL(tomtomRouteUrl('https://api.tomtom.com', { lat: 45.5005, lng: -73.6577 }, { lat: 45.4474, lng: -73.4363 }, 'SERVER KEY'));
    expect(u.pathname).toBe('/routing/1/calculateRoute/45.5005,-73.6577:45.4474,-73.4363/json');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ key: 'SERVER KEY', traffic: 'true', departAt: 'now', travelMode: 'car' });
  });
  it('reads the km, the minutes as TomTom says them (no margin), and the line for the customer’s map', () => {
    const d = { routes: [{ summary: { lengthInMeters: 21465, travelTimeInSeconds: 1887, trafficDelayInSeconds: 533 },
      legs: [{ points: [{ latitude: 45.500538, longitude: -73.657554 }, { latitude: 45.47, longitude: -73.6 }, { latitude: 45.4474109, longitude: -73.4362695 }] }] }] };
    const all = (l: [number, number][]) => l;
    expect(readTomtomRoad(d, all)).toEqual({ km: 21.5, minutes: 31, line: [[45.50054, -73.65755], [45.47, -73.6], [45.44741, -73.43627]], source: 'tomtom' });
    expect(readTomtomRoad({ routes: [] }, all)).toBeNull();
    expect(readTomtomRoad({ error: { description: 'Invalid API key' } }, all)).toBeNull();
    expect(readTomtomRoad({ routes: [{ legs: [] }] }, all)).toBeNull();   // no time: not a road
    expect(readTomtomRoad(null, all)).toBeNull();
  });
  it('the line is shaped by the rule it is given (enroute: thinRoad, the streets kept); no « one point in N » thinning left (merge-main F7 / L-1)', () => {
    // a long road with a bend every 250 points: thinRoad keeps the bends, never a point across the blocks
    const long: [number, number][] = Array.from({ length: 1001 }, (_, i) => [45 + i / 1e4, -73 + (Math.floor(i / 250) % 2) * 0.001 * (i % 250) / 250]);
    const d = { routes: [{ summary: { lengthInMeters: 10000, travelTimeInSeconds: 900 }, legs: [{ points: long.map(([la, ln]) => ({ latitude: la, longitude: ln })) }] }] };
    const r = readTomtomRoad(d, thinRoad)!;
    expect(r.line.length).toBeLessThanOrEqual(400);
    expect(r.line[0]).toEqual(long[0]);
    expect(r.line[r.line.length - 1]).toEqual([Math.round(long[1000][0] * 1e5) / 1e5, Math.round(long[1000][1] * 1e5) / 1e5]);
    // one helper only: the « one point in N » rule is gone from the server's TomTom reading, and the shape is required
    expect(tomtomSource).not.toMatch(/i % step === 0|export function thin\b/);
    expect(tomtomSource).toMatch(/shape: \(line: \[number, number\]\[\]\) => \[number, number\]\[\]\): Road \| null/);
  });
});

describe('« Je pars »: the road and the time are real ones, or none (enroute route())', () => {
  const env: Record<string, string> = {};
  const A = { lat: 45.5005, lng: -73.6577 }, B = { lat: 45.4474, lng: -73.4363 };
  const tomtom = { routes: [{ summary: { lengthInMeters: 21465, travelTimeInSeconds: 1887 }, legs: [{ points: [{ latitude: 45.5005, longitude: -73.6577 }, { latitude: 45.47, longitude: -73.6 }, { latitude: 45.4474, longitude: -73.4363 }] }] }] };
  const osrm = { code: 'Ok', routes: [{ distance: 23456, duration: 1800, geometry: { coordinates: [[-73.6577, 45.5005], [-73.6, 45.47], [-73.4363, 45.4474]] } }] };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  let route: RouteFn;
  beforeEach(async () => {
    for (const k of Object.keys(env)) delete env[k];
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
    route = await enrouteRoute();
  });
  afterEach(() => vi.unstubAllGlobals());
  const asked = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => (String(c[0]).includes('tomtom') ? 'tomtom' : 'osrm'));

  it('the server has TomTom’s key: TomTom’s road and time (no margin), OSRM not asked', async () => {
    env.TOMTOM_KEY = 'SERVER KEY'; env.TOMTOM_BASE = 'http://tomtom.test/tomtom';
    const f = vi.fn(async (_u: string) => json(tomtom));
    vi.stubGlobal('fetch', f);
    expect(await route(A, B)).toEqual({ km: 21.5, minutes: 31, line: [[45.5005, -73.6577], [45.47, -73.6], [45.4474, -73.4363]], source: 'tomtom' });
    expect(asked(f)).toEqual(['tomtom']);
    expect(String(f.mock.calls[0][0])).toMatch(/^http:\/\/tomtom\.test\/tomtom\/routing\/1\/calculateRoute\/45\.5005,-73\.6577:45\.4474,-73\.4363\/json\?key=SERVER%20KEY/);
  });
  it('TomTom refuses the key (401) or answers no route: OSRM’s road, its time + 20 %', async () => {
    env.TOMTOM_KEY = 'SERVER KEY';
    for (const bad of [json({ detailedError: { code: 'Unauthorized', message: 'You are missing valid authentication credentials' } }, 401), json({ routes: [] })]) {
      const f = vi.fn(async (u: string) => (u.includes('tomtom') ? bad.clone() : json(osrm)));
      vi.stubGlobal('fetch', f);
      expect(await route(A, B)).toMatchObject({ km: 23.5, minutes: 36, source: 'osrm' });
      expect(asked(f)).toEqual(['tomtom', 'osrm']);
    }
  });
  it('the truck already at the door (TomTom’s line of one point): TomTom’s time all the same, OSRM not asked; nothing to draw (merge-main L-3)', async () => {
    env.TOMTOM_KEY = 'SERVER KEY';
    const door = { routes: [{ summary: { lengthInMeters: 40, travelTimeInSeconds: 20 }, legs: [{ points: [{ latitude: 45.4474, longitude: -73.4363 }] }] }] };
    const f = vi.fn(async (u: string) => (u.includes('tomtom') ? json(door) : json(osrm)));
    vi.stubGlobal('fetch', f);
    expect(await route(B, B)).toMatchObject({ km: 0, minutes: 1, source: 'tomtom' });
    expect(asked(f)).toEqual(['tomtom']);
  });
  it('no key on the server: OSRM only, as before (TomTom never asked)', async () => {
    const f = vi.fn(async () => json(osrm));
    vi.stubGlobal('fetch', f);
    expect(await route(A, B)).toMatchObject({ source: 'osrm' });
    expect(asked(f)).toEqual(['osrm']);
  });
  it('a road along one straight street keeps a point of its middle: three points, never taken for the old straight line (merge with main’s thinRoad)', async () => {
    // OSRM's full road along one street: 41 points in a row, all on the line (thinRoad alone keeps its two ends)
    const street = Array.from({ length: 41 }, (_, i) => [-73.6577 + i * 0.0005, 45.5005]);
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'Ok', routes: [{ distance: 1600, duration: 200, geometry: { coordinates: street } }] })));
    const r = await route(A, B);
    expect(r?.source).toBe('osrm');
    expect(r?.line).toHaveLength(3);
    expect(r?.line[0]).toEqual([45.5005, -73.6577]);
    expect(r?.line[2]).toEqual([45.5005, -73.6377]);
    expect(r?.line[1][0]).toBe(45.5005);
    // TomTom's polyline the same way
    env.TOMTOM_KEY = 'SERVER KEY';
    const tt = { routes: [{ summary: { lengthInMeters: 1600, travelTimeInSeconds: 240 }, legs: [{ points: street.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) }] }] };
    vi.stubGlobal('fetch', vi.fn(async () => json(tt)));
    expect((await route(A, B))?.line).toHaveLength(3);
  });
  it('nobody answers: NO road and NO time (the text without a time goes), never a straight-line estimate', async () => {
    env.TOMTOM_KEY = 'SERVER KEY';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await route(A, B)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('tomtom') ? json({}, 503) : json({ code: 'NoRoute', routes: [] }))));
    expect(await route(A, B)).toBeNull();
  });
});

/* ---------- « Vraies routes »: the planner's road times (supabase/functions/_shared/roads.ts, the function « drive ») ----------
   The pure parts (TomTom's Matrix request and answer, the date asked, the bill, the grouping, OSRM's table) and the engine
   run for real here with a pretend database (what drive_wanted lists, what drive_store keeps) and a pretend network.
   The whole function with the real database and fake services: tests/api/drive.test.mjs. */
import { tomtomMatrixUrl, tomtomMatrixBody, readTomtomMatrix } from '../../../supabase/functions/_shared/tomtom';

type RPt = { lat: number; lng: number };
type Trip = { a: RPt; b: RPt; slot: 0 | 1 | 2; extra: boolean; id: string };
type Group = { origins: RPt[]; destinations: RPt[]; cells: { trip: Trip; o: number; d: number }[]; cost: number };
interface RoadsModule {
  txCost(o: number, d: number): number;
  departDay(today: string): string;
  departAt(day: string, slot: 0 | 1 | 2): string;
  tripsOf(w: unknown): Trip[];
  groupTomtom(trips: Trip[], maxCells?: number): Group[];
  groupOsrm(trips: Trip[], maxPoints?: number): { points: RPt[]; sources: number[]; destinations: number[]; trips: { trip: Trip; s: number; d: number }[] }[];
  osrmTableUrl(base: string, g: { points: RPt[]; sources: number[]; destinations: number[] }): string;
  readOsrmCell(d: unknown, s: number, t: number): { minutes: number; km: number | null } | null;
  measureRoads(ask: { point: RPt | null; from: string | null; days: number; only: boolean; rpc: (n: string, a: Record<string, unknown>) => Promise<any>; limits?: Record<string, number>;
    claims?: { take(key: string, leaseMs: number): Promise<boolean>; drop(key: string): Promise<void> }; gate?: (cost: number) => Promise<boolean> }): Promise<Record<string, any>>;
}
/** _shared/roads.ts, loaded by a name the type checker does not follow (it imports the Deno server's http.ts) */
async function roadsModule(): Promise<RoadsModule> {
  const path = ['..', '..', '..', 'supabase', 'functions', '_shared', 'roads.ts'].join('/');
  return (await import(/* @vite-ignore */ path)) as RoadsModule;
}
const P0 = { lat: 45.4474, lng: -73.4363 };
const place = (i: number): RPt => ({ lat: 45.5 + i / 1000, lng: -73.6 - i / 1000 });
const pair = (a: RPt, b: RPt, slot = 0, extra = false) => [a.lat, a.lng, b.lat, b.lng, slot, extra];

describe('the planner’s times from TomTom’s Matrix service', () => {
  it('asks origins × destinations with TomTom’s usual traffic, at a local time with no offset', () => {
    expect(tomtomMatrixUrl('https://api.tomtom.com', 'SERVER KEY')).toBe('https://api.tomtom.com/routing/matrix/2?key=SERVER%20KEY');
    expect(tomtomMatrixBody([{ lat: 45.5, lng: -73.6 }], [P0], '2026-11-24T11:30:00')).toEqual({
      origins: [{ point: { latitude: 45.5, longitude: -73.6 } }], destinations: [{ point: { latitude: 45.4474, longitude: -73.4363 } }],
      options: { departAt: '2026-11-24T11:30:00', traffic: 'historical', routeType: 'fastest', travelMode: 'car' } });
  });
  it('reads each cell: minutes rounded up, km; « no road » only for TomTom’s no-route codes; any other error is nothing', () => {
    const c = readTomtomMatrix({ data: [
      { originIndex: 0, destinationIndex: 0, routeSummary: { lengthInMeters: 21465, travelTimeInSeconds: 1441 } },
      { originIndex: 0, destinationIndex: 1, detailedError: { code: 'NO_ROUTE_FOUND' } },
      { originIndex: 1, destinationIndex: 0, detailedError: { code: 'MAP_MATCHING_FAILURE' } },
      { originIndex: 1, destinationIndex: 1, detailedError: { code: 'COMPUTATION_TIMEOUT' } },
      { originIndex: 'x', destinationIndex: 1 }] });
    expect([...c.entries()]).toEqual([['0:0', { minutes: 25, km: 21.5 }], ['0:1', 'no_road'], ['1:0', 'no_road'], ['1:1', null]]);
    expect(readTomtomMatrix({ error: 'x' }).size).toBe(0);
    expect(readTomtomMatrix(null).size).toBe(0);
  });
  it('the day asked: the next Tuesday to Thursday at least one day ahead, never a holiday of Québec', async () => {
    const r = await roadsModule();
    expect(r.departDay('2026-11-20')).toBe('2026-11-24');   // a Friday → Tuesday
    expect(r.departDay('2026-11-23')).toBe('2026-11-24');   // Monday → the next day
    expect(r.departDay('2026-11-24')).toBe('2026-11-25');   // Tuesday → Wednesday, never the same day
    expect(r.departDay('2026-11-26')).toBe('2026-12-01');   // Thursday → next Tuesday
    expect(r.departDay('2026-06-23')).toBe('2026-06-25');   // the Saint-Jean (Wednesday) skipped
    expect(r.departDay('2026-06-30')).toBe('2026-07-02');   // the 1st of July (Wednesday) skipped
    expect(r.departDay('2025-12-31')).toBe('2026-01-06');   // New Year's Day (Thursday) skipped
    expect(r.departDay('2027-12-23')).toBe('2027-12-28');   // Christmas week
    expect([0, 1, 2].map((s) => r.departAt('2026-11-24', s as 0 | 1 | 2))).toEqual(['2026-11-24T11:30:00', '2026-11-24T08:00:00', '2026-11-24T17:00:00']);
  });
  it('TomTom’s bill: origins × destinations, or 5 × the larger side when both are above 5', async () => {
    const r = await roadsModule();
    expect([r.txCost(1, 60), r.txCost(60, 1), r.txCost(5, 10), r.txCost(6, 6), r.txCost(8, 8), r.txCost(10, 10)]).toEqual([60, 60, 50, 30, 40, 50]);
  });
  it('reads drive_wanted’s pairs and leaves out what is not one', async () => {
    const r = await roadsModule();
    const t = r.tripsOf({ pairs: [pair(P0, place(1), 0, true), [1, 2], 'x', [45, -73, 46, -74, 3, false], [45, -73, 'a', -74, 0, false], [91, -73, 46, -74, 0, false], pair(place(1), place(2), 2)] });
    expect(t.map((x) => [x.slot, x.extra])).toEqual([[0, true], [2, false]]);
    expect(t[0].id).toBe('45.4474,-73.4363>45.501,-73.601#0');
    expect(r.tripsOf(null)).toEqual([]);
  });
});

describe('grouping the trips to pay the least, then to ask the fewest times', () => {
  it('a new address with 40 places: one request 1 × 40 and one 40 × 1 (80 transactions: no square helps a star)', async () => {
    const r = await roadsModule();
    const pairs = Array.from({ length: 40 }, (_, i) => [pair(P0, place(i), 0, true), pair(place(i), P0, 0, true)]).flat();
    const g = r.groupTomtom(r.tripsOf({ pairs }));
    expect(g.map((x) => [x.origins.length, x.destinations.length, x.cells.length, x.cost])).toEqual([[1, 40, 40, 40], [40, 1, 40, 40]]);
    expect(g[0].origins[0]).toEqual(P0);
    expect(g[1].destinations[0]).toEqual(P0);
    // every trip asked once, at its own cell
    const asked = g.flatMap((x) => x.cells.map((c) => `${x.origins[c.o].lat},${x.origins[c.o].lng}>${x.destinations[c.d].lat},${x.destinations[c.d].lng}#0`));
    expect(asked.sort()).toEqual(r.tripsOf({ pairs }).map((t) => t.id).sort());
  });
  it('more than 100 cells: the star is cut in requests of 100', async () => {
    const r = await roadsModule();
    const g = r.groupTomtom(r.tripsOf({ pairs: Array.from({ length: 150 }, (_, i) => pair(P0, place(i), 0, true)) }));
    expect(g.map((x) => x.cells.length)).toEqual([100, 50]);
    expect(g.every((x) => x.origins.length * x.destinations.length <= 100)).toBe(true);
  });
  it('a full day of 8 places (56 trips): one square 8 × 8 for 40 transactions instead of 56 as rows', async () => {
    const r = await roadsModule();
    const pts = Array.from({ length: 8 }, (_, i) => place(i * 10));
    const pairs = pts.flatMap((a) => pts.filter((b) => b !== a).map((b) => pair(a, b)));
    const g = r.groupTomtom(r.tripsOf({ pairs }));
    expect(g.map((x) => [x.origins.length, x.destinations.length, x.cells.length, x.cost])).toEqual([[8, 8, 56, 40]]);
  });
  it('a day of 6 places (30 trips): a square would cost 30 too, so rows (never a square that costs as much)', async () => {
    const r = await roadsModule();
    const pts = Array.from({ length: 6 }, (_, i) => place(i * 10));
    const g = r.groupTomtom(r.tripsOf({ pairs: pts.flatMap((a) => pts.filter((b) => b !== a).map((b) => pair(a, b))) }));
    expect(g.every((x) => x.origins.length === 1 || x.destinations.length === 1)).toBe(true);
    expect(g.reduce((n, x) => n + x.cost, 0)).toBe(30);
  });
  it('OSRM (free): as many trips a request as fit in 100 places, its time + 20 % rounded up', async () => {
    const r = await roadsModule();
    const trips = r.tripsOf({ pairs: Array.from({ length: 150 }, (_, i) => [pair(P0, place(i), 0, true), pair(place(i), P0, 0, true)]).flat() });
    const g = r.groupOsrm(trips);
    expect(g.map((x) => [x.points.length, x.trips.length])).toEqual([[100, 198], [52, 102]]);
    const u = new URL(r.osrmTableUrl('http://o', { points: [P0, place(1)], sources: [0], destinations: [1] }));
    expect(u.pathname).toBe('/table/v1/driving/-73.4363,45.4474;-73.601,45.501');
    expect(Object.fromEntries(u.searchParams)).toEqual({ sources: '0', destinations: '1', annotations: 'duration,distance' });
    expect(r.readOsrmCell({ durations: [[1000, null]], distances: [[12345, null]] }, 0, 0)).toEqual({ minutes: 20, km: 12.3 });
    expect(r.readOsrmCell({ durations: [[1000, null]], distances: [[12345, null]] }, 0, 1)).toBeNull();
  });
});

describe('measuring: TomTom, else OSRM for the usual hours, else nothing (never a guess); the brakes', () => {
  const env: Record<string, string> = {};
  const places = [place(1), place(2), place(3)];
  /** a pretend database: the address's trips and the trips between the places, slot 0, minus what was stored */
  function fakeDb(over: Partial<{ spendOk: boolean }> = {}) {
    const want = [...places.flatMap((p) => [pair(P0, p, 0, true), pair(p, P0, 0, true)]), ...places.flatMap((a) => places.filter((b) => b !== a).map((b) => pair(a, b)))];
    const kept = new Map<string, unknown[]>();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const id = (p: unknown[]) => p.slice(0, 5).join(',');
    let tx = 0;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'drive_wanted') {
        const pairs = want.filter((p) => !kept.has(id(p)) && (args.p_point || !p[5]));
        return { pairs, total: pairs.length, total0: pairs.length, days: [] };
      }
      if (name === 'drive_store') { for (const row of args.p_rows as unknown[][]) kept.set(id(row), row); return { ok: true, stored: (args.p_rows as unknown[]).length, planned: 0, kept: [], late: [] }; }
      if (name === 'drive_spend_add') { const n = Number(args.p_tx) || 0; const ok = over.spendOk !== false; if (ok) tx += n; return { ok: n === 0 ? true : ok, month: '2026-11-01', tx, cap: 10000 }; }
      throw new Error('rpc ' + name);
    };
    return { rpc, calls, kept };
  }
  const matrixAnswer = (body: { origins: unknown[]; destinations: unknown[] }) => ({ data: body.origins.flatMap((_, o) => body.destinations.map((__, d) => ({ originIndex: o, destinationIndex: d, routeSummary: { lengthInMeters: 5000, travelTimeInSeconds: 601 } }))) });
  const osrmAnswer = (u: string) => { const q = new URL(u).searchParams; const s = q.get('sources')!.split(';'), d = q.get('destinations')!.split(';');
    return { code: 'Ok', durations: s.map(() => d.map(() => 600)), distances: s.map(() => d.map(() => 4000)) }; };
  const jsonOf = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  beforeEach(() => { for (const k of Object.keys(env)) delete env[k]; vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } }); });
  afterEach(() => vi.unstubAllGlobals());

  it('the address alone (the screen waits): its 6 trips in two TomTom requests, each paid before it is sent; the other trips wait', async () => {
    env.TOMTOM_KEY = 'K'; env.TOMTOM_BASE = 'http://tt'; env.OSRM_BASE = 'http://osrm';
    const r = await roadsModule();
    const db = fakeDb();
    const f = vi.fn(async (_u: string, init?: RequestInit) => jsonOf(matrixAnswer(JSON.parse(String(init?.body)))));
    vi.stubGlobal('fetch', f);
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect(a).toMatchObject({ ok: true, ready: true, stored: 6, tomtom: 'ok', osrm: 'unused', more: false, left: 6, no_road: 0, spent: { month: '2026-11-01', tx: 6, cap: 10000 } });
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(['http://tt/routing/matrix/2?key=K', 'http://tt/routing/matrix/2?key=K']);
    const bodies = f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies.map((b) => [b.origins.length, b.destinations.length, b.options.traffic, /T11:30:00$/.test(b.options.departAt)])).toEqual([[1, 3, 'historical', true], [3, 1, 'historical', true]]);
    // the cost counted BEFORE each request, then the store (no day named: the address is not booked yet)
    expect(db.calls.map((c) => c.name)).toEqual(['drive_wanted', 'drive_spend_add', 'drive_spend_add', 'drive_store', 'drive_wanted', 'drive_spend_add']);
    expect(db.calls.filter((c) => c.name === 'drive_spend_add').map((c) => c.args.p_tx)).toEqual([3, 3, 0]);
    expect(db.calls.find((c) => c.name === 'drive_store')!.args.p_days).toBeNull();
    expect([...db.kept.values()].every((row) => row[5] === 11 && row[6] === 5 && row[7] === 'tomtom')).toBe(true);
  });
  it('without `only`: the address first in its own round, then the other trips of those days', async () => {
    env.TOMTOM_KEY = 'K';
    const r = await roadsModule();
    const db = fakeDb();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => jsonOf(matrixAnswer(JSON.parse(String(init?.body))))));
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: false, rpc: db.rpc });
    expect(a).toMatchObject({ ready: true, stored: 12, left: 0, more: false });
    expect(db.calls.filter((c) => c.name === 'drive_store').map((c) => (c.args.p_rows as unknown[]).length)).toEqual([6, 6]);
  });
  it('the month’s ceiling reached: TomTom is not asked, OSRM gives the usual hours (+20 %), « over_budget »', async () => {
    env.TOMTOM_KEY = 'K'; env.OSRM_BASE = 'http://osrm';
    const r = await roadsModule();
    const db = fakeDb({ spendOk: false });
    const f = vi.fn(async (u: string) => jsonOf(osrmAnswer(u)));
    vi.stubGlobal('fetch', f);
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect(a).toMatchObject({ ready: true, stored: 6, tomtom: 'over_budget', osrm: 'ok' });
    expect(f.mock.calls.every((c) => String(c[0]).startsWith('http://osrm/table/v1/driving/'))).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);   // the 4 places in one table
    expect([...db.kept.values()].every((row) => row[5] === 12 && row[6] === 4 && row[7] === 'osrm')).toBe(true);
  });
  it('TomTom refuses the key: « refused », OSRM; no key at all: « no_key », OSRM only', async () => {
    const r = await roadsModule();
    env.TOMTOM_KEY = 'K';
    let db = fakeDb();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/matrix/') ? jsonOf({}, 403) : jsonOf(osrmAnswer(u)))));
    expect(await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc })).toMatchObject({ ready: true, tomtom: 'refused', osrm: 'ok', stored: 6 });
    delete env.TOMTOM_KEY;
    db = fakeDb();
    const f = vi.fn(async (u: string) => jsonOf(osrmAnswer(u)));
    vi.stubGlobal('fetch', f);
    expect(await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc })).toMatchObject({ ready: true, tomtom: 'no_key', osrm: 'ok' });
    expect(db.calls.some((c) => c.name === 'drive_spend_add' && Number(c.args.p_tx) > 0)).toBe(false);
  });
  it('TomTom and OSRM both down: nothing stored, nothing guessed, not ready, and no « call again » loop', async () => {
    env.TOMTOM_KEY = 'K';
    const r = await roadsModule();
    const db = fakeDb();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/matrix/') ? jsonOf({}, 503) : jsonOf({ code: 'Error' }, 503))));
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect(a).toMatchObject({ ok: true, ready: false, stored: 0, tomtom: 'busy', osrm: 'down', more: false, left: 12 });
    expect(db.calls.some((c) => c.name === 'drive_store')).toBe(false);
  });
  it('the time brake of a call (here 200 ms, a request may take 90): what is under way finishes and is kept, nothing new starts, « more »', async () => {
    env.TOMTOM_KEY = 'K';
    const r = await roadsModule();
    // a day of 6 places: six requests of 1 × 5 (a square would not cost less); five go at once, the sixth would start late
    const six = Array.from({ length: 6 }, (_, i) => place(10 + i * 7));
    const want = six.flatMap((a) => six.filter((b) => b !== a).map((b) => pair(a, b)));
    const kept = new Set<string>();
    const rpc = async (name: string, args: Record<string, unknown>) => {
      if (name === 'drive_wanted') { const pairs = want.filter((p) => !kept.has(p.join())); return { pairs, total: pairs.length, total0: pairs.length, days: [] }; }
      if (name === 'drive_store') { for (const row of args.p_rows as unknown[][]) kept.add([...row.slice(0, 5), false].join()); return { ok: true, stored: (args.p_rows as unknown[]).length, planned: 0, kept: [], late: [] }; }
      return { ok: true, month: '2026-11-01', tx: 0, cap: 10000 };
    };
    let inFlight = 0, most = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      most = Math.max(most, ++inFlight);
      await new Promise((ok) => setTimeout(ok, 120));
      inFlight--;
      return jsonOf(matrixAnswer(JSON.parse(String(init?.body))));
    }));
    // the sixth could start at 120 ms, but 120 + 90 is past 200: it waits for the next call
    const a = await r.measureRoads({ point: null, from: null, days: 1, only: false, rpc, limits: { ms: 200 } });
    expect(most).toBe(5);
    expect(a).toMatchObject({ stored: 25, more: true, ready: false });
  });
  it('a brake of the call (here 1 request): it stops, keeps what it measured, and says « more »', async () => {
    env.TOMTOM_KEY = 'K';
    const r = await roadsModule();
    const db = fakeDb();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => jsonOf(matrixAnswer(JSON.parse(String(init?.body))))));
    const a = await r.measureRoads({ point: null, from: null, days: 120, only: false, rpc: db.rpc, limits: { requests: 1 } });
    expect(a).toMatchObject({ stored: 2, more: true, ready: false });
    const b = await r.measureRoads({ point: null, from: null, days: 120, only: false, rpc: db.rpc });
    expect(b).toMatchObject({ stored: 4, more: false, ready: true, left: 0 });
  });
});

/* ---------- review-fn (2026-11-20): what the review proved, each a test that failed before its fix ---------- */
describe('measuring: two calls at once, a TomTom in trouble, a database hiccup, the call’s own time (review-fn)', () => {
  const env: Record<string, string> = {};
  /** a pretend database: `want` minus what was stored; drive_spend_add may throw on its n-th paid call */
  function fakeDb(want: unknown[][], o: { throwSpendAt?: number } = {}) {
    const kept = new Map<string, unknown[]>();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const id = (p: unknown[]) => p.slice(0, 5).join(',');
    let tx = 0, paid = 0;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'drive_wanted') {
        const pairs = want.filter((p) => !kept.has(id(p)) && (args.p_point || !p[5]));
        return { pairs, total: pairs.length, total0: pairs.filter((p) => p[4] === 0).length, days: [] };
      }
      if (name === 'drive_store') { for (const row of args.p_rows as unknown[][]) kept.set(id(row), row); return { ok: true, stored: (args.p_rows as unknown[]).length, planned: 0, kept: [], late: [] }; }
      if (name === 'drive_spend_add') {
        const n = Number(args.p_tx) || 0;
        if (n > 0 && o.throwSpendAt && ++paid === o.throwSpendAt) { await new Promise((ok) => setTimeout(ok, 5)); throw new Error('database hiccup'); }
        tx += n;
        return { ok: true, month: '2026-11-01', tx, cap: 10000 };
      }
      throw new Error('rpc ' + name);
    };
    return { rpc, calls, kept, tx: () => tx };
  }
  /** the leases of the server (rate_limits rows), as a set: one holder a key */
  const fakeClaims = () => { const held = new Set<string>(); return { held, take: async (k: string) => (held.has(k) ? false : (held.add(k), true)), drop: async (k: string) => { held.delete(k); } }; };
  const cellsOf = (body: { origins: unknown[]; destinations: unknown[] }, f: (o: number, d: number) => object) =>
    ({ data: body.origins.flatMap((_, o) => body.destinations.map((__, d) => ({ originIndex: o, destinationIndex: d, ...f(o, d) }))) });
  const ok601 = () => ({ routeSummary: { lengthInMeters: 5000, travelTimeInSeconds: 601 } });
  const osrmAnswer = (u: string) => { const q = new URL(u).searchParams; const s = q.get('sources')!.split(';'), d = q.get('destinations')!.split(';');
    return { code: 'Ok', durations: s.map(() => d.map(() => 600)), distances: s.map(() => d.map(() => 4000)) }; };
  const jsonOf = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const star = (n: number) => Array.from({ length: n }, (_, i) => [pair(P0, place(i + 1), 0, true), pair(place(i + 1), P0, 0, true)]).flat();
  const matrixCalls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.filter((c) => String(c[0]).includes('/matrix/'));
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.TOMTOM_KEY = 'K'; env.TOMTOM_BASE = 'http://tt'; env.OSRM_BASE = 'http://osrm';
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('H1: the same address warmed by two people at once: TomTom is asked each trip ONCE (the second waits for the lease, then finds them stored)', async () => {
    const r = await roadsModule();
    const db = fakeDb(star(3));
    const claims = fakeClaims();
    const f = vi.fn(async (_u: string, init?: RequestInit) => { await new Promise((ok) => setTimeout(ok, 30)); return jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601)); });
    vi.stubGlobal('fetch', f);
    const ask = { point: P0, from: null, days: 14, only: true, rpc: db.rpc, claims, limits: { waitMs: 10 } };
    const [a, b] = await Promise.all([r.measureRoads(ask), r.measureRoads(ask)]);
    expect(matrixCalls(f)).toHaveLength(2);   // 1 × 3 and 3 × 1, not twice each
    expect(db.tx()).toBe(6);
    expect([a.ready, b.ready, a.stored + b.stored]).toEqual([true, true, 6]);
    expect(claims.held.size).toBe(0);   // every lease given back
  });
  it('H1: the rest of the days asked by two at once (each phone’s « rest », the sweep): one at a time, no trip asked twice', async () => {
    const r = await roadsModule();
    const six = Array.from({ length: 6 }, (_, i) => place(10 + i * 7));
    const db = fakeDb(six.flatMap((a) => six.filter((b) => b !== a).map((b) => pair(a, b))));
    const claims = fakeClaims();
    const f = vi.fn(async (_u: string, init?: RequestInit) => { await new Promise((ok) => setTimeout(ok, 30)); return jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601)); });
    vi.stubGlobal('fetch', f);
    const ask = { point: null, from: null, days: 1, only: false, rpc: db.rpc, claims, limits: { waitMs: 10 } };
    const [a, b] = await Promise.all([r.measureRoads(ask), r.measureRoads(ask)]);
    const asked = matrixCalls(f).flatMap((c) => { const x = JSON.parse(String((c[1] as RequestInit).body)); return x.origins.flatMap((o: unknown) => x.destinations.map((d: unknown) => JSON.stringify([o, d]))); });
    expect(asked.length).toBe(new Set(asked).size);
    expect(db.tx()).toBe(30);   // as one call alone
    expect([a.ready, b.ready, a.stored + b.stored]).toEqual([true, true, 30]);
  });
  it('H2: the public page’s allowance refuses: TomTom is not asked (no transaction), OSRM gives the usual hours', async () => {
    const r = await roadsModule();
    const db = fakeDb(star(3));
    const f = vi.fn(async (u: string) => (u.includes('/matrix/') ? jsonOf(cellsOf({ origins: [0], destinations: [0] }, ok601)) : jsonOf(osrmAnswer(u))));
    vi.stubGlobal('fetch', f);
    const gate = vi.fn(async () => false);
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc, gate });
    expect(a).toMatchObject({ ready: true, stored: 6, tomtom: 'over_budget', osrm: 'ok' });
    expect(matrixCalls(f)).toHaveLength(0);
    expect(gate).toHaveBeenCalledWith(3);
    expect(db.calls.some((c) => c.name === 'drive_spend_add' && Number(c.args.p_tx) > 0)).toBe(false);
  });
  it('M1: a TomTom that does not answer never holds the call past its own time: OSRM still gives the usual hours', async () => {
    const r = await roadsModule();
    const db = fakeDb(star(3));
    vi.stubGlobal('fetch', vi.fn((u: string, init?: RequestInit) => (u.includes('/matrix/')
      ? new Promise<Response>((_ok, no) => init?.signal?.addEventListener('abort', () => no(new Error('aborted'))))
      : Promise.resolve(jsonOf(osrmAnswer(u))))));
    const t = Date.now();
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc, limits: { ms: 800 } });
    expect(Date.now() - t).toBeLessThan(800);
    expect(a).toMatchObject({ ready: true, stored: 6, tomtom: 'busy', osrm: 'ok' });
  });
  it('M2: HTTP 200 with every cell failed (not « no road »): TomTom is in trouble (« busy »), OSRM gives the usual hours, paid once', async () => {
    const r = await roadsModule();
    const db = fakeDb(star(3));
    const f = vi.fn(async (u: string, init?: RequestInit) => (u.includes('/matrix/')
      ? jsonOf(cellsOf(JSON.parse(String(init?.body)), () => ({ detailedError: { code: 'COMPUTATION_TIMEOUT', message: 'x' } })))
      : jsonOf(osrmAnswer(u))));
    vi.stubGlobal('fetch', f);
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect(a).toMatchObject({ ready: true, stored: 6, tomtom: 'busy', osrm: 'ok' });
    expect([...db.kept.values()].every((row) => row[7] === 'osrm')).toBe(true);
    const b = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect([b.stored, db.tx()]).toEqual([0, 6]);   // nothing left: not paid again
  });
  it('M4: the database fails in the middle (2nd payment of 6): no request starts after it, what came back is stored, the call answers « more »', async () => {
    const r = await roadsModule();
    const six = Array.from({ length: 6 }, (_, i) => place(10 + i * 7));
    const db = fakeDb(six.flatMap((a) => six.filter((b) => b !== a).map((b) => pair(a, b))), { throwSpendAt: 2 });
    let failedAt = 0;
    const starts: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      starts.push(Date.now());
      await new Promise((ok) => setTimeout(ok, 30));
      return jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601));
    }));
    const spy = db.rpc;
    const rpc = async (n: string, a: Record<string, unknown>) => { try { return await spy(n, a); } catch (e) { failedAt = Date.now(); throw e; } };
    const a = await r.measureRoads({ point: null, from: null, days: 1, only: false, rpc });
    expect(a).toMatchObject({ ok: true, stored: 20, more: true, ready: false });
    expect(starts).toHaveLength(4);
    expect(starts.every((t) => t <= failedAt)).toBe(true);
    expect(db.tx()).toBe(20);
  });
  it('L1: a rush cell with « no road » (its usual-hours time exists) is not a trip without a road: not in no_road', async () => {
    const r = await roadsModule();
    const db = fakeDb([pair(place(1), place(2), 1), pair(place(1), place(2), 2)]);
    const f = vi.fn(async (u: string, init?: RequestInit) => (u.includes('/matrix/') ? jsonOf(cellsOf(JSON.parse(String(init?.body)), () => ({ detailedError: { code: 'NO_ROUTE_FOUND' } }))) : jsonOf(osrmAnswer(u))));
    vi.stubGlobal('fetch', f);
    const a = await r.measureRoads({ point: null, from: null, days: 14, only: false, rpc: db.rpc });
    expect(a.no_road).toBe(0);
    // kept 7 days as « no rush time » (drive_min then counts the usual hours): never paid again at every call
    expect([...db.kept.values()].map((row) => [row[4], row[5], row[7]])).toEqual([[1, null, 'none'], [2, null, 'none']]);
  });
  it('L2: OSRM gives no distance: no km (null), never 0 for a real road', async () => {
    const r = await roadsModule();
    expect(r.readOsrmCell({ durations: [[900]] }, 0, 0)).toEqual({ minutes: 18, km: null });
    delete env.TOMTOM_KEY;
    const db = fakeDb([pair(P0, place(1), 0, true)]);
    vi.stubGlobal('fetch', vi.fn(async () => jsonOf({ code: 'Ok', durations: [[900]] })));
    await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect([...db.kept.values()]).toEqual([[P0.lat, P0.lng, place(1).lat, place(1).lng, 0, 18, null, 'osrm']]);
  });
  it('L4: TomTom answers 429 (too many at once): asked once more a moment later, its transactions counted once', async () => {
    const r = await roadsModule();
    const db = fakeDb(star(3));
    let n = 0;
    const f = vi.fn(async (u: string, init?: RequestInit) => (u.includes('/matrix/') && n++ === 0 ? jsonOf({}, 429) : jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601))));
    vi.stubGlobal('fetch', f);
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc, limits: { retryMs: 20 } });
    expect(a).toMatchObject({ ready: true, stored: 6, tomtom: 'ok', osrm: 'unused' });
    expect(matrixCalls(f)).toHaveLength(3);
    expect(db.tx()).toBe(6);
  });
  it('L5: the rounds limit reached with trips left that can be measured now: « more », call again', async () => {
    const r = await roadsModule();
    const kept = new Set<string>();
    const all = Array.from({ length: 30 }, (_, i) => pair(place(i), place(i + 100)));
    const rpc = async (name: string, args: Record<string, unknown>) => {
      if (name === 'drive_wanted') { const pairs = all.filter((p) => !kept.has(p.join())).slice(0, 1); return { pairs, total: 30 - kept.size, total0: 30 - kept.size, days: [] }; }
      if (name === 'drive_store') { for (const row of args.p_rows as unknown[][]) kept.add([...row.slice(0, 5), false].join()); return { ok: true, stored: (args.p_rows as unknown[]).length, planned: 0, kept: [], late: [] }; }
      return { ok: true, month: '2026-11-01', tx: 0, cap: 10000 };
    };
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601))));
    const a = await r.measureRoads({ point: null, from: null, days: 14, only: false, rpc });
    expect(kept.size).toBe(12);
    expect(a).toMatchObject({ ready: false, more: true, left0: 18 });
  });
  it('L6: a TomTom request starts only when it can end inside the call’s time (here 1 s; each request may take 0.4 s)', async () => {
    const r = await roadsModule();
    const six = Array.from({ length: 6 }, (_, i) => place(10 + i * 7));
    const db = fakeDb(six.flatMap((a) => six.filter((b) => b !== a).map((b) => pair(a, b))));
    const f = vi.fn(async (_u: string, init?: RequestInit) => { await new Promise((ok) => setTimeout(ok, 700)); return jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601)); });
    vi.stubGlobal('fetch', f);
    const t = Date.now();
    const a = await r.measureRoads({ point: null, from: null, days: 1, only: false, rpc: db.rpc, limits: { ms: 1000, tomtomMs: 400 } });
    // the five first started at once; at 0.7 s a sixth could not end before 1 s (0.7 + 0.4): it waits for the next call
    expect(f).toHaveBeenCalledTimes(5);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(a).toMatchObject({ stored: 25, more: true });
  });
});

/* ---------- join-server (2026-11-20): why a pair is listed (drive_wanted's 7th element); an address already booked against a
   sweep (the common lease). Each test failed on the code of before. ---------- */
describe('measuring: an OSRM time is not asked to OSRM again; an address already booked waits for the sweep, never pays twice (join-server)', () => {
  const env: Record<string, string> = {};
  const pair7 = (a: RPt, b: RPt, slot: number, extra: boolean, why: string) => [...pair(a, b, slot, extra), why];
  /** a pretend database: `want` minus what was stored; `extra` = touches the address asked about (only when one is asked) */
  function fakeDb(want: unknown[][], o: { pointPlace?: boolean; spendOk?: boolean } = {}) {
    const kept = new Map<string, unknown[]>();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const id = (p: unknown[]) => p.slice(0, 5).join(',');
    let tx = 0;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'drive_wanted') {
        const pt = args.p_point as RPt | null;
        const touch = (p: unknown[]) => !!pt && ((p[0] === pt.lat && p[1] === pt.lng) || (p[2] === pt.lat && p[3] === pt.lng));
        const pairs = want.filter((p) => !kept.has(id(p))).map((p) => [...p.slice(0, 5), touch(p), ...p.slice(6)]);
        return { pairs, total: pairs.length, total0: pairs.filter((p) => p[4] === 0 && p[6] === 'new').length, days: [], point_place: !!pt && !!o.pointPlace };
      }
      if (name === 'drive_store') { for (const row of args.p_rows as unknown[][]) kept.set(id(row), row); return { ok: true, stored: (args.p_rows as unknown[]).length, planned: 0, kept: [], late: [] }; }
      if (name === 'drive_spend_add') { const n = Number(args.p_tx) || 0; const ok = o.spendOk !== false; if (ok) tx += n; return { ok: n === 0 ? true : ok, month: '2026-11-01', tx, cap: 10000 }; }
      throw new Error('rpc ' + name);
    };
    return { rpc, calls, kept, tx: () => tx };
  }
  const fakeClaims = () => { const held = new Set<string>(); return { held, take: async (k: string) => (held.has(k) ? false : (held.add(k), true)), drop: async (k: string) => { held.delete(k); } }; };
  const cellsOf = (body: { origins: unknown[]; destinations: unknown[] }) =>
    ({ data: body.origins.flatMap((_, o) => body.destinations.map((__, d) => ({ originIndex: o, destinationIndex: d, routeSummary: { lengthInMeters: 5000, travelTimeInSeconds: 601 } }))) });
  const osrmAnswer = (u: string) => { const q = new URL(u).searchParams; const s = q.get('sources')!.split(';'), d = q.get('destinations')!.split(';');
    return { code: 'Ok', durations: s.map(() => d.map(() => 600)), distances: s.map(() => d.map(() => 4000)) }; };
  const jsonOf = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const osrmCalls = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.filter((c) => String(c[0]).includes('/table/'));
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.TOMTOM_KEY = 'K'; env.TOMTOM_BASE = 'http://tt'; env.OSRM_BASE = 'http://osrm';
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('no TomTom key: an address whose trips are listed only because their rows are OSRM’s a day old asks NOTHING (OSRM would give the same), and is ready', async () => {
    const r = await roadsModule();
    delete env.TOMTOM_KEY;
    const db = fakeDb([pair7(P0, place(1), 0, true, 'osrm'), pair7(place(1), P0, 0, true, 'osrm')]);
    const f = vi.fn(async (u: string) => jsonOf(osrmAnswer(u)));
    vi.stubGlobal('fetch', f);
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
    expect(f).not.toHaveBeenCalled();   // before: one OSRM table a call, every call (the screen's warm, roadsSweep every 10 min)
    expect(a).toMatchObject({ ok: true, ready: true, stored: 0, tomtom: 'no_key', osrm: 'unused', more: false });
  });
  it('TomTom refuses, or the month is spent: the OSRM rows a day old are not asked to OSRM again; a trip with no time (new) or an old time is', async () => {
    const r = await roadsModule();
    const want = () => [pair7(P0, place(1), 0, true, 'new'), pair7(place(1), P0, 0, true, 'osrm'), pair7(P0, place(2), 0, true, 'osrm'), pair7(place(2), P0, 0, true, 'old')];
    for (const mode of ['refused', 'over_budget'] as const) {
      const db = fakeDb(want(), { spendOk: mode !== 'over_budget' });
      const f = vi.fn(async (u: string) => (u.includes('/matrix/') ? jsonOf({}, 403) : jsonOf(osrmAnswer(u))));
      vi.stubGlobal('fetch', f);
      const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc });
      expect(a).toMatchObject({ ok: true, ready: true, stored: 2, tomtom: mode, osrm: 'ok', more: false });
      expect(osrmCalls(f)).toHaveLength(1);
      // the one OSRM table holds the new trip and the old one only: P0 → 1 and 2 → P0 (before: the four)
      expect([...db.kept.values()].map((row) => row.slice(0, 4).join())).toEqual([[P0.lat, P0.lng, place(1).lat, place(1).lng].join(), [place(2).lat, place(2).lng, P0.lat, P0.lng].join()]);
    }
  });
  it('TomTom AND OSRM down: an address whose trips all have an OSRM time (a day old) is ready — the planner has their times; a trip with none is not', async () => {
    const r = await roadsModule();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/matrix/') ? jsonOf({}, 503) : jsonOf({ code: 'Error' }, 503))));
    const a = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: fakeDb([pair7(P0, place(1), 0, true, 'osrm'), pair7(place(1), P0, 0, true, 'osrm')]).rpc });
    expect(a).toMatchObject({ ready: true, stored: 0, tomtom: 'busy', more: false });   // before: ready false (« pas encore mesuré »)
    const b = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: fakeDb([pair7(P0, place(1), 0, true, 'osrm'), pair7(place(1), P0, 0, true, 'new')]).rpc });
    expect(b).toMatchObject({ ready: false, stored: 0, more: false });
  });
  it('a database of before (pairs of 6, no reason said): measured as before', async () => {
    const r = await roadsModule();
    delete env.TOMTOM_KEY;
    const db = fakeDb([[...pair(P0, place(1), 0, true)], [...pair(place(1), P0, 0, true)]]);
    const f = vi.fn(async (u: string) => jsonOf(osrmAnswer(u)));
    vi.stubGlobal('fetch', f);
    expect(await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc })).toMatchObject({ ready: true, stored: 2, osrm: 'ok' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  // the address is a booked stop of those days (drive_wanted: point_place): its trips are the sweep's trips too
  const stops = [place(1), place(2), place(3)];
  const dayOf = (o: { pointPlace?: boolean } = {}) => {
    const all = [P0, ...stops];
    return fakeDb(all.flatMap((a) => all.filter((b) => b !== a).map((b) => pair7(a, b, 0, false, 'new'))), o);
  };
  const asked = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.filter((c) => String(c[0]).includes('/matrix/'))
    .flatMap((c) => { const x = JSON.parse(String((c[1] as RequestInit).body)); return x.origins.flatMap((o: unknown) => x.destinations.map((d: unknown) => JSON.stringify([o, d]))); });
  it('an address already booked (point_place), warmed while a sweep runs: its trips are asked ONCE (it waits for the common lease, then finds them stored)', async () => {
    const r = await roadsModule();
    const db = dayOf({ pointPlace: true });
    const claims = fakeClaims();
    const f = vi.fn(async (_u: string, init?: RequestInit) => { await new Promise((ok) => setTimeout(ok, 40)); return jsonOf(cellsOf(JSON.parse(String(init?.body)))); });
    vi.stubGlobal('fetch', f);
    const [s, w] = await Promise.all([
      r.measureRoads({ point: null, from: null, days: 14, only: false, rpc: db.rpc, claims, limits: { waitMs: 10 } }),
      r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc, claims, limits: { waitMs: 10 } })]);
    const cells = asked(f);
    expect(cells.length).toBe(new Set(cells).size);   // before: the address's 6 trips asked by both (its own lease vs the sweep's)
    expect([cells.length, db.tx(), s.stored + w.stored]).toEqual([12, db.tx(), 12]);
    expect([s.ready, w.ready]).toEqual([true, true]);
    expect(claims.held.size).toBe(0);
  });
  it('an address already booked, while a LONG sweep holds the common lease: it waits only a short while (shareWaitMs), then measures under its own lease — the screen is never held by a sweep', async () => {
    const r = await roadsModule();
    const db = dayOf({ pointPlace: true });
    const claims = fakeClaims();
    claims.held.add('drive:claim:all');   // a sweep somewhere, for the next 40 s
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => jsonOf(cellsOf(JSON.parse(String(init?.body))))));
    const t = Date.now();
    const w = await r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: db.rpc, claims, limits: { waitMs: 10, shareWaitMs: 60 } });
    expect(Date.now() - t).toBeLessThan(600);   // before this bound: the whole call's time (here 40 s) waiting for the sweep
    expect(w).toMatchObject({ ready: true, stored: 6, more: false });
    expect([...claims.held]).toEqual(['drive:claim:all']);   // its own lease given back, the sweep's untouched
  });
  it('an address NOT booked keeps its own lease: a sweep running does not hold the booking screen (its trips are not the sweep’s)', async () => {
    const r = await roadsModule();
    const all = [...stops];
    const sweepDb = fakeDb(all.flatMap((a) => all.filter((b) => b !== a).map((b) => pair7(a, b, 0, false, 'new'))));
    const pointDb = fakeDb([pair7(P0, place(1), 0, true, 'new'), pair7(place(1), P0, 0, true, 'new')]);
    const claims = fakeClaims();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { await new Promise((ok) => setTimeout(ok, 60)); return jsonOf(cellsOf(JSON.parse(String(init?.body)))); }));
    const done: string[] = [];
    await Promise.all([
      r.measureRoads({ point: null, from: null, days: 14, only: false, rpc: sweepDb.rpc, claims, limits: { waitMs: 10, inFlight: 1 } }).then(() => done.push('sweep')),
      new Promise((ok) => setTimeout(ok, 5)).then(() => r.measureRoads({ point: P0, from: null, days: 14, only: true, rpc: pointDb.rpc, claims, limits: { waitMs: 10 } })).then((w) => { done.push('warm'); expect(w.ready).toBe(true); })]);
    expect(done).toEqual(['warm', 'sweep']);
  });
});

describe('measuring at the scale of a busy garage, and what was paid is never lost (final-fix-server, round 5)', () => {
  const env: Record<string, string> = {};
  /** a pretend database: `want` minus what was stored; drive_store may fail its first `failStores` calls, answer a re-plan
      that failed (replan), and every row it gets is kept as sent */
  function fakeDb(want: unknown[][], o: { failStores?: number; replan?: string[] } = {}) {
    const kept = new Map<string, unknown[]>();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const id = (p: unknown[]) => p.slice(0, 5).join(',');
    let fails = o.failStores || 0;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'drive_wanted') {
        const pairs = want.filter((p) => !kept.has(id(p)) && (args.p_point || !p[5]));
        return { pairs: pairs.slice(0, 3000), total: pairs.length, total0: pairs.filter((p) => p[4] === 0).length, days: ['2026-11-24'] };
      }
      if (name === 'drive_store') {
        if (fails > 0) { fails--; throw new Error('canceling statement due to lock timeout'); }
        for (const row of args.p_rows as unknown[][]) kept.set(id(row), row);
        return { ok: true, stored: (args.p_rows as unknown[]).length, planned: 0, kept: [], late: [], ...(o.replan ? { replan: o.replan, replan_error: 'x' } : {}) };
      }
      if (name === 'roads_replan') return { planned: 3, kept: [{ day: '2026-11-24', block: 'am' }], late: ['j1'] };
      if (name === 'drive_spend_add') return { ok: true, month: '2026-11-01', tx: 0, cap: 10000 };
      throw new Error('rpc ' + name);
    };
    return { rpc, calls, kept };
  }
  const cellsOf = (body: { origins: unknown[]; destinations: unknown[] }, f: (o: number, d: number) => object) =>
    ({ data: body.origins.flatMap((_, o) => body.destinations.map((__, d) => ({ originIndex: o, destinationIndex: d, ...f(o, d) }))) });
  const ok601 = () => ({ routeSummary: { lengthInMeters: 5000, travelTimeInSeconds: 601 } });
  const osrmAnswer = (u: string) => { const q = new URL(u).searchParams; const s = q.get('sources')!.split(';'), d = q.get('destinations')!.split(';');
    return { code: 'Ok', durations: s.map(() => d.map(() => 600)), distances: s.map(() => d.map(() => 4000)) }; };
  const jsonOf = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  /** `days` days of `n` places each (a start and its stops), every trip of a day between them, as drive_wanted lists them */
  const busy = (days: number, n: number, slot: 0 | 1 | 2 = 0) => Array.from({ length: days }, (_, d) => {
    const pts = Array.from({ length: n }, (__, i) => ({ lat: 45.4 + d / 100 + i / 1000, lng: -73.8 + i / 997 + d / 333 }));
    return pts.flatMap((a) => pts.filter((b) => b !== a).map((b) => pair(a, b, slot)));
  }).flat();
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    env.TOMTOM_KEY = 'K'; env.TOMTOM_BASE = 'http://tt'; env.OSRM_BASE = 'http://osrm';
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('F1: 3 000 trips of full days are grouped in well under a second (before: 2.5–11 s, past Supabase’s 2 s of CPU), every trip once, 100 cells at most', async () => {
    const r = await roadsModule();
    const trips = r.tripsOf({ pairs: busy(40, 9) }).slice(0, 3000);
    expect(trips.length).toBe(2880);
    const t0 = performance.now();
    const g = r.groupTomtom(trips);
    const took = performance.now() - t0;
    expect(took).toBeLessThan(1000);
    expect(g.every((x) => x.origins.length * x.destinations.length <= 100)).toBe(true);
    const asked = g.flatMap((x) => x.cells.map((c) => c.trip.id));
    expect(asked.length).toBe(trips.length);
    expect(new Set(asked).size).toBe(trips.length);
    expect(g.some((x) => x.origins.length > 5 && x.destinations.length > 5), 'the squares of the full days are still found').toBe(true);
  });
  it('F1: a round takes at most 500 trips (the next round the rest); each slot is stored as soon as it is measured', async () => {
    const r = await roadsModule();
    const db = fakeDb([...busy(14, 9), ...busy(2, 9, 1)]);   // 1 008 usual-hours trips, then 144 rush trips
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601))));
    const a = await r.measureRoads({ point: null, from: null, days: 14, only: false, rpc: db.rpc });
    expect(a).toMatchObject({ ok: true, stored: 1152, more: false, ready: true });
    const stores = db.calls.filter((c) => c.name === 'drive_store').map((c) => (c.args.p_rows as unknown[][]));
    expect(stores.map((x) => x.length)).toEqual([500, 500, 8, 144]);
    expect(stores.every((x) => new Set(x.map((row) => row[4])).size === 1), 'one slot a store').toBe(true);
    // the days named once a round, on its first store
    expect(db.calls.filter((c) => c.name === 'drive_store').map((c) => c.args.p_days)).toEqual([['2026-11-24'], ['2026-11-24'], ['2026-11-24'], null]);
  });
  it('F5: drive_store fails once (a lock, a statement too long): asked once more with the same rows, nothing paid twice; a re-plan that failed is asked again', async () => {
    const r = await roadsModule();
    const want = busy(1, 4);
    let db = fakeDb(want, { failStores: 1 });
    const f = vi.fn(async (_u: string, init?: RequestInit) => jsonOf(cellsOf(JSON.parse(String(init?.body)), ok601)));
    vi.stubGlobal('fetch', f);
    let a = await r.measureRoads({ point: null, from: null, days: 1, only: false, rpc: db.rpc });
    expect(a).toMatchObject({ ok: true, stored: 12, ready: true });
    const stores = db.calls.filter((c) => c.name === 'drive_store');
    expect(stores).toHaveLength(2);
    expect(stores[1].args).toEqual(stores[0].args);
    expect(f.mock.calls.length, 'TomTom asked once for them').toBe(4);
    // the rows kept but the re-plan failed: roads_replan once more, its answer counted
    db = fakeDb(want, { replan: ['2026-11-24'] });
    a = await r.measureRoads({ point: null, from: null, days: 1, only: false, rpc: db.rpc });
    expect(db.calls.filter((c) => c.name === 'roads_replan').map((c) => c.args)).toEqual([{ p_days: ['2026-11-24'] }]);
    expect(a).toMatchObject({ planned: 3, kept: [{ day: '2026-11-24', block: 'am' }], late: ['j1'] });
    // it fails twice: the call fails, as before (nothing guessed, the next call asks again)
    db = fakeDb(want, { failStores: 2 });
    await expect(r.measureRoads({ point: null, from: null, days: 1, only: false, rpc: db.rpc })).rejects.toThrow(/lock timeout/);
  });
  it('F3 / F4: TomTom « no road » or a cell it could not answer (the rest fine): OSRM’s usual hours marked « TomTom could not » (asked again after 7 days); a rush cell → « none »', async () => {
    const r = await roadsModule();
    const pts = [place(1), place(2), place(3), place(4)];
    // each request a star of 3 cells (1 × 3): its first cell fails, the 2 others answer (not TomTom's own trouble)
    const want = [...pts.flatMap((a) => pts.filter((b) => b !== a).map((b) => pair(a, b))), ...pts.slice(1).map((b) => pair(pts[0], b, 1))];
    const db = fakeDb(want);
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (!u.includes('/matrix/')) return jsonOf(osrmAnswer(u));
      const b = JSON.parse(String(init?.body));
      // the first cell of each request: « no road » (usual hours) or an odd error (the others answered)
      return jsonOf(cellsOf(b, (o, d) => (o === 0 && d === 0 ? { detailedError: { code: b.options.departAt.endsWith('11:30:00') ? 'NO_ROUTE_FOUND' : 'OTHER' } } : ok601())));
    }));
    const a = await r.measureRoads({ point: null, from: null, days: 1, only: false, rpc: db.rpc });
    expect(a.ok).toBe(true);
    const rows = [...db.kept.values()];
    const osrm = rows.filter((x) => x[7] === 'osrm');
    expect(osrm.length).toBeGreaterThan(0);
    expect(osrm.every((x) => x.length === 9 && x[8] === true), JSON.stringify(osrm)).toBe(true);
    expect(rows.filter((x) => x[7] === 'tomtom').every((x) => x.length === 8)).toBe(true);
    const rushNone = rows.filter((x) => x[4] === 1 && x[7] === 'none');
    expect(rushNone.length).toBeGreaterThan(0);
    expect(rows.filter((x) => x[4] === 1).length, 'every rush trip stored: none is paid again at the next call').toBe(3);
  });
});
