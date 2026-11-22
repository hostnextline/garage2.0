/* The truck's day on the map by the streets, not as the crow flies: the route through the Centrale and the stops (in the
   planned order) from TomTom when the app has its key (config.ts), else, or when TomTom does not answer, from OSRM, the
   free route planner of OpenStreetMap; when that does not answer either, the same planner run by OpenStreetMap Germany
   (FOSSGIS). One request per truck; each leg is kept in memory, so the map's refresh every minute asks nothing again. A
   route none answered is asked again a minute later. Until then NOTHING is drawn (Hassan's rule, 2026-11-19: a road is a
   real road or it is not shown): no straight line between two stops, and no straight piece from a stop to the street
   either (a leg is the planner's own line, from the street in front of one stop to the street in front of the next).
   Which day: today's routes are asked « now » (the traffic of this minute); another day's for the usual hours of that day
   (departOf: 11 h 30, TomTom's usual traffic of that weekday). The two are kept apart in memory (today's under its date:
   a map left open over midnight asks again), and every total says which planner measured it: two totals are subtracted
   only when the same planner measured both (addedTotal).
   Robust on purpose (the free planners are services with no promise, and a paid one may be over its day's quota):
   - two stops at the same place (two cars of one customer) are asked once: a leg of no length never spoils the route;
   - a route a planner refuses for good (no road, a bad request, too many stops) is never asked to that planner again;
   - a planner that did not answer is skipped until the next round, so each truck's route does not wait for it first;
   - the same route asked by two maps at once is one request;
   - a live trip without the server's road is asked at most once a minute for the same stop (routeTrip), whatever the
     person's moves: each TomTom answer is billed;
   - the memory keeps the last few hundred legs, not every leg seen since the app opened. */
import { TOMTOM_KEY } from '../../lib/config';
import { today as todayOf, addDays, daysBetween, isValidDay, type Day } from '../../lib/dates';
import { tomtomRouteUrl, parseTomtomRoute, tomtomRefused } from '../../lib/tomtom';

export type LatLng = [number, number];
export const OSRM = 'https://router.project-osrm.org';
export const OSRM_BACKUP = 'https://routing.openstreetmap.de/routed-car';
export const TOMTOM = 'tomtom';

/** who measured a route: TomTom (its own time, with the traffic of the moment asked) or OSRM (the free planner's time
    + 20 %; its two servers run the same planner on the same map, so their totals can be compared) */
export type PlannerKind = 'tomtom' | 'osrm';
/** a route's length and time; `planner` 'none' = nothing to drive (every point at the same place: 0 km for anyone) */
export interface RoadTotal { km: number; minutes: number; planner: PlannerKind | 'none' }
export interface Route extends RoadTotal { legs: LatLng[][] }

/** one route planner: where to ask, how to read its answer, when its « no » is for good */
interface Planner { id: string; kind: PlannerKind; url: (stops: LatLng[], depart: string) => string; read: (body: unknown, n: number) => { legs: LatLng[][]; km: number; minutes: number } | null; saysNo: (status: number, body: unknown) => boolean }
const osrmPlanner = (base: string): Planner => ({
  id: base,
  kind: 'osrm',
  // OSRM knows no traffic: the same road whatever the day
  url: (stops) => `${base}/route/v1/driving/${stops.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';')}?overview=false&steps=true&geometries=geojson`,
  read: parseOsrm,
  // 400: the request itself is wrong for this planner (too many points, a place in the sea)
  saysNo: (status, body) => {
    if (status === 400) return true;
    const code = (body as { code?: string } | null)?.code;
    return code === 'NoRoute' || code === 'NoSegment' || code === 'InvalidQuery' || code === 'InvalidValue';
  }
});
/** the planners asked, in order: TomTom first when the app has its key */
export function plannersFor(key: string): Planner[] {
  const free = [osrmPlanner(OSRM), osrmPlanner(OSRM_BACKUP)];
  if (!key) return free;
  return [{ id: TOMTOM, kind: 'tomtom', url: (stops, depart) => tomtomRouteUrl(stops, key, depart), read: parseTomtomRoute, saysNo: tomtomRefused }, ...free];
}

/** the usual hours of a day that is not today (TomTom's usual traffic then; no offset = Montréal's time) */
export const USUAL_TIME = '11:30:00';
/** the moment a day's routes are asked for: today « now »; another day its usual hours. A day already gone is asked for
    the same weekday of the coming week (TomTom times a moment to come, never one past; OSRM ignores the moment). */
