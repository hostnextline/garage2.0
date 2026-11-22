// « Vraies routes » (Part 27) on the server: the planner's road times, measured on the real roads and kept in drive_times.
// The database says what is missing (drive_wanted: the trips of the coming days the planner drives, the address asked
// about first). This code asks TomTom's Matrix service (its usual traffic for that weekday and hour; three times a trip on
// a working day: the usual hours, the morning rush, the evening rush) and, when TomTom cannot answer, OSRM (the usual hours
// only: OSRM knows no traffic, so its time + 20 %). Then it gives the times to the database (drive_store), which plans the
// touched days again. Never a straight line: a trip nobody could measure stays « not measured » (the planner counts the
// garage's fixed unknown time for it, and every answer says so). Used by the function « drive » (warm, sweep) and by
// « book » (an online booking's address is measured before its moments are offered).
//
// Money (TomTom's rule): a Matrix request costs origins × destinations « transactions », or 5 × the larger side when BOTH
// sides are above 5. A new address is a star (the address → each place of those days, each place → the address): one
// request of 1 × N and one of N × 1, 2N transactions, whatever the grouping. A full day of n places costs n(n−1) asked as
// rows, but 5n asked as one square: a square is taken only when both sides are above 5 and it costs less than rows. Each
// request's cost is added to the month's spend BEFORE it is sent (drive_spend_add, under booking.roads_month_tx); past the
// ceiling TomTom is not asked again this month: OSRM gives the usual hours, the rush times wait.
// Two calls at the same time never measure (nor pay) the same trips: a call holds a lease while it measures (one per
// address, one for the rest of the days and the sweep; an address that is already a place of those days, a booked stop,
// takes the common one: its trips are the sweep's too); a second call waits for it, then finds the trips stored.
// drive_wanted says why each trip is listed (new, old, osrm, none): when TomTom cannot be used in a call, a trip listed only
// because its time is OSRM's (a day old) is not asked to OSRM again (it would answer the same), and it does not stop the
// address being « ready » (the planner has its time).
// The public booking page (« book ») has its own allowance of the month on top (monthAllowance): past it, OSRM.
// The pure parts are tested in src/shared/map/server-road.test.ts; the whole, with fake TomTom / OSRM, in tests/api/drive.test.mjs.
import { env, fail } from './http.ts';
import { localDay } from './texts.ts';
import { tomtomMatrixUrl, tomtomMatrixBody, readTomtomMatrix, type RoadPt, type MatrixCell } from './tomtom.ts';

export type Slot = 0 | 1 | 2;
/** why drive_wanted lists a trip: no row (new), a time older than roads_keep_days (old), an OSRM time a day old to ask TomTom
    (osrm), « no road » past its 7 days (none); undefined from a database of before (6-element pairs) */
export type Why = 'new' | 'old' | 'osrm' | 'none';
/** a trip to measure, as drive_wanted lists it: from a to b, at a time of the day (slot), touching the address asked about */
export interface Trip { a: RoadPt; b: RoadPt; slot: Slot; extra: boolean; id: string; why?: Why }
/** a trip listed only to make a time the planner already has better (an OSRM time, an old one): not « missing » for ready */
const hasTime = (t: Trip) => t.why === 'osrm' || t.why === 'old';
/** the database as the server (service key): a function of the migration, by name */
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<any>;
export type TomtomState = 'ok' | 'no_key' | 'refused' | 'busy' | 'over_budget' | 'unused';
export type OsrmState = 'ok' | 'down' | 'unused';
export interface Spend { month: string; tx: number; cap: number }
/** what a measuring call answers (the function « drive », CONTRACT §3) */
export interface Measured {
  ok: true; ready: boolean; left: number; left0: number; stored: number; planned: number;
  kept: { day: string; block: string }[]; late: string[]; no_road: number;
  tomtom: TomtomState; osrm: OsrmState; spent: Spend | null; more: boolean;
}

/** the brakes of one call: ~40 s and 60 requests (TomTom and OSRM together), 5 TomTom requests at a time, 100 cells a
    TomTom request (TomTom's limit), 100 places an OSRM request (the public OSRM server's), each request's own time (at
    most 45 % of the call's: a TomTom that does not answer leaves the time for OSRM), 12 rounds. A request starts only when
    it can end inside the call's time, so a call measures for ~40 s at most, then stores. A lease (two calls never on the
    same trips) is kept at most 90 s by a call that died, and looked at again every 0.4 s by a call waiting for it; an address
    already booked waits for the common lease (a sweep) at most 2.5 s (a screen waits 3.5 s, the public page 8 s). A 429
    (too many requests at once) is asked once more after 1.5 s. At most 500 trips a round (final-money F1, final-security F3:
    the grouping of a round must stay far inside Supabase's 2 s of CPU a request; the rest goes to the next round, then `more`) */
