/* The truck's day on the map by the streets, not as the crow flies: the route through the Centrale and the stops (in the
   planned order) from OSRM, the free route planner of OpenStreetMap (the same one that times « Je pars »).
   One request per truck; each leg is kept in memory, so the map's refresh every minute asks nothing again. */
export type LatLng = [number, number];
export const OSRM = 'https://router.project-osrm.org';

const k = (p: LatLng) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
export const legKey = (a: LatLng, b: LatLng) => `${k(a)}>${k(b)}`;
const legs = new Map<string, LatLng[]>();
const totals = new Map<string, { km: number; minutes: number }>();
const failedAt = new Map<string, number>();
const routeKey = (pts: LatLng[]) => pts.map(k).join('|');

/** the road between two points, when already known */
export function knownLeg(a: LatLng, b: LatLng): LatLng[] | null { return legs.get(legKey(a, b)) || null; }
/** the length and time of the whole route, when already known */
export function knownTotal(pts: LatLng[]): { km: number; minutes: number } | null { return totals.get(routeKey(pts)) || null; }
/** every leg of the route is known */
export function allKnown(pts: LatLng[]): boolean { return pts.length < 2 || pts.slice(1).every((p, i) => legs.has(legKey(pts[i], p))); }

interface OsrmStep { geometry?: { coordinates?: [number, number][] } }
interface OsrmLeg { steps?: OsrmStep[]; distance?: number; duration?: number }
/** reads OSRM's answer: one line of points per leg ([lat, lng]), the km and the minutes (with a little margin for traffic) */
export function parseOsrm(j: unknown, n: number): { legs: LatLng[][]; km: number; minutes: number } | null {
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
  if (out.some((l) => l.length < 2)) return null;
  return { legs: out, km: Math.round((Number(r.distance) || 0) / 100) / 10, minutes: Math.max(1, Math.round(((Number(r.duration) || 0) / 60) * 1.2)) };
}

/** asks the road route through these points (in order) and keeps it; null when the planner does not answer */
export async function routeThrough(pts: LatLng[], fetchImpl: typeof fetch = fetch, timeoutMs = 12000): Promise<{ legs: LatLng[][]; km: number; minutes: number } | null> {
  if (pts.length < 2 || pts.length > 25) return null;
  const rk = routeKey(pts);
  if (allKnown(pts) && totals.has(rk)) return { legs: pts.slice(1).map((p, i) => legs.get(legKey(pts[i], p))!), ...totals.get(rk)! };
  // a planner that did not answer is asked again only after a while
  if (Date.now() - (failedAt.get(rk) || 0) < 5 * 60 * 1000) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const coords = pts.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
    const res = await fetchImpl(`${OSRM}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`, ctl ? { signal: ctl.signal } : undefined);
    const r = res.ok ? parseOsrm(await res.json(), pts.length) : null;
    if (!r) { failedAt.set(rk, Date.now()); return null; }
    r.legs.forEach((line, i) => {
      // the route starts and ends exactly on the stops (the road snaps to the nearest street)
      legs.set(legKey(pts[i], pts[i + 1]), [pts[i], ...line, pts[i + 1]]);
    });
    totals.set(rk, { km: r.km, minutes: r.minutes });
    return r;
  } catch {
    failedAt.set(rk, Date.now());
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** forgets everything (tests) */
export function forgetRoads() { legs.clear(); totals.clear(); failedAt.clear(); }