export function departOf(day?: Day | null, now: Day = todayOf()): string {
  if (!day || !isValidDay(day) || day === now) return 'now';
  const gone = daysBetween(day, now);
  const d = gone > 0 ? addDays(day, (Math.floor(gone / 7) + 1) * 7) : day;
  return `${d}T${USUAL_TIME}`;
}

/** where a day's routes are kept in memory: the moment asked, and for today « now » with its date (yesterday evening's
    traffic is not this morning's; within the day the first answer is kept, nothing more is billed) */
function memoOf(day?: Day | null): { depart: string; memo: string } {
  const now = todayOf();
  const depart = departOf(day, now);
  return { depart, memo: depart === 'now' ? `now@${now}` : depart };
}

const RETRY_MS = 60 * 1000;
/** a planner that timed out or could not be reached is left alone that long (less than RETRY_MS: the next round asks it again) */
const REST_MS = 50 * 1000;
/** a live trip without the server's road: asked at most this often for the same stop */
export const TRIP_EVERY_MS = 60 * 1000;
/** the road found a moment ago for a live trip is still drawn while the person is this close to it (he drives along it) */
const TRIP_NEAR_M = 400;
const MAX_POINTS = 25;
const MAX_LEGS = 1500;
const MAX_ROUTES = 400;

const k = (p: LatLng) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const legKey = (a: LatLng, b: LatLng, depart: string) => `${depart}#${k(a)}>${k(b)}`;
const routeKey = (pts: LatLng[], depart: string) => `${depart}#${pts.map(k).join('|')}`;
const legs = new Map<string, LatLng[]>();
const totals = new Map<string, RoadTotal>();
const failedAt = new Map<string, number>();
/** routes every planner answered « no » to (no road, bad request): asking again would give the same answer */
const refused = new Set<string>();
/** `planner@route`: that planner said « no » for good to that route: it is not asked again (the next one is) */
const saidNoBy = new Map<string, true>();
const resting = new Map<string, number>();
const inFlight = new Map<string, Promise<Route | null>>();
/** a live trip's stop → when its road was last asked, and the last road found to it */
const tripAsked = new Map<string, number>();
const tripRoads = new Map<string, LatLng[]>();
const tripCut = new Map<string, { from: string; line: LatLng[] }>();

/** keeps a Map to its last `max` entries (a Map remembers the order things were put in) */
function remember<V>(m: Map<string, V>, key: string, v: V, max: number) {
  m.delete(key);
  m.set(key, v);
  while (m.size > max) m.delete(m.keys().next().value as string);
}

/** the road between two points, when already known ([] = known, nothing to draw: two stops at the same place) */
export function knownLeg(a: LatLng, b: LatLng, day?: Day | null): LatLng[] | null { return legs.get(legKey(a, b, memoOf(day).memo)) || null; }
/** the length and time of the whole route, and who measured it, when already known */
export function knownTotal(pts: LatLng[], day?: Day | null): RoadTotal | null { return totals.get(routeKey(pts, memoOf(day).memo)) || null; }
/** every leg of the route is known */
export function allKnown(pts: LatLng[], day?: Day | null): boolean {
  const d = memoOf(day).memo;
  return pts.length < 2 || pts.slice(1).every((p, i) => legs.has(legKey(pts[i], p, d)));
}
/** the planners will never draw this route (too many stops, or refused for good): nothing is drawn, nobody asks again */
export function neverRouted(pts: LatLng[], day?: Day | null): boolean { return pts.length > MAX_POINTS || refused.has(routeKey(pts, memoOf(day).memo)); }
/** the last round found no planner to answer this route (it is asked again a minute later) */
export function routeFailed(pts: LatLng[], day?: Day | null): boolean { return failedAt.has(routeKey(pts, memoOf(day).memo)); }

/** the same planner measured both totals (or one has nothing to drive): only then may they be compared or subtracted */
export function sameMeasure(a: RoadTotal | null | undefined, b: RoadTotal | null | undefined): boolean {
  return !!a && !!b && (a.planner === b.planner || a.planner === 'none' || b.planner === 'none');
}
/** what route A adds over route B (A with a new stop, B without it): null unless the same planner measured both */
export function addedTotal(a: RoadTotal | null | undefined, b: RoadTotal | null | undefined): RoadTotal | null {
  if (!a || !b || !sameMeasure(a, b)) return null;
  return { km: Math.max(0, Math.round((a.km - b.km) * 10) / 10), minutes: Math.max(0, a.minutes - b.minutes), planner: a.planner === 'none' ? b.planner : a.planner };
}
/** a route with nothing to drive (a day with no other stop): 0 km, 0 min, comparable with any planner */
export const NOTHING: RoadTotal = { km: 0, minutes: 0, planner: 'none' };