export const LIMITS = { ms: 40_000, requests: 60, inFlight: 5, maxCells: 100, osrmPoints: 100, tomtomMs: 12_000, osrmMs: 8_000, rounds: 12,
  leaseMs: 90_000, waitMs: 400, retryMs: 1_500, shareWaitMs: 2_500, roundTrips: 500 };
/** the address asked about must be this close to « Départ des camions » (a brake on random points: a radius, not a time) */
export const REACH_KM = 150;

// ---------- the trips ----------
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const okPt = (lat: number | null, lng: number | null): boolean => lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
/** a position given by a caller ({ lat, lng }, numbers on Earth), else null */
export function pointOf(p: unknown): RoadPt | null {
  const lat = num((p as RoadPt | null)?.lat), lng = num((p as RoadPt | null)?.lng);
  return p && typeof p === 'object' && okPt(lat, lng) ? { lat: lat!, lng: lng! } : null;
}
/** a real day of the calendar written YYYY-MM-DD */
export function realDay(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const placeId = (p: RoadPt) => `${p.lat},${p.lng}`;
/** drive_wanted's pairs [alat, alng, blat, blng, slot, extra, why] → trips (a pair that is not one is left out) */
export function tripsOf(w: unknown): Trip[] {
  const pairs = (w as { pairs?: unknown } | null)?.pairs;
  const out: Trip[] = [];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(p)) continue;
    const [alat, alng, blat, blng, slot] = [num(p[0]), num(p[1]), num(p[2]), num(p[3]), num(p[4])];
    if (!okPt(alat, alng) || !okPt(blat, blng) || (slot !== 0 && slot !== 1 && slot !== 2)) continue;
    const a = { lat: alat!, lng: alng! }, b = { lat: blat!, lng: blng! };
    const why = (['new', 'old', 'osrm', 'none'] as const).find((x) => x === p[6]);
    out.push({ a, b, slot: slot as Slot, extra: p[5] === true, id: `${placeId(a)}>${placeId(b)}#${slot}`, ...(why ? { why } : {}) });
  }
  return out;
}

// ---------- when TomTom's usual traffic is asked ----------
// One date for every request of a call: the next Tuesday, Wednesday or Thursday at least one day after today (Montréal),
// that is not a holiday of Québec (a Monday or a Friday holiday is skipped by taking Tuesday to Thursday). Then 11 h 30 for
// the usual hours, 8 h for the morning rush, 17 h for the evening rush (drive_slot: 6 h 30–9 h 29 and 15 h–18 h 29;
// 17 h is the heaviest, so a 15 h departure is on the safe side).
const HOLIDAYS = ['01-01', '06-24', '07-01', '12-25', '12-26'];
export const SLOT_AT = ['11:30:00', '08:00:00', '17:00:00'] as const;
export function departDay(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 1; i <= 21; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    const day = t.toISOString().slice(0, 10);
    if ([2, 3, 4].includes(t.getUTCDay()) && !HOLIDAYS.includes(day.slice(5))) return day;
  }
  return today;   // never reached: three weekdays out of seven
}
export const departAt = (day: string, slot: Slot): string => `${day}T${SLOT_AT[slot]}`;

// ---------- grouping: the fewest transactions, then the fewest requests ----------
/** TomTom's bill for one request of o origins × d destinations */
export function txCost(o: number, d: number): number { return o > 5 && d > 5 ? 5 * Math.max(o, d) : o * d; }
/** one request: its origins and destinations, the trips wanted in it (each at its cell), its cost */
export interface Group { origins: RoadPt[]; destinations: RoadPt[]; cells: { trip: Trip; o: number; d: number }[]; cost: number }

function groupOf(trips: Trip[]): Group {
  const os = new Map<string, number>(), ds = new Map<string, number>();
  const origins: RoadPt[] = [], destinations: RoadPt[] = [];
  const cells = trips.map((trip) => {
    const ka = placeId(trip.a), kb = placeId(trip.b);
    if (!os.has(ka)) { os.set(ka, origins.length); origins.push(trip.a); }
    if (!ds.has(kb)) { ds.set(kb, destinations.length); destinations.push(trip.b); }
    return { trip, o: os.get(ka)!, d: ds.get(kb)! };
  });
  return { origins, destinations, cells, cost: txCost(origins.length, destinations.length) };
}
/** the trips of one slot → TomTom requests. First the squares that cost less than the same trips asked as rows (a day of 7
    places or more, asked whole); then « stars »: one place and up to 100 of its trips, leaving it (1 × N) or coming to it
    (N × 1), the place with the most trips first (the new address: its 1 × N, then its N × 1) */
