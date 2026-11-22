/* The tracking page's answer (public_track) turned into what the page shows, and the live arrival: where the mechanic
   is on his route tells the minutes left (liveEta), kept calm answer after answer (calm). Pure: tested in
   track-state.test.ts. */
import type { TrackAnswer, Garage } from '../api';
import { ct, isLang, type CLang } from '../i18n';
import { localMinuteOf, nbClock } from '../format';
import { isRoadLine } from '../../lib/tomtom';
// the haversine the client page already has (the address search of « Réserver en ligne »): nothing more to load
import { metres } from '../../shared/places/photon';

export type TrackKind = 'active' | 'arrived' | 'cancelled' | 'expired' | 'not_found';
const KINDS: TrackKind[] = ['active', 'arrived', 'cancelled', 'expired', 'not_found'];
export interface LatLng { lat: number; lng: number }
export interface TrackView {
  kind: TrackKind;
  /** the mechanic's first name ('' when unknown) */
  mechanic: string;
  garage: Garage;
  lang: CLang | null;
  dest: LatLng | null;
  pos: (LatLng & { at: string }) | null;
  /** the server's road to the customer (3 points or more), or none: never a straight line */
  route: [number, number][];
  /** the expected arrival: Montréal clock minute, and minutes left by the server's clock (not the phone's) */
  eta: { minute: number; left: number } | null;
  /** Montréal clock minute the trip ended (arrived) */
  ended: number | null;
  /** Montréal clock minute of the last position */
  posMinute: number | null;
  /** a trip back to the start: where to (« Centrale »); null for a trip to a customer */
  destLabel: string | null;
}

const okPt = (p: unknown): p is LatLng => {
  const x = p as LatLng | null;
  return !!x && Number.isFinite(x.lat) && Number.isFinite(x.lng) && Math.abs(x.lat) <= 90 && Math.abs(x.lng) <= 180 && !(x.lat === 0 && x.lng === 0);
};

/** the route's good points (a broken point is dropped) */
function cleanRoute(r: unknown): [number, number][] {
  return Array.isArray(r)
    ? r.filter((p) => Array.isArray(p) && okPt({ lat: Number(p[0]), lng: Number(p[1]) })).map((p) => [Number(p[0]), Number(p[1])] as [number, number])
    : [];
}
/** the server's road: its good points when they make a road, 3 points or more; else none. Two points are the old
    server's straight line (written when no planner answered): never drawn, and no arrival is counted along it */
function roadOf(r: unknown): [number, number][] {
  const line = cleanRoute(r);
  return isRoadLine(line) ? line : [];
}

/** fetchedAt: when the answer arrived (phone clock); nowMs: the moment shown (the page redraws between answers);
    live: the live arrival kept calm by useTrack (liveEta + calm). Without it (or when the position cannot be trusted),
    the server's eta_at counted down by the clock, as before */
export function trackView(a: TrackAnswer | null | undefined, fetchedAt: number, nowMs: number = Date.now(), live: LiveHeld | null = null): TrackView {
  const status = String(a?.status || 'not_found') as TrackKind;
  const kind: TrackKind = KINDS.includes(status) ? status : 'not_found';
  const garage: Garage = { name: a?.garage?.name || null, phone: a?.garage?.phone || null };
  const dest = kind === 'active' && okPt(a?.dest) ? { lat: a!.dest!.lat, lng: a!.dest!.lng } : null;
  const pos = kind === 'active' && okPt(a?.pos) ? { lat: a!.pos!.lat, lng: a!.pos!.lng, at: a!.pos!.at } : null;
  const route = kind === 'active' ? roadOf(a?.route) : [];
  let eta: TrackView['eta'] = null;
  if (kind === 'active' && live && Number.isFinite(live.left) && Number.isFinite(live.arrive)) {
    // the minutes kept since the last answer, counted down only when answers stop coming (they come every 5 s); the
    // arrival time kept, never earlier than now (both on the server's clock)
    const serverNow = Date.parse(String(a?.now));
    const passed = Math.max(0, nowMs - fetchedAt);
    const left = Math.max(0, Math.round(live.left - passed / 60000));
    const minute = localMinuteOf(Math.max(live.arrive, (Number.isFinite(serverNow) ? serverNow : fetchedAt) + passed));
    if (minute != null) eta = { minute, left };
  } else if (kind === 'active' && a?.eta_at) {
    const etaMs = Date.parse(a.eta_at);
    const serverNow = a.now ? Date.parse(a.now) : NaN;
    if (Number.isFinite(etaMs)) {
      // the phone's clock may be off: count from the server's « now », plus the time passed since the answer
      const skew = Number.isFinite(serverNow) ? fetchedAt - serverNow : 0;
      const left = Math.max(0, Math.round((etaMs + skew - nowMs) / 60000));
      const minute = localMinuteOf(etaMs);
      if (minute != null) eta = { minute, left };
    }
  }
  return {
    kind, garage, dest, pos, route, eta,
    mechanic: String(a?.mechanic || '').trim().split(/\s+/)[0] || '',
    lang: isLang(a?.lang) ? a!.lang as CLang : null,
    ended: kind === 'arrived' && a?.ended_at ? localMinuteOf(a.ended_at) : null,
    posMinute: pos ? localMinuteOf(pos.at) : null,
    destLabel: a?.kind === 'return' ? String(a.dest_label || '').trim() || 'Centrale' : null
  };
}

