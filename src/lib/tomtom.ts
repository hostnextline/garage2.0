/* TomTom (the garage's paid map service): the map tiles, the road routes with traffic and the address search.
   Used only when the app has a key (`TOMTOM_KEY` in config.ts); without one, and whenever TomTom does not answer, the
   app keeps the free OpenStreetMap services it used before (tiles, OSRM, Photon): a real road and a real address either
   way, never a guess. Pure: no network here, only the addresses to ask and the reading of the answers (tested in
   tomtom.test.ts); the one request of checkTile goes through the fetch its caller hands it. */

export const TOMTOM_API = 'https://api.tomtom.com';
/** near Montréal first */
export const NEAR = { lat: 45.5, lng: -73.65 };

/* ---------- the map ---------- */
/** OpenStreetMap's credit: under its own tiles, and beside TomTom's (the roads drawn may come from OSRM and the addresses
    from Photon, both made from OpenStreetMap's data) */
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
/** the map tiles (Leaflet's tileLayer): TomTom's plain day map */
export function tomtomTiles(key: string): { url: string; attribution: string } {
  return {
    url: `${TOMTOM_API}/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256`,
    attribution: `© <a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>, ${OSM_ATTRIBUTION}`
  };
}

/* TomTom's tiles refused (a key refused, the site missing from the key's list, the month's tiles used up): the map changes
   to OpenStreetMap's tiles, never stays blank. Not decided by counting tile errors (a small map of the phone shows only 4
   tiles; a tile the phone kept in its cache loads even when TomTom refuses everything else) nor by `navigator.onLine` (a
   tunnel or a Wi-Fi asking to sign in stays « online »): a tile fails → ONE plain request of that very tile (never in the
   cache, since it failed), and TomTom's own answer decides (review-maps H1, M1, L1). */
/** what TomTom's answer to that request says: it refuses (400 a key badly written, 401 / 403 a key refused, the site not in
    its list or the month's tiles used up, 429 too many) or cannot serve its tiles (5xx) → 'refused'; any other answer: it
    serves them (that tile failed for a passing reason) → 'ok'. 'network': no answer at all. */
export type TileCheck = 'ok' | 'refused' | 'network';
export function tileCheckOf(status: number): TileCheck {
  return status === 400 || status === 401 || status === 403 || status === 429 || status >= 500 ? 'refused' : 'ok';
}
/** the check waits this long for TomTom; slower is 'network' (a weak signal is not a refusal) */
export const TILE_CHECK_MS = 8000;
/** asks ONE tile with a plain request (the site's address with it, as the tiles send it: TomTom answers its key only for
    the app's addresses; no cookie; past the browser's own cache) and says what TomTom answered. No answer → 'network'.
    A request the browser stops before any answer is read is either no network or an answer without TomTom's CORS headers
    (its tiles always carry them: an error page); a second, opaque request tells the two apart: it comes back → 'refused'. */