export function groupTomtom(trips: Trip[], maxCells = LIMITS.maxCells): Group[] {
  // (final-money F1, final-security F3) the same groups as before, found with lists built once a pass (each place's trips
  // leaving and arriving), never by counting every trip again for every origin: 3 000 trips cost milliseconds, not seconds
  const left = new Map(trips.map((t) => [t.id, t]));
  const groups: Group[] = [];
  const ka = new Map<Trip, string>(), kb = new Map<Trip, string>();
  for (const t of trips) { ka.set(t, placeId(t.a)); kb.set(t, placeId(t.b)); }
  const A = (t: Trip) => ka.get(t)!, B = (t: Trip) => kb.get(t)!;
  const push = (m: Map<string, Trip[]>, k: string, t: Trip) => { const l = m.get(k); if (l) l.push(t); else m.set(k, [t]); };
  /** a count by place: [how many, the first trip (in the order given) that counts for it] */
  type Count = Map<string, [number, number]>;
  const inc = (m: Count, k: string, i: number) => { const v = m.get(k); if (v) { v[0]++; if (i < v[1]) v[1] = i; } else m.set(k, [1, i]); };
  /** the `cap` places counted most; equal counts in the order they are first met (as before) */
  const top = (m: Count, cap: number) => [...m.entries()].sort((x, y) => y[1][0] - x[1][0] || x[1][1] - y[1][1]).slice(0, cap).map((e) => e[0]);
  // squares: from each origin with 6 trips or more, the densest block of origins × destinations around it
  for (;;) {
    const all = [...left.values()];
    const pos = new Map<Trip, number>();
    all.forEach((t, i) => pos.set(t, i));
    const byA = new Map<string, Trip[]>(), byB = new Map<string, Trip[]>();
    for (const t of all) { push(byA, A(t), t); push(byB, B(t), t); }
    let best: { trips: Trip[]; saving: number } | null = null;
    for (const outs of byA.values()) {
      if (outs.length < 6) continue;
      const c0: Count = new Map();
      for (const t of outs) inc(c0, B(t), pos.get(t)!);
      let D = new Set(top(c0, 10));
      let O = new Set<string>();
      for (let pass = 0; pass < 2; pass++) {
        const co: Count = new Map();
        for (const d of D) for (const t of byB.get(d) || []) inc(co, A(t), pos.get(t)!);
        O = new Set(top(co, Math.floor(maxCells / Math.max(D.size, 1))));
        const cd: Count = new Map();
        for (const o of O) for (const t of byA.get(o) || []) inc(cd, B(t), pos.get(t)!);
        D = new Set(top(cd, Math.floor(maxCells / Math.max(O.size, 1))));
      }
      if (O.size < 6 || D.size < 6 || O.size * D.size > maxCells) continue;
      const inside: Trip[] = [];
      for (const o of O) for (const t of byA.get(o) || []) if (D.has(B(t))) inside.push(t);
      inside.sort((x, y) => pos.get(x)! - pos.get(y)!);
      const saving = inside.length - txCost(O.size, D.size);
      if (saving > 0 && (!best || saving > best.saving)) best = { trips: inside, saving };
    }
    if (!best) break;
    groups.push(groupOf(best.trips));
    for (const t of best.trips) left.delete(t.id);
  }
  // stars
  while (left.size) {
    const outs = new Map<string, Trip[]>(), ins = new Map<string, Trip[]>();
    for (const t of left.values()) { push(outs, A(t), t); push(ins, B(t), t); }
    let pick: Trip[] = [];
    for (const list of outs.values()) if (list.length > pick.length) pick = list;
    for (const list of ins.values()) if (list.length > pick.length) pick = list;
    const take = pick.slice(0, maxCells);
    groups.push(groupOf(take));
    for (const t of take) left.delete(t.id);
  }
  return groups;
}
/** OSRM (free, the usual hours only): as many trips a request as fit in 100 places (its table answers every source × every
    destination of the list), in the order given */
