/* The truck's day on the map by the streets, not as the crow flies: the route through the Centrale and the stops (in the
   planned order) from OSRM, the free route planner of OpenStreetMap (the same one that times « Je pars »); when it does not
   answer, the same planner run by OpenStreetMap Germany (FOSSGIS). One request per truck; each leg is kept in memory, so the
   map's refresh every minute asks nothing again. A route neither answered is asked again a minute later (not 5).
   Robust on purpose, both planners are free services with no promise:
   - two stops at the same place (two cars of one customer) are asked once: a leg of no length never spoils the route;
   - a route the planner refuses for good (no road, a bad request, too many stops) is never asked again;
   - a planner that did not answer is skipped until the next round, so each truck's route does not wait for it first;
   - the same route asked by two maps at once is one request;
   - the memory keeps the last few hundred legs, not every leg seen since the app opened. */
export type LatLng = [number, number];
export const OSRM = 'https://router.project-osrm.org';
export const OSRM_BACKUP = 'https://routing.openstreetmap.de/routed-car';
const PLANNERS = [OSRM, OSRM_BACKUP];
const RETRY_MS = 60 * 1000;
/** a planner that timed out or could not be reached is left alone that long (less than RETRY_MS: the next round asks it again) */
const REST_MS = 50 * 1000;
const MAX_POINTS = 25;
const MAX_LEGS = 1500;
const MAX_ROUTES = 400;

const k = (p: LatLng) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
export const legKey = (a: LatLng, b: LatLng) => `${k(a)}>${k(b)}`;
const legs = new Map<string, LatLng[]>();
const totals = new Map<string, { km: number; minutes: number }>();
const failedAt = new Map<string, number>();
/** routes a planner answered « no » to (no road, bad request): asking again would give the same answer */
const refused = new Set<string>();
const resting = new Map<string, number>();
const inFlight = new Map<string, Promise<Route | null>>();
const routeKey = (pts: LatLng[]) => pts.map(k).join('|');

interface Route { legs: LatLng[][]; km: number; minutes: number }

/** keeps a Map to its last `max` entries (a Map remembers the order things were put in) */
function remember<V>(m: Map<string, V>, key: string, v: V, max: number) {
  m.delete(key);
  m.set(key, v);
  while (m.size > max) m.delete(m.keys().next().value as string);
}

/** the road between two points, when already known */
export function knownLeg(a: LatLng, b: LatLng): LatLng[] | null { return legs.get(legKey(a, b)) || null; }
/** the length and time of the whole route, when already known */
export function knownTotal(pts: LatLng[]): { km: number; minutes: number } | null { return totals.get(routeKey(pts)) || null; }
/** every leg of the route is known */
export function allKnown(pts: LatLng[]): boolean { return pts.length < 2 || pts.slice(1).every((p, i) => legs.has(legKey(pts[i], p))); }
/** the planners will never draw this route (too many stops, or refused for good): the straight lines stay, nobody asks again */
export function neverRouted(pts: LatLng[]): boolean { return pts.length > MAX_POINTS || refused.has(routeKey(pts)); }

/** the points without a stop repeated at the same place right after itself (what the planner is asked) */
export function distinctStops(pts: LatLng[]): LatLng[] {
  return pts.filter((p, i) => i === 0 || k(p) !== k(pts[i - 1]));
}

interface OsrmStep { geometry?: { coordinates?: [number, number][] } }
interface OsrmLeg { steps?: OsrmStep[]; distance?: number; duration?: number }
/** reads OSRM's answer: one line of points per leg ([lat, lng]), the km and the minutes (with a little margin for traffic).
    A leg may have fewer than 2 points of its own (two stops on the same street corner): its ends are added by the caller. */