export async function checkTile(url: string, get: typeof fetch, ms: number = TILE_CHECK_MS): Promise<TileCheck> {
  const once = async (mode: RequestMode): Promise<{ status: number } | 'late' | 'failed'> => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let late = false;
    const timer = setTimeout(() => { late = true; ctl?.abort(); }, ms);
    try {
      const res = await get(url, { mode, cache: 'no-store', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', ...(ctl ? { signal: ctl.signal } : {}) });
      return late ? 'late' : res;
    } catch {
      return late ? 'late' : 'failed';
    } finally {
      clearTimeout(timer);
    }
  };
  const first = await once('cors');
  if (typeof first === 'object') return tileCheckOf(first.status);
  if (first === 'late') return 'network';
  return typeof (await once('no-cors')) === 'object' ? 'refused' : 'network';
}
/** after TomTom served the tile asked, the next check waits this long (its tiles may run out later in the visit) */
export const TILE_CHECK_EVERY = 60 * 1000;
/** after a check with no answer (no network), the next one waits this long */
export const TILE_CHECK_RETRY = 5 * 1000;
export interface TileWatch {
  /** TomTom refused its tiles: OpenStreetMap's from now on */
  readonly down: boolean;
  /** a TomTom tile failed. true → check it now (checkTile, one request), then say the answer to `checked`. Nothing to ask
      while the phone has no network at all, while a check is out, or soon after the last one. */
  error(online: boolean, now?: number): boolean;
  /** the check's answer. true ONCE (TomTom refused) → every map changes to OpenStreetMap's tiles, for good (no back and
      forth); 'ok' and 'network' never change anything */
  checked(r: TileCheck, now?: number): boolean;
  /** forgets everything (tests) */
  forget(): void;
}
/** watches TomTom's tiles for all the maps of a page (a tile loaded proves nothing: it may come from the phone's cache) */
export function tileWatch(every: number = TILE_CHECK_EVERY, retry: number = TILE_CHECK_RETRY): TileWatch {
  let down = false, busy = false, next = 0;
  return {
    get down() { return down; },
    error(online, now = Date.now()) {
      if (down || busy || !online || now < next) return false;
      busy = true;
      return true;
    },
    checked(r, now = Date.now()) {
      busy = false;
      if (down) return false;
      if (r === 'refused') { down = true; return true; }
      next = now + (r === 'ok' ? every : retry);
      return false;
    },
    forget() { down = false; busy = false; next = 0; }
  };
}

/* ---------- the road ---------- */
export type LatLng = [number, number];
export interface TomtomRoute { legs: LatLng[][]; km: number; minutes: number }

/** a line the server stored for a trip is a road only with at least 3 points: the old « Je pars » wrote the two ends
    alone (a straight line) when OSRM did not answer, and such a line is never drawn */
export function isRoadLine(line: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(line) && line.length >= 3;
}

/** the route through these points in this order (at most 150). `departAt`: 'now' (the traffic of this minute) or a
    moment to come written without an offset, « 2026-11-24T11:30:00 » (Montréal's time; TomTom's usual traffic then) */
export function tomtomRouteUrl(stops: LatLng[], key: string, departAt: string = 'now'): string {
  const pts = stops.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(':');
  const when = DEPART.test(departAt) ? departAt : 'now';
  return `${TOMTOM_API}/routing/1/calculateRoute/${pts}/json?key=${encodeURIComponent(key)}`
    + `&traffic=true&travelMode=car&routeType=fastest&departAt=${when}&routeRepresentation=polyline&computeTravelTimeFor=none`;
}
const DEPART = /^(now|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/;

interface TtPoint { latitude?: number; longitude?: number }
interface TtSummary { lengthInMeters?: number; travelTimeInSeconds?: number }
interface TtLeg { points?: TtPoint[]; summary?: TtSummary }
/** reads TomTom's answer: one line of points per leg ([lat, lng]), the km and the minutes. The traffic is already in
    TomTom's time: no margin is added (OSRM's times get +20 %). null when it is not the route asked for, or when a leg
    has no point at all (it would be drawn as a straight line between its stops: the next planner is asked instead). */
export function parseTomtomRoute(j: unknown, n: number): TomtomRoute | null {
  const r = (j as { routes?: { legs?: TtLeg[]; summary?: TtSummary }[] } | null)?.routes?.[0];
  if (!r || !Array.isArray(r.legs) || r.legs.length !== n - 1) return null;
  const legs: LatLng[][] = r.legs.map((leg) => {
    const pts: LatLng[] = [];
    for (const c of leg?.points || []) {
      const p: LatLng = [Number(c?.latitude), Number(c?.longitude)];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    return pts;
  });
  if (legs.some((l) => l.length === 0)) return null;
  const metres = Number(r.summary?.lengthInMeters), seconds = Number(r.summary?.travelTimeInSeconds);
  if (!Number.isFinite(metres) || !Number.isFinite(seconds)) return null;
  return { legs, km: Math.round(metres / 100) / 10, minutes: Math.max(1, Math.round(seconds / 60)) };
}
/** the words of a TomTom refusal: its routing errors say `error.description`, its gateway (key, quota) says
    `detailedError.message` / `detailedError.code` (seen live: a refused key answers 401 with a detailedError) */
export function tomtomError(j: unknown): string {
  const b = j as { error?: { description?: unknown }; detailedError?: { message?: unknown; code?: unknown } } | null;
  return [b?.error?.description, b?.detailedError?.message, b?.detailedError?.code].filter((x) => x != null && x !== '').map(String).join(' ');
}
/** TomTom says « no » for good (no road between the points, a point in the sea, too many points): asking again gives
    the same answer. Anything else (busy, over the day's quota, a key refused or badly written) may change. */
export function tomtomRefused(status: number, j: unknown): boolean {
  if (status !== 400) return false;
  return !/key|quota|limit|auth|forbidden|credential|unauthori[sz]ed/i.test(tomtomError(j));
}

/* ---------- the addresses ---------- */
/** the addresses matching what was typed (TomTom's Geocoding service: doors, door ranges and streets; a half-typed
    address is understood): Canada only, near Montréal first, written in French */
export function tomtomGeocodeUrl(q: string, key: string): string {
  return `${TOMTOM_API}/search/2/geocode/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}`
    + `&countrySet=CA&lat=${NEAR.lat}&lon=${NEAR.lng}&limit=6&language=fr-FR`;
}
export interface TomtomAddress {
  streetNumber?: string; streetName?: string; municipality?: string; municipalitySubdivision?: string; neighbourhood?: string;
  localName?: string; countrySecondarySubdivision?: string; countrySubdivision?: string; countrySubdivisionName?: string;
  countrySubdivisionCode?: string; postalCode?: string; extendedPostalCode?: string; countryCode?: string; freeformAddress?: string;
}
export interface TomtomResult {
  /** 'Point Address' (the door), 'Address Range' (the door placed along its block), 'Street', 'Cross Street', 'Geography' */
  type?: string;
  address?: TomtomAddress;
  position?: { lat?: number; lon?: number };
}
export function tomtomResults(j: unknown): TomtomResult[] {
  const r = (j as { results?: unknown } | null)?.results;
  return Array.isArray(r) ? (r as TomtomResult[]) : [];
}