export function groupOsrm(trips: Trip[], maxPoints = LIMITS.osrmPoints): { points: RoadPt[]; sources: number[]; destinations: number[]; trips: { trip: Trip; s: number; d: number }[] }[] {
  const out: { points: RoadPt[]; sources: number[]; destinations: number[]; trips: { trip: Trip; s: number; d: number }[] }[] = [];
  let pts = new Map<string, number>(), points: RoadPt[] = [], cur: { trip: Trip; ia: number; ib: number }[] = [];
  const flush = () => {
    if (!cur.length) return;
    const sources = [...new Set(cur.map((c) => c.ia))].sort((x, y) => x - y);
    const destinations = [...new Set(cur.map((c) => c.ib))].sort((x, y) => x - y);
    out.push({ points, sources, destinations, trips: cur.map((c) => ({ trip: c.trip, s: sources.indexOf(c.ia), d: destinations.indexOf(c.ib) })) });
    pts = new Map(); points = []; cur = [];
  };
  for (const trip of trips) {
    const ka = placeId(trip.a), kb = placeId(trip.b);
    const need = (pts.has(ka) ? 0 : 1) + (pts.has(kb) || ka === kb ? 0 : 1);
    if (points.length + need > maxPoints) flush();
    for (const [k, p] of [[ka, trip.a], [kb, trip.b]] as [string, RoadPt][]) if (!pts.has(k)) { pts.set(k, points.length); points.push(p); }
    cur.push({ trip, ia: pts.get(ka)!, ib: pts.get(kb)! });
  }
  flush();
  return out;
}
/** OSRM's table address: the places as lng,lat; which are sources and destinations */
export function osrmTableUrl(base: string, g: { points: RoadPt[]; sources: number[]; destinations: number[] }): string {
  return `${base}/table/v1/driving/${g.points.map((p) => `${p.lng},${p.lat}`).join(';')}?sources=${g.sources.join(';')}`
    + `&destinations=${g.destinations.join(';')}&annotations=duration,distance`;
}
/** one cell of OSRM's table: its time + 20 % (the traffic OSRM does not know), rounded up, and its km (null when OSRM gave
    no distance: a km printed is a measured one, never 0 for a real road); null: no road */
export function readOsrmCell(d: unknown, s: number, t: number): { minutes: number; km: number | null } | null {
  const x = d as { durations?: (number | null)[][]; distances?: (number | null)[][] } | null;
  const sec = x?.durations?.[s]?.[t], m = x?.distances?.[s]?.[t];
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return null;
  return { minutes: Math.ceil((sec / 60) * 1.2), km: typeof m === 'number' && Number.isFinite(m) && m >= 0 ? Math.round(m / 100) / 10 : null };
}

// ---------- one call at a time on the same trips ----------
// Two calls at the same time (the same address on two phones, each phone's « rest » of the days, every owner's and
// office's sweep, the nightly one) would read the same missing trips and pay TomTom for them twice. So a call holds a
// lease while it measures: one per address (its own usual-hours trips), one for everything else (the rest of the days and
// the sweep). A second call waits for it (within its own time), then reads drive_wanted again: what the first one stored
// is not asked again. Out of time while waiting: `more`, as any brake.
/** the leases: take → true when this call holds `key` now (kept at most leaseMs by a call that never gives it back) */
export interface Claims { take(key: string, leaseMs: number): Promise<boolean>; drop(key: string): Promise<void> }
/** the leases as rows of rate_limits (the brakes' table, server key only): key `drive:claim:…`, bucket 0, n = the holder's
    token, at = when it was taken. A row older than its lease is a call that died: cleared before taking */
export function tableClaims(db: { from(table: string): any }): Claims {
  const mine = new Map<string, number>();
  return {
    async take(key, leaseMs) {
      const now = Date.now();
      const old = await db.from('rate_limits').delete().eq('key', key).eq('bucket', 0).lt('at', new Date(now - leaseMs).toISOString());
      if (old?.error) throw old.error;
      const token = 1 + Math.floor(Math.random() * 2_000_000_000);
      const { error } = await db.from('rate_limits').insert({ key, bucket: 0, n: token, at: new Date(now).toISOString() });
      if (!error) { mine.set(key, token); return true; }
      if (error.code === '23505') return false;   // another call holds it
      throw error;
    },
    async drop(key) {
      const token = mine.get(key);
      if (token === undefined) return;
      mine.delete(key);
      const { error } = await db.from('rate_limits').delete().eq('key', key).eq('bucket', 0).eq('n', token);
      if (error) throw error;
    }
  };
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** the place of drive_key (3 decimals, about 100 m): two doors of the same building share their trips, and their lease */
const placeKey = (p: RoadPt) => `${Math.round((p.lat + 90) * 1000)}:${Math.round((p.lng + 180) * 1000)}`;

/** the public booking page's own TomTom allowance of the month: `cap` transactions, counted in a rate_limits row (key
    `drive:web:tx:<YYYY-MM>`, bucket 0, n = what the page spent), read and written by one request at a time (its lease
    `drive:claim:web`); its `at` is the next month's first day, so the brakes' 2-day housekeeping keeps it all month.
    false: no TomTom for that request (OSRM gives the usual hours): one script on the public page never spends the
    team's month */
export function monthAllowance(db: { from(table: string): any }, claims: Claims, cap: number): (cost: number) => Promise<boolean> {
  return async (cost) => {
    if (!(cap > 0) || cost > cap) return false;
    const month = localDay(new Date()).slice(0, 7);
    const key = `drive:web:tx:${month}`, lock = 'drive:claim:web';
    let held = await claims.take(lock, 10_000);
    for (let i = 0; !held && i < 10; i++) { await sleep(100); held = await claims.take(lock, 10_000); }
    if (!held) return false;
    try {
      const { data, error } = await db.from('rate_limits').select('n').eq('key', key).eq('bucket', 0).maybeSingle();
      if (error) throw error;
      const spent = Number(data?.n) || 0;
      if (spent + cost > cap) return false;
      const [y, m] = month.split('-').map(Number);
      const { error: e2 } = await db.from('rate_limits').upsert({ key, bucket: 0, n: spent + cost, at: new Date(Date.UTC(y, m, 1)).toISOString() }, { onConflict: 'key,bucket' });
      if (e2) throw e2;
      return true;
    } finally {
      await claims.drop(lock);
    }
  };
}

// ---------- measuring ----------
/** a row for drive_store; a 9th element true on an OSRM row: TomTom could not give that trip (« no road », or a cell
    error that is not its trouble), so drive_wanted asks TomTom again only after 7 days (final-money F3, F4) */
type Row = [number, number, number, number, Slot, number | null, number | null, 'tomtom' | 'osrm' | 'none'] | [number, number, number, number, Slot, number | null, number | null, 'osrm', true];
const rowOf = (t: Trip, v: { minutes: number; km: number | null } | null, source: 'tomtom' | 'osrm' | 'none', ttNo = false): Row =>
  ttNo && source === 'osrm' && v ? [t.a.lat, t.a.lng, t.b.lat, t.b.lng, t.slot, v.minutes, v.km, 'osrm', true]
    : [t.a.lat, t.a.lng, t.b.lat, t.b.lng, t.slot, v ? v.minutes : null, v ? v.km : null, source];

/** `fn` on each item, n at a time. A failure (the database, mid-call) stops it: nothing new starts, what is under way
    finishes and is kept; the first error is given back, never thrown (no request leaves after the call failed) */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<unknown> {
  const st = { i: 0, failed: false, error: null as unknown };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (!st.failed && st.i < items.length) {
      try { await fn(items[st.i++]); } catch (e) { if (!st.failed) { st.failed = true; st.error = e; } }
    }
  }));
  return st.failed ? (st.error ?? new Error('failed')) : null;
}

