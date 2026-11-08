/* The tracking page's answer (public_track) turned into what the page shows. Pure: tested in track-state.test.ts. */
import type { TrackAnswer, Garage } from './api';
import { ct, isLang, type CLang } from './i18n';
import { localMinuteOf, nbClock } from './format';

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

/** fetchedAt: when the answer arrived (phone clock); nowMs: the moment shown (the page redraws between answers) */
export function trackView(a: TrackAnswer | null | undefined, fetchedAt: number, nowMs: number = Date.now()): TrackView {
  const status = String(a?.status || 'not_found') as TrackKind;
  const kind: TrackKind = KINDS.includes(status) ? status : 'not_found';
  const garage: Garage = { name: a?.garage?.name || null, phone: a?.garage?.phone || null };
  const dest = kind === 'active' && okPt(a?.dest) ? { lat: a!.dest!.lat, lng: a!.dest!.lng } : null;
  const pos = kind === 'active' && okPt(a?.pos) ? { lat: a!.pos!.lat, lng: a!.pos!.lng, at: a!.pos!.at } : null;
  const route = kind === 'active' && Array.isArray(a?.route)
    ? a!.route!.filter((p) => Array.isArray(p) && okPt({ lat: Number(p[0]), lng: Number(p[1]) })).map((p) => [Number(p[0]), Number(p[1])] as [number, number])
    : [];
  let eta: TrackView['eta'] = null;
  if (kind === 'active' && a?.eta_at) {
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

/** « Arrivée prévue vers 12 h 40 (environ 9 min) », « Arrivée d'un instant à l'autre », or null (no arrival time) */
export function etaText(v: TrackView, l: CLang): string | null {
  if (v.kind !== 'active' || !v.eta) return null;
  if (v.eta.left <= 1) return ct(l, 'track.etaSoon');
  return ct(l, 'track.eta', { time: nbClock(v.eta.minute, l), min: `${v.eta.left}` });
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