/** the points without a stop repeated at the same place right after itself (what the planner is asked) */
function distinctStops(pts: LatLng[]): LatLng[] {
  return pts.filter((p, i) => i === 0 || k(p) !== k(pts[i - 1]));
}

interface OsrmStep { geometry?: { coordinates?: [number, number][] } }
interface OsrmLeg { steps?: OsrmStep[]; distance?: number; duration?: number }
/** reads OSRM's answer: one line of points per leg ([lat, lng]), the km and the minutes (with a little margin for traffic).
    A leg may have a single point of its own (two stops on the same street corner): nothing is drawn for it. A leg with no
    point at all is not an answer (it would be a straight line): null, the next planner is asked. */
export function parseOsrm(j: unknown, n: number): { legs: LatLng[][]; km: number; minutes: number } | null {
  const route = (j as { code?: string; routes?: { legs?: OsrmLeg[]; distance?: number; duration?: number }[] } | null);
  if (!route || route.code !== 'Ok' || !route.routes?.[0]?.legs || route.routes[0].legs.length !== n - 1) return null;
  const r = route.routes[0];
  const out: LatLng[][] = r.legs!.map((leg) => {
    const pts: LatLng[] = [];
    for (const st of leg?.steps || []) {
      for (const c of st?.geometry?.coordinates || []) {
        const p: LatLng = [Number(c?.[1]), Number(c?.[0])];
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const last = pts[pts.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
      }
    }
    return pts;
  });
  if (out.some((l) => l.length === 0)) return null;
  return { legs: out, km: Math.round((Number(r.distance) || 0) / 100) / 10, minutes: Math.max(1, Math.round(((Number(r.duration) || 0) / 60) * 1.2)) };
}

/** asks the road route through these points (in order) for that day (today when none) and keeps it; null when no planner
    answers (or never will: see neverRouted) */
export async function routeThrough(pts: LatLng[], fetchImpl: typeof fetch = fetch, timeoutMs = 12000, key: string = TOMTOM_KEY, day?: Day | null): Promise<Route | null> {
  if (pts.length < 2 || neverRouted(pts, day)) return null;
  const { depart, memo } = memoOf(day);
  const rk = routeKey(pts, memo);
  if (allKnown(pts, day) && totals.has(rk)) return { legs: pts.slice(1).map((p, i) => legs.get(legKey(pts[i], p, memo))!), ...totals.get(rk)! };
  // a planner that did not answer is asked again only after a while
  if (Date.now() - (failedAt.get(rk) || 0) < RETRY_MS) return null;
  const pending = inFlight.get(rk);
  if (pending) return pending;
  const asked = ask(pts, rk, depart, memo, fetchImpl, timeoutMs, plannersFor(key)).finally(() => inFlight.delete(rk));
  inFlight.set(rk, asked);
  return asked;
}

async function ask(pts: LatLng[], rk: string, depart: string, memo: string, fetchImpl: typeof fetch, timeoutMs: number, planners: Planner[]): Promise<Route | null> {
  const stops = distinctStops(pts);
  if (stops.length < 2) {
    // every point at the same place: nothing to drive, nothing to draw
    pts.slice(1).forEach((p, i) => remember(legs, legKey(pts[i], p, memo), [], MAX_LEGS));
    remember(totals, rk, NOTHING, MAX_ROUTES);
    return { legs: pts.slice(1).map(() => []), ...NOTHING };
  }
  let saidNo = 0, other = 0;
  for (const planner of planners) {
    const mine = `${planner.id}@${rk}`;
    if (saidNoBy.has(mine)) { saidNo++; continue; }
    if (Date.now() < (resting.get(planner.id) || 0)) { other++; continue; }
    const r = await askPlanner(planner, stops, depart, fetchImpl, timeoutMs);
    if (r.kind === 'down') { resting.set(planner.id, Date.now() + REST_MS); other++; continue; }
    if (r.kind === 'busy') { other++; continue; }
    if (r.kind === 'refused') { remember(saidNoBy, mine, true, MAX_ROUTES * 3); saidNo++; continue; }
    // back to the points asked for: a stop repeated at the same place gets a leg of no length
    const byStop = r.route.legs;
    const full: LatLng[][] = [];
    let s = 0;
    pts.slice(1).forEach((p, i) => {
      if (k(p) === k(pts[i])) { full.push([]); return; }
      const line = byStop[s++] || [];
      // the planner's own line only (from the street in front of a stop to the street in front of the next): never a
      // straight piece added to reach the door; a leg of a single point (side by side) draws nothing
      full.push(line.length >= 2 ? line : []);
    });
    full.forEach((line, i) => remember(legs, legKey(pts[i], pts[i + 1], memo), line, MAX_LEGS));
    const total: RoadTotal = { km: r.route.km, minutes: r.route.minutes, planner: planner.kind };
    remember(totals, rk, total, MAX_ROUTES);
    failedAt.delete(rk);
    return { ...total, legs: full };
  }
  // every planner said « no » for good: never asked again; one was busy or silent: again in a minute
  if (saidNo > 0 && other === 0) refused.add(rk);
  else remember(failedAt, rk, Date.now(), MAX_ROUTES);
  return null;
}

type Answer = { kind: 'ok'; route: { legs: LatLng[][]; km: number; minutes: number } } | { kind: 'refused' } | { kind: 'busy' } | { kind: 'down' };
async function askPlanner(planner: Planner, stops: LatLng[], depart: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Answer> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    // the page's own address goes with the question (TomTom answers its key only for the app's addresses)
    const res = await fetchImpl(planner.url(stops, depart), { ...(ctl ? { signal: ctl.signal } : {}), referrerPolicy: 'strict-origin-when-cross-origin' });
    const body: unknown = await res.json().catch(() => null);
    if (planner.saysNo(res.status, body)) return { kind: 'refused' };
    // a key refused or badly written (400 / 401 / 403) or the day's quota used up (429 at TomTom): that planner rests,
    // the next one answers
    if (res.status === 401 || res.status === 403 || (planner.id === TOMTOM && (res.status === 429 || res.status === 400))) return { kind: 'down' };
    // 429 / 5xx: busy for now
    if (!res.ok) return { kind: 'busy' };
    // an answer that is not a route (an error written in a 200, legs missing or without points): the next planner
    const route = planner.read(body, stops.length);
    return route ? { kind: 'ok', route } : { kind: 'busy' };
  } catch {
    // no answer in time, or no network: this planner rests a little
    return { kind: 'down' };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- a live trip without the server's road ---------- */
/** the live trip to this stop may be asked now (not asked in the last minute) */
export function tripDue(to: LatLng, now: number = Date.now()): boolean { return now - (tripAsked.get(k(to)) || 0) >= TRIP_EVERY_MS; }
/** the road of a live trip the server gave none for (the person → the stop), today's traffic: asked at most once a minute
    for the same stop, whatever the person's moves (each TomTom answer is billed); null when not asked now or nobody
    answered. A trip whose road the server gave is never asked: the map draws the server's road (useRoads). */
export async function routeTrip(from: LatLng, to: LatLng, fetchImpl: typeof fetch = fetch, timeoutMs = 12000, key: string = TOMTOM_KEY): Promise<Route | null> {
  const pts: LatLng[] = [from, to];
  const known = knownTotal(pts);
  if (known && allKnown(pts)) return { ...known, legs: [knownLeg(from, to) || []] };
  if (!tripDue(to)) return null;
  remember(tripAsked, k(to), Date.now(), MAX_ROUTES);
  const r = await routeThrough(pts, fetchImpl, timeoutMs, key);
  if (r && r.legs[0] && r.legs[0].length >= 2) { remember(tripRoads, k(to), r.legs[0], MAX_ROUTES); tripCut.delete(k(to)); }
  return r;
}
/** metres between two points, flat earth: only to say whether the person is still on the road found a moment ago (never
    a drive time or a distance shown) */
function metres(a: LatLng, b: LatLng): number {
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  const y = b[0] - a[0];
  return Math.sqrt(x * x + y * y) * 111320;
}
/** the road drawn for a live trip without the server's road: the road from where the person is now when known; else the
    road found a moment ago for this stop, from its point nearest to the person (he drives along it), while he is still
    near it; else nothing (never a straight line) */
export function tripRoad(from: LatLng, to: LatLng): LatLng[] {
  const exact = knownLeg(from, to);
  if (exact) return exact;
  const dk = k(to);
  const last = tripRoads.get(dk);
  if (!last) return [];
  const cut = tripCut.get(dk);
  if (cut && cut.from === k(from)) return cut.line;
  let best = -1, bestM = Infinity;
  last.forEach((p, i) => { const m = metres(p, from); if (m < bestM) { bestM = m; best = i; } });
  const line = bestM <= TRIP_NEAR_M && best < last.length - 1 ? last.slice(best) : [];
  remember(tripCut, dk, { from: k(from), line }, MAX_ROUTES);
  return line;
}

/** forgets everything (tests, sign-out) */
export function forgetRoads() {
  legs.clear(); totals.clear(); failedAt.clear(); refused.clear(); saidNoBy.clear(); resting.clear(); inFlight.clear();
  tripAsked.clear(); tripRoads.clear(); tripCut.clear();
}