export interface MeasureAsk {
  /** the address asked about (warm), null for a sweep */
  point: RoadPt | null;
  from: string | null;
  days: number;
  /** only the address's usual-hours trips (the screen is waiting); else the rest of those days after them */
  only: boolean;
  rpc: Rpc;
  limits?: Partial<typeof LIMITS>;
  /** the leases (tableClaims); none: no other call to wait for (the unit tests' pretend database) */
  claims?: Claims;
  /** asked with a request's cost before the month's spend, for the requests of the address's own trips only (its first
      round): false = no TomTom for them (the public page's allowance; a person's own allowance of addresses). The rest of
      those days (the garage's own trips, the sweep's too) is never held by it */
  gate?: (cost: number) => Promise<boolean>;
}

/** measures what drive_wanted lists (the address's usual-hours trips first, alone in their round), stores it, plans again;
    round after round until nothing is left that can be measured now, or a brake of the call is reached (`more`) */
export async function measureRoads(ask: MeasureAsk): Promise<Measured> {
  const lim = { ...LIMITS, ...(ask.limits || {}) };
  const t0 = Date.now();
  // each request's own time: never more than 45 % of the call's, so a TomTom that does not answer leaves OSRM the time
  // to give the usual hours (the public page waits 8 s at most)
  const ttMs = Math.min(lim.tomtomMs, lim.ms * 0.45), osMs = Math.min(lim.osrmMs, lim.ms * 0.45), shortest = Math.min(ttMs, osMs);
  const key = env('TOMTOM_KEY');
  const ttBase = env('TOMTOM_BASE', 'https://api.tomtom.com'), osrmBase = env('OSRM_BASE', 'https://router.project-osrm.org');
  const day = departDay(localDay(new Date()));
  const run = {
    requests: 0, cut: false, tried: new Set<string>(),
    tomtom: (key ? 'unused' : 'no_key') as TomtomState, ttOn: !!key, osrm: 'unused' as OsrmState, osrmOn: true,
    stored: 0, planned: 0, kept: [] as { day: string; block: string }[], late: new Set<string>(), noRoad: 0, spent: null as Spend | null
  };
  const spentOf = (x: any): Spend | null => (x && typeof x.month === 'string' ? { month: x.month, tx: Number(x.tx) || 0, cap: Number(x.cap) || 0 } : null);
  /** less than `need` ms left of the call's time */
  const late = (need: number) => Date.now() - t0 > lim.ms - need;
  /** a request that takes up to `need` ms may not start: the request brake, or it could not end inside the call's time */
  const braked = (need: number) => run.requests >= lim.requests || late(need);
  const stopTomtom = (why: TomtomState) => { run.ttOn = false; if (run.tomtom === 'ok' || run.tomtom === 'unused') run.tomtom = why; };
  const wanted = async () => (await ask.rpc('drive_wanted', { p_point: ask.point, p_from: ask.from, p_days: ask.days })) || {};
  // the address's usual-hours trips first, then (unless `only`) everything else of those days
  let phase: 'point' | 'all' = ask.point ? 'point' : 'all';
  // without TomTom (no key, refused, busy, over budget): the usual hours from OSRM, but never a trip listed only because its
  // time IS OSRM's (drive_wanted's 'osrm': OSRM would answer the same)
  const osrmMay = (t: Trip) => t.slot === 0 && t.why !== 'osrm';
  const wants = (t: Trip, ph: 'point' | 'all') => !run.tried.has(t.id) && (run.ttOn || osrmMay(t))
    && (ph === 'all' && !ask.only ? true : t.extra && t.slot === 0);

  /** one round: TomTom for each slot (squares, then stars), OSRM for the usual-hours trips TomTom did not give. What a slot
      gave is stored as soon as that slot is measured (final-security F3: never paid, then lost with the call) */
  async function measureTrips(todo: Trip[], keep: (rows: Row[]) => Promise<void>): Promise<void> {
    let rows: Row[] = [];
    const toOsrm: { trip: Trip; noRoad: boolean; ttNo?: boolean }[] = [];
    for (const slot of [0, 1, 2] as Slot[]) {
      if (rows.length) { const r = rows; rows = []; await keep(r); }
      const list = todo.filter((t) => t.slot === slot);
      if (!list.length) continue;
      if (!run.ttOn) { toOsrm.push(...list.filter(osrmMay).map((trip) => ({ trip, noRoad: false }))); continue; }
      const failed = await pool(groupTomtom(list, lim.maxCells), lim.inFlight, async (g) => {
        const fallBack = () => { toOsrm.push(...g.cells.filter((c) => osrmMay(c.trip)).map((c) => ({ trip: c.trip, noRoad: false }))); };
        if (!run.ttOn) return fallBack();
        if (braked(ttMs)) { run.cut = true; return; }
        run.requests++;   // counted at once: the 5 requests in flight never all pass the brake together
        // the public page's own allowance, then the month's spend, both BEFORE the request: two calls at the same time
        // never pass the month's ceiling
        if (ask.gate && phase === 'point' && !(await ask.gate(g.cost))) { run.requests--; stopTomtom('over_budget'); return fallBack(); }
        const sp = await ask.rpc('drive_spend_add', { p_tx: g.cost });
        run.spent = spentOf(sp) || run.spent;
        if (!sp?.ok) { run.requests--; stopTomtom('over_budget'); return fallBack(); }
        for (const c of g.cells) run.tried.add(c.trip.id);
        const post = () => fetch(tomtomMatrixUrl(ttBase, key), { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(tomtomMatrixBody(g.origins, g.destinations, departAt(day, slot))), signal: AbortSignal.timeout(ttMs) });
        let cells: Map<string, MatrixCell>;
        try {
          let r = await post();
          // 429: too many requests at once for TomTom. Asked once more a moment later when the call has the time; TomTom
          // computed nothing for it, so its transactions (counted above) pay for the second one
          if (r.status === 429 && run.ttOn && !late(lim.retryMs + ttMs)) { await r.body?.cancel(); await sleep(lim.retryMs); r = await post(); }
          if (r.status === 401 || r.status === 403) { await r.body?.cancel(); stopTomtom('refused'); return fallBack(); }
          if (!r.ok) { await r.body?.cancel(); stopTomtom('busy'); return fallBack(); }   // 429 again, or TomTom in trouble: later
          cells = readTomtomMatrix(await r.json());
        } catch { stopTomtom('busy'); return fallBack(); }
        const lost: Trip[] = [];
        for (const c of g.cells) {
          const v = cells.get(`${c.o}:${c.d}`);
          if (v === 'no_road') {
            // usual hours: OSRM's second opinion (« no road » only when both say so). A rush hour: its usual-hours time
            // exists (drive_wanted asks a rush time only then), so the trip HAS a road: kept 7 days as « no rush time »
            // (drive_min then counts its usual hours; never asked again at every call), not a trip without a road
            if (slot === 0) toOsrm.push({ trip: c.trip, noRoad: true, ttNo: true }); else rows.push(rowOf(c.trip, null, 'none'));
          } else if (v) rows.push(rowOf(c.trip, v, 'tomtom'));
          else lost.push(c.trip);   // any other error of that cell: nothing kept, asked again by a later call
        }
        // most cells failed with TomTom's own trouble (it answers HTTP 200 all the same): as a 5xx, TomTom is « busy » for
        // this call and the usual-hours trips go to OSRM (never « ok » with nothing, paid again at every call)
        if (lost.length * 2 > g.cells.length) { stopTomtom('busy'); toOsrm.push(...lost.filter(osrmMay).map((trip) => ({ trip, noRoad: false }))); }
        else {
          if (run.tomtom === 'unused') run.tomtom = 'ok';
          // (final-money F4) a few cells TomTom could not answer, the rest fine: never paid again at every call — the usual
          // hours get OSRM's time (TomTom asked again after 7 days), a rush time is « none » for 7 days (its usual hours count)
          for (const t of lost) { if (slot === 0) toOsrm.push({ trip: t, noRoad: false, ttNo: true }); else rows.push(rowOf(t, null, 'none')); }
        }
      });
      if (failed) {
        // the database failed in the middle (the spend could not be counted): no more TomTom in this call; what came back
        // is stored below, and the call says « more »
        console.error('drive: measuring stopped', String((failed as Error)?.message || failed).slice(0, 200));
        run.ttOn = false;
        run.cut = true;
      }
    }
    // OSRM, one request at a time (a public server): the usual hours TomTom could not give, and a second opinion on « no road »
    for (const g of groupOsrm(toOsrm.map((x) => x.trip), lim.osrmPoints)) {
      if (!run.osrmOn) break;
      if (braked(osMs)) { run.cut = true; break; }
      run.requests++;
      for (const c of g.trips) run.tried.add(c.trip.id);
      let d: unknown;
      try {
        const r = await fetch(osrmTableUrl(osrmBase, g), { headers: { 'User-Agent': 'his-garage-app' }, signal: AbortSignal.timeout(osMs) });
        d = r.ok ? await r.json() : null;
        if (!r.ok || (d as { code?: string } | null)?.code !== 'Ok') throw new Error('osrm');
      } catch { run.osrm = 'down'; run.osrmOn = false; break; }
      if (run.osrm === 'unused') run.osrm = 'ok';
      const noRoad = new Set(toOsrm.filter((x) => x.noRoad).map((x) => x.trip.id));
      const ttNo = new Set(toOsrm.filter((x) => x.ttNo).map((x) => x.trip.id));
      for (const c of g.trips) {
        const v = readOsrmCell(d, c.s, c.d);
        if (v) rows.push(rowOf(c.trip, v, 'osrm', ttNo.has(c.trip.id)));
        // « no road » only when TomTom AND OSRM both say so; OSRM alone (TomTom not asked) proves nothing
        else if (noRoad.has(c.trip.id)) { rows.push(rowOf(c.trip, null, 'none')); run.noRoad++; }
      }
    }
    if (rows.length) await keep(rows);
  }

  // the leases: the address's own one for its round, the common one for the rest. An address that is already a place of
  // those days (drive_wanted's point_place: a booked stop, a truck's start) has trips the sweep lists too: its round takes
  // the common lease, so a warm and a sweep at the same time never ask them twice. A screen is waiting: it waits for a
  // sweep holding it at most shareWaitMs, then measures under its own lease as before (a long sweep may then ask some of
  // them too: rare, a booked address is measured right after its booking)
  let shared = false;
  let storeCalls = 0;
  const claimOf = (ph: 'point' | 'all') => (ph === 'point' && ask.point && !shared ? `drive:claim:pt:${placeKey(ask.point)}` : 'drive:claim:all');
  let held: string | null = null;
  /** holds the lease `k` (the one held before is given back), waiting for the call that has it while a request could still
      start; false: no time left */
  async function hold(k: string): Promise<boolean> {
    if (!ask.claims || held === k) return true;
    if (held) { const was = held; held = null; await ask.claims.drop(was); }
    for (;;) {
      if (await ask.claims.take(k, lim.leaseMs)) { held = k; return true; }
      if (braked(shortest + lim.waitMs)) return false;
      await sleep(lim.waitMs);
    }
  }
  const holding = () => !ask.claims || held === claimOf(phase);
  let w: any = {};
  const pick = (): Trip[] => {
    let todo = tripsOf(w).filter((t) => wants(t, phase));
    if (!todo.length && phase === 'point' && !ask.only) { phase = 'all'; todo = tripsOf(w).filter((t) => wants(t, phase)); }
    // (final-money F1) at most roundTrips a round, in drive_wanted's order (the address first): the next round takes the rest
    return todo.slice(0, Math.max(1, lim.roundTrips));
  };
  /** drive_store of what a slot gave (final-money F5): asked once more when it fails (a lock, a statement too long), so what
      was paid is not lost; when its re-plan failed (the rows are kept), the re-plan is asked once more. `days`: the days to
      plan again, named on the first store of a round only */
  let days: unknown = null;
  async function keep(rows: Row[]) {
    const args = { p_rows: rows, p_days: days };
    days = null;
    let r: any;
    try { r = await ask.rpc('drive_store', args); } catch (e) {
      console.error('drive: storing failed, once more', String((e as Error)?.message || e).slice(0, 200));
      await sleep(lim.waitMs);
      r = await ask.rpc('drive_store', args);
    }
    run.stored += Number(r?.stored) || 0;
    const reps = [r];
    if (Array.isArray(r?.replan) && r.replan.length) {
      try { reps.push(await ask.rpc('roads_replan', { p_days: r.replan })); } catch (e) {
        console.error('drive: planning again failed', String((e as Error)?.message || e).slice(0, 200));
      }
    }
    for (const x of reps) {
      run.planned += Number(x?.planned) || 0;
      for (const k of Array.isArray(x?.kept) ? x.kept : []) if (!run.kept.some((y) => y.day === k.day && y.block === k.block)) run.kept.push({ day: String(k.day), block: String(k.block) });
      for (const id of Array.isArray(x?.late) ? x.late : []) run.late.add(String(id));
    }
  }
  try {
    // the lease first, then what is missing: what another call stored meanwhile is not asked again
    if (!(await hold(claimOf(phase)))) run.cut = true;
    w = await wanted();
    if (!run.cut && ask.claims && phase === 'point' && w.point_place === true && tripsOf(w).some((t) => wants(t, 'point'))) {
      // its trips are the sweep's too: the common lease (its own kept meanwhile), a short while at most; then read again
      const t0w = Date.now();
      for (;;) {
        if (await ask.claims.take('drive:claim:all', lim.leaseMs)) {
          const was = held; held = 'drive:claim:all'; shared = true;
          if (was) await ask.claims.drop(was).catch(() => { /* its lease ends by itself */ });
          break;
        }
        if (Date.now() - t0w >= lim.shareWaitMs || braked(shortest + lim.waitMs)) break;
        await sleep(lim.waitMs);
      }
      w = await wanted();
    }
    for (let round = 0; round < lim.rounds && !run.cut; round++) {
      let todo = pick();
      // the address's trips are done: the rest of those days, under their own lease
      while (todo.length && !holding()) {
        if (!(await hold(claimOf(phase)))) { run.cut = true; break; }
        w = await wanted();
        todo = pick();
      }
      if (run.cut || !todo.length) break;
      if (braked(shortest)) { run.cut = true; break; }
      if (round === lim.rounds - 1) run.cut = true;   // the last round: what is left waits for the next call (`more`)
      const pointRound = phase === 'point';
      // the address's round names no day (its trips plan again only the days where it is booked: drive_store's rule);
      // the others name the days whose plans were made without a trip measured now
      days = pointRound ? null : (Array.isArray(w.days) && w.days.length ? w.days : null);
      const stored0 = run.stored, calls0 = storeCalls;
      await measureTrips(todo, async (rows) => { storeCalls++; await keep(rows); });
      if (storeCalls > calls0 || run.stored > stored0) w = await wanted();
    }
  } finally {
    if (held && ask.claims) { const was = held; held = null; await ask.claims.drop(was).catch(() => { /* its lease ends by itself */ }); }
  }
  const all = tripsOf(w);
  const spent = spentOf(await ask.rpc('drive_spend_add', { p_tx: 0 })) || run.spent;
  return {
    ok: true,
    // no usual-hours trip missing for what was asked: the address's trips, or every trip of those days (a trip listed only
    // to make its time better, OSRM's or an old one, has a time the planner uses: not missing)
    ready: !all.some((t) => t.slot === 0 && (!ask.point || t.extra) && !hasTime(t)),
    left: Number(w.total) || 0, left0: Number(w.total0) || 0,
    stored: run.stored, planned: run.planned, kept: run.kept, late: [...run.late], no_road: run.noRoad,
    tomtom: run.tomtom, osrm: run.osrm, spent,
    // a brake stopped the call while trips that can be measured now were still there: call again
    more: run.cut && all.some((t) => wants(t, ask.point && ask.only ? 'point' : 'all'))
  };
}

/** « warm »: an address's trips for those days (`only`: its usual-hours trips alone, the screen is waiting). The address
    must be a position within REACH_KM of « Départ des camions » (a brake on random points, not a time) */
export async function warmPoint(rpc: Rpc, point: RoadPt, from: string | null, days: number, only: boolean, limits?: Partial<typeof LIMITS>,
  o: Pick<MeasureAsk, 'claims' | 'gate'> = {}): Promise<Measured> {
  const home = ((await rpc('home_point', {})) || [])[0] as RoadPt | undefined;
  const km = home ? Number(await rpc('km_between', { lat1: home.lat, lng1: home.lng, lat2: point.lat, lng2: point.lng })) : NaN;
  if (!(km <= REACH_KM)) fail('far', `Cette adresse est à plus de ${REACH_KM} km du départ des camions.`);
  return measureRoads({ point, from, days: Math.max(1, Math.min(14, Math.floor(days) || 14)), only, rpc, limits, claims: o.claims, gate: o.gate });
}