/** the page stops asking once the trip is over */
export function isFinal(kind: TrackKind): boolean { return kind !== 'active'; }

/* ---------- where he is on his route ---------- */

export type Pt = [number, number];
/** a route measured once: its points [lat, lng], the metres from its start to each point, its length in metres */
export interface Route { pts: Pt[]; cum: number[]; total: number }
/** null: under 2 points, or no length */
export function routeOf(pts: Pt[] | null | undefined): Route | null {
  if (!pts || pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const total = cum[cum.length - 1];
  return total > 1 ? { pts, cum, total } : null;
}

const RAD = Math.PI / 180;
/** the point of the route nearest to p: along = metres from the route's start to it, off = metres from p to it,
    seg = its segment. Before the route's start: its start (along 0); past its end: its end (along = total). */
export interface OnRoute { along: number; off: number; seg: number; at: LatLng }
export function project(r: Route, p: LatLng): OnRoute {
  let best: OnRoute | null = null;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [alat, alng] = r.pts[i];
    const [blat, blng] = r.pts[i + 1];
    // a flat drawing around the segment (a degree of longitude is shorter than one of latitude here): exact enough
    // for the length of a city street
    const k = Math.cos(alat * RAD);
    const bx = (blng - alng) * k, by = blat - alat, px = (p.lng - alng) * k, py = p.lat - alat;
    const l2 = bx * bx + by * by;
    const t = l2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / l2)) : 0;
    const at = { lat: alat + t * (blat - alat), lng: alng + t * (blng - alng) };
    const off = metres(p.lat, p.lng, at.lat, at.lng);
    // the first of two equal answers (a route that comes back on itself): the one nearer its start, the later arrival
    if (!best || off < best.off - 0.5) best = { along: r.cum[i] + t * (r.cum[i + 1] - r.cum[i]), off, seg: i, at };
  }
  return best!;
}

/** the point `along` metres from the route's start (its start before it, its end past it) */
export function pointAt(r: Route, along: number): LatLng {
  if (!(along > 0)) return { lat: r.pts[0][0], lng: r.pts[0][1] };
  if (along >= r.total) { const e = r.pts[r.pts.length - 1]; return { lat: e[0], lng: e[1] }; }
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < along) i++;
  const len = r.cum[i] - r.cum[i - 1];
  const t = len > 0 ? (along - r.cum[i - 1]) / len : 0;
  const [alat, alng] = r.pts[i - 1];
  const [blat, blng] = r.pts[i];
  return { lat: alat + t * (blat - alat), lng: alng + t * (blng - alng) };
}

/** the planned minutes still to drive from p: the distance left on the route over the whole route's length, times the
    planned drive (off: how far p is from the route, metres) */
export function minutesLeft(r: Route, p: LatLng, planned: number): { left: number; off: number; along: number } {
  const o = project(r, p);
  return { left: Math.max(0, ((r.total - o.along) / r.total) * planned), off: o.off, along: o.along };
}

/** a position older than this, or farther than this from the route, is not trusted for the arrival: the server's eta_at */
export const OLD_POS_MS = 2 * 60000;
export const OFF_ROUTE_M = 400;
/** the live arrival of an answer: minutes left from the answer's « now » (not rounded) and the arrival moment (server's
    clock, ms). null — the page keeps the server's eta_at — when: not on the way, no position, a position more than
    2 minutes old or more than 400 m from the route, no road (under 3 points: roadOf), no planned minutes */