export function parseOsrm(j: unknown, n: number): Route | null {
  const route = (j as { code?: string; routes?: { legs?: OsrmLeg[]; distance?: number; duration?: number }[] } | null);
  if (!route || route.code !== 'Ok' || !route.routes?.[0]?.legs || route.routes[0].legs.length !== n - 1) return null;
  const r = route.routes[0];
  const out: LatLng[][] = r.legs!.map((leg) => {
    const pts: LatLng[] = [];
    for (const st of leg.steps || []) {
      for (const c of st.geometry?.coordinates || []) {
        const p: LatLng = [Number(c[1]), Number(c[0])];
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const last = pts[pts.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
      }
    }
    return pts;
  });
  return { legs: out, km: Math.round((Number(r.distance) || 0) / 100) / 10, minutes: Math.max(1, Math.round(((Number(r.duration) || 0) / 60) * 1.2)) };
}

/** asks the road route through these points (in order) and keeps it; null when the planner does not answer (or never will:
    see neverRouted) */
export async function routeThrough(pts: LatLng[], fetchImpl: typeof fetch = fetch, timeoutMs = 12000): Promise<Route | null> {
  if (pts.length < 2 || neverRouted(pts)) return null;
  const rk = routeKey(pts);
  if (allKnown(pts) && totals.has(rk)) return { legs: pts.slice(1).map((p, i) => legs.get(legKey(pts[i], p))!), ...totals.get(rk)! };
  // a planner that did not answer is asked again only after a while
  if (Date.now() - (failedAt.get(rk) || 0) < RETRY_MS) return null;
  const pending = inFlight.get(rk);
  if (pending) return pending;
  const asked = ask(pts, rk, fetchImpl, timeoutMs).finally(() => inFlight.delete(rk));
  inFlight.set(rk, asked);
  return asked;
}

async function ask(pts: LatLng[], rk: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Route | null> {
  const stops = distinctStops(pts);
  if (stops.length < 2) {
    // every point at the same place: nothing to drive
    pts.slice(1).forEach((p, i) => remember(legs, legKey(pts[i], p), [pts[i], p], MAX_LEGS));
    remember(totals, rk, { km: 0, minutes: 0 }, MAX_ROUTES);
    return { legs: pts.slice(1).map(() => []), km: 0, minutes: 0 };
  }
  const coords = stops.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
  let saidNo = 0, other = 0;
  for (const base of PLANNERS) {
    if (Date.now() < (resting.get(base) || 0)) { other++; continue; }
    const r = await askPlanner(`${base}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`, stops.length, fetchImpl, timeoutMs);
    if (r.kind === 'down') { resting.set(base, Date.now() + REST_MS); other++; continue; }
    if (r.kind === 'busy') { other++; continue; }
    if (r.kind === 'refused') { saidNo++; continue; }
    // back to the points asked for: a stop repeated at the same place gets a leg of no length
    const byStop = r.route.legs;
    const full: LatLng[][] = [];
    let s = 0;
    pts.slice(1).forEach((p, i) => {
      if (k(p) === k(pts[i])) { full.push([]); return; }
      full.push(byStop[s++] || []);
    });
    full.forEach((line, i) => {
      // the route starts and ends exactly on the stops (the road snaps to the nearest street)
      remember(legs, legKey(pts[i], pts[i + 1]), [pts[i], ...line, pts[i + 1]], MAX_LEGS);
    });
    remember(totals, rk, { km: r.route.km, minutes: r.route.minutes }, MAX_ROUTES);
    return { ...r.route, legs: full };
  }
  // every planner said « no » for good: never asked again; one was busy or silent: again in a minute
  if (saidNo > 0 && other === 0) refused.add(rk);
  else remember(failedAt, rk, Date.now(), MAX_ROUTES);
  return null;
}

type Answer = { kind: 'ok'; route: Route } | { kind: 'refused' } | { kind: 'busy' } | { kind: 'down' };
async function askPlanner(url: string, n: number, fetchImpl: typeof fetch, timeoutMs: number): Promise<Answer> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
    // 400: the request itself is wrong for this planner (too many points, a place in the sea); 429 / 5xx: busy for now
    if (res.status === 400) return { kind: 'refused' };
    if (!res.ok) return { kind: 'busy' };
    const body: unknown = await res.json();
    const route = parseOsrm(body, n);
    if (route) return { kind: 'ok', route };
    const code = (body as { code?: string } | null)?.code;
    return code === 'NoRoute' || code === 'NoSegment' || code === 'InvalidQuery' || code === 'InvalidValue' ? { kind: 'refused' } : { kind: 'busy' };
  } catch {
    // no answer in time, or no network: this planner rests a little
    return { kind: 'down' };
  } finally {
    clearTimeout(timer);
  }
}
/** forgets everything (tests) */
export function forgetRoads() { legs.clear(); totals.clear(); failedAt.clear(); refused.clear(); resting.clear(); inFlight.clear(); }