export interface LiveEta { left: number; arrive: number }
export function liveEta(a: TrackAnswer | null | undefined, fetchedAt: number): LiveEta | null {
  if (!a || a.status !== 'active' || !okPt(a.pos)) return null;
  const planned = Number(a.minutes);
  if (a.minutes == null || !Number.isFinite(planned) || planned <= 0) return null;
  const r = routeOf(roadOf(a.route));
  if (!r) return null;
  const serverNow = Date.parse(String(a.now));
  const now = Number.isFinite(serverNow) ? serverNow : fetchedAt;
  const posAt = Date.parse(String(a.pos.at));
  if (!Number.isFinite(posAt) || now - posAt > OLD_POS_MS) return null;
  const m = minutesLeft(r, a.pos, planned);
  if (m.off > OFF_ROUTE_M) return null;
  return { left: m.left, arrive: now + m.left * 60000 };
}

/** what useTrack keeps between answers and gives trackView: minutes left at the last answer, the arrival moment (ms) */
export interface LiveHeld { left: number; arrive: number }

/** the calm rule, on minutes: the value shown changes only when a new one differs from it by a full minute two answers
    in a row (same way), or at once when it drops by 2 minutes or more (he is clearly closer). Answer after answer:
    calm(calm(calm(null, a), b), c)…; `v` is the value to show. */
export interface Calm { v: number; next: number | null }
export const CALM_STEP = 1;
export const CALM_DROP = 2;
export function calm(prev: Calm | null, fresh: number): Calm {
  if (!prev || !Number.isFinite(prev.v)) return { v: fresh, next: null };
  const d = fresh - prev.v;
  if (Math.abs(d) < CALM_STEP) return { v: prev.v, next: null };
  if (d <= -CALM_DROP) return { v: fresh, next: null };
  if (prev.next != null && Math.sign(prev.next - prev.v) === Math.sign(d)) return { v: fresh, next: null };
  return { v: prev.v, next: fresh };
}

/* ---------- the truck's glide on the map ---------- */

/** both ends this close to the route: the dot follows its bends between them */
export const ON_ROUTE_M = 80;
/** the way the dot goes from `from` to `to`: along the route's bends when both are on it and he goes forward, else
    straight. A way much longer than the straight line (a route that comes back near itself) is not taken. */
export function glidePath(from: LatLng, to: LatLng, r: Route | null): Pt[] {
  const straight: Pt[] = [[from.lat, from.lng], [to.lat, to.lng]];
  if (!r) return straight;
  const a = project(r, from);
  const b = project(r, to);
  if (a.off > ON_ROUTE_M || b.off > ON_ROUTE_M || b.along <= a.along) return straight;
  const way: Pt[] = [straight[0]];
  for (let i = a.seg + 1; i <= b.seg; i++) if (r.cum[i] > a.along + 1 && r.cum[i] < b.along - 1) way.push(r.pts[i]);
  way.push(straight[1]);
  if (way.length === 2) return straight;
  let len = 0;
  for (let i = 1; i < way.length; i++) len += metres(way[i - 1][0], way[i - 1][1], way[i][0], way[i][1]);
  const direct = metres(from.lat, from.lng, to.lat, to.lng);
  return len <= direct * 3 + 200 ? way : straight;
}

/** the arrival line of the card: the big minutes left (null when « d’un instant à l’autre » or unknown) and the words
    beside them (« Arrivée prévue vers 12 h 40 ») */
export function arrival(v: TrackView, l: CLang): { left: number | null; when: string } {
  if (!v.eta) return { left: null, when: ct(l, 'track.etaNone') };
  if (v.eta.left <= 1) return { left: null, when: ct(l, 'track.etaSoon') };
  return { left: v.eta.left, when: ct(l, 'track.etaAt', { time: nbClock(v.eta.minute, l) }) };
}

/** the big line at the top */
export function headline(v: TrackView, l: CLang): string {
  switch (v.kind) {
    case 'active': return v.destLabel ? ct(l, 'track.onTheWayTo', { name: v.mechanic || ct(l, 'track.mechanicAnon'), place: v.destLabel }) : v.mechanic ? ct(l, 'track.onTheWay', { name: v.mechanic }) : ct(l, 'track.onTheWayAnon');
    case 'arrived': return v.destLabel ? ct(l, 'track.arrivedTo', { name: v.mechanic || ct(l, 'track.mechanicAnon'), place: v.destLabel }) : v.mechanic ? ct(l, 'track.arrived', { name: v.mechanic }) : ct(l, 'track.arrivedAnon');
    case 'cancelled': return ct(l, 'track.cancelled');
    case 'expired': return ct(l, 'track.expired');
    default: return ct(l, 'track.notFound');
  }
}
