/* « Vraies routes »: the customer's arrival time is worked out again while the mechanic drives (review E1). At « Je pars »
   the server gives the trip a real time (TomTom with the traffic of now, else OSRM, else none); without this the time is
   never asked again, and once it has passed the customer's page says « d'un instant à l'autre » for the rest of the trip.
   The phone of the one DRIVING asks the server (`enroute { action: 'refresh' }`) for a new time:
   - only for his own trip to a job (`trips.staff_id` = him, active, not expired, its job « En route »), only to a stop of
     the vehicles he drives (his own; with « Routes partagées », the route he said he does: a trip the server gave him for
     ANOTHER vehicle's stop is never refreshed from where he is), and only while his day is started (the same rule as sharing
     his position);
   - at most every 5 minutes, only when the phone moved 300 m or more since the place the last real time was worked out
     from (a trip with no time yet needs no move), at most 8 times a trip (each one is one TomTom Routing request: 20 000
     free a month). The count and the time are shared by the copies of the app on the phone (its storage), and a new road
     the phone did not ask for (« Renvoyer le texto en route », another copy) restarts the 5 minutes and the 300 m;
   - never offline, never in « Voir l'app comme… », never while the app is not on the screen: no timer runs then (a web
     app's timers are stopped or slowed by the phone in the background anyway); back on the screen, one check at once;
   - never a text: `notify: false` (the server sends nothing even if the trip was closed meanwhile and it would make a new
     one), and the trip is read again from the server just before;
   - a refresh that fails changes nothing: the server writes the trip only when a road came back, so the last real time
     stays.
   The trip back to the Centrale is not refreshed: the server's refresh needs a job (enroute handler.ts:162-163), and
   asking « return » again would make a new trip, a new link and a new text.
   The rules are pure functions (tested); startTripRefresh() runs the rest once for the whole app. */
import { signal, effect, untracked } from '@preact/signals';
import type { Job, Trip } from '../data/types';
import { me, preview } from '../data/auth';
import { openShift, job as jobRow } from '../data/select';
import { rowsOf } from '../data/store';
import { net } from '../data/net';
import { enroute } from '../data/api';
import { refetch, pull } from '../data/sync';
import { isRoadLine } from '../lib/tomtom';
import { quickPosition, lastReading, metersBetween, myRoute, type Fix } from './position';

/* ---------- the rules (pure) ---------- */
export const TRIP_RULES = {
  /** never two refreshes of a trip closer than this (« Je pars » counts as the first time) */
  gapMs: 5 * 60_000,
  /** only when the phone moved this much since the place the last time was worked out from */
  moveM: 300,
  /** at most this many refreshes a trip (one TomTom Routing request each) */
  maxPerTrip: 8,
  /** how often the phone looks, while a trip is under way and the app is on the screen */
  tickMs: 60_000,
  /** a reading older than this is not where the phone is */
  fixMaxAgeMs: 60_000,
  /** a reading vaguer than this cannot tell a 300 m move (cell towers) */
  maxAccuracyM: 300
};

/** what this phone remembers of a trip: refreshes asked, when the last one was asked (phone clock), where the last real
    time was worked out from (null: no real time yet), and the start of the server's road it last accounted for */
export interface TripMemo { n: number; at: number; from: { lat: number; lng: number } | null; road?: string | null }

/** the trip this person is driving to a job now (the newest one when the copy holds several), or null. `trucks`: only to a
    stop of those vehicles (drivenTrucks) */
export function tripUnderWay(trips: Trip[], jobOf: (id: string) => (Pick<Job, 'status' | 'deleted_at'> & Partial<Pick<Job, 'truck_id'>>) | undefined, staffId: string, now: number, trucks?: string[]): Trip | null {
  let best: Trip | null = null;
  for (const t of trips) {
    if (t.status !== 'active' || t.deleted_at || t.staff_id !== staffId || t.kind === 'return' || !t.job_id) continue;
    const end = Date.parse(t.expires_at);
    if (!Number.isFinite(end) || end <= now) continue;
    const j = jobOf(t.job_id);
    if (!j || j.deleted_at || j.status !== 'en_route') continue;
    if (trucks && !(j.truck_id && trucks.includes(j.truck_id))) continue;
    if (!best || String(t.started_at) > String(best.started_at)) best = t;
  }
  return best;
}

/** the vehicles whose stops this person drives to: his own (`access.trucks`); with several (« Routes partagées ») and the route
    he said he does (« La route que je fais »), that one only. The same choice as the job of his positions (position.ts
    currentJobId), so a trip the server gave him for another vehicle's stop is never refreshed from where he is (review-trip
    F8); among his own the newest still wins (a stop left « En route » by a forgotten « Je suis arrivé » loses to the next). */
export function drivenTrucks(trucks: string[], route: string | null): string[] {
  return trucks.length > 1 && route && trucks.includes(route) ? [route] : trucks;
}

export type AskWhy = 'go' | 'hidden' | 'offline' | 'spent' | 'soon';
/** may this phone ask now? (before reading the position: nothing is asked of the phone when the answer is no) */
export function mayAsk(m: TripMemo, now: number, ctx: { visible: boolean; online: boolean }, r = TRIP_RULES): AskWhy {
  if (!ctx.visible) return 'hidden';
  if (!ctx.online) return 'offline';
  if (m.n >= r.maxPerTrip) return 'spent';
  const gap = now - m.at;
  if (gap < r.gapMs) return 'soon';
  return 'go';
}

export type MoveWhy = 'go' | 'no_fix' | 'vague' | 'first' | 'still';
/** has the phone moved enough since the last time was worked out? 'first': no place known (no real time yet: the server
    never had a road for this trip), so no move is needed */
export function movedEnough(m: TripMemo, fix: Fix | null, now: number, r = TRIP_RULES): MoveWhy {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || now - fix.at > r.fixMaxAgeMs) return 'no_fix';
  if (fix.accuracy != null && fix.accuracy > r.maxAccuracyM) return 'vague';
  if (!m.from) return 'first';
  return metersBetween(m.from, fix) >= r.moveM ? 'go' : 'still';
}

/** where the trip's time was worked out from: the first point of the server's road (null without a road) */
export function roadStart(t: Pick<Trip, 'route'>): { lat: number; lng: number } | null {
  const line = Array.isArray(t.route) ? t.route : [];
  if (!isRoadLine(line)) return null;
  const [lat, lng] = line[0];
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
const placeKey = (p: { lat: number; lng: number } | null) => (p ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : null);

/* ---------- what the phone remembers (count and time only: never a position on the phone) ---------- */
const KEY = 'his.tripRefresh';
const KEEP_MS = 24 * 3600_000;
type Kept = Record<string, { n: number; at: number }>;
function readKept(): Kept {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Kept) : {};
  } catch { return {}; }
}
function keep(id: string, m: TripMemo, now: number) {
  try {
    const all = readKept();
    all[id] = { n: m.n, at: m.at };
    for (const [k, v] of Object.entries(all)) if (!v || !Number.isFinite(v.at) || now - v.at > KEEP_MS) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private window: this visit's memory only */ }
}

/* ---------- the service (browser) ---------- */
/** the last refresh the server answered (for a screen that wants to say it; null before the first) */
export const tripRefreshed = signal<{ tripId: string; at: number; etaAt: string | null; road: boolean } | null>(null);

const memos = new Map<string, TripMemo>();
const visible = signal(typeof document === 'undefined' || document.visibilityState !== 'hidden');
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let armedFor: string | null = null;
let busy = false;
let dispose: (() => void) | null = null;
let onVis: (() => void) | null = null;

const online = () => net.value.online && !(typeof navigator !== 'undefined' && navigator.onLine === false);
const jobOf = (id: string) => jobRow(id);
function current(now: number): Trip | null {
  const a = me.value;
  if (!a || preview.value || !openShift(a.id)) return null;
  // « Je pars » for another vehicle's stop, or the office's « Renvoyer » under « Routes partagées », may give this person a
  // trip somebody else drives (review-trip F8)
  return tripUnderWay(rowsOf<Trip>('trips'), jobOf, a.id, now, drivenTrucks(a.trucks || [], myRoute.value));
}
function keptOf(id: string): { n: number; at: number } | null {
  const k = readKept()[id];
  return k && Number.isFinite(k.n) && Number.isFinite(k.at) ? k : null;
}
function memoOf(t: Trip, now: number): TripMemo {
  let m = memos.get(t.id);
  const k = keptOf(t.id);
  if (!m) {
    // where from: the start of the server's road; none: no real time yet (review-trip F9)
    const from = roadStart(t);
    // first seen on this phone (right after « Je pars »): the 5 minutes count from now; after a reload, from the time kept
    // (never from the future: a clock put back would block the trip)
    m = k ? { n: k.n, at: Math.min(k.at, now), from, road: placeKey(from) } : { n: 0, at: now, from, road: placeKey(from) };
    memos.set(t.id, m);
  } else if (k) mergeKept(m, k, now);
  return m;
}
/** another copy of the app on this phone (a Safari tab and the home-screen app share its storage) asked meanwhile: the
    larger count and the later time win (review-trip F5); a time kept in the future is the clock put back, not a request */
function mergeKept(m: TripMemo, k: { n: number; at: number }, now: number) {
  m.n = Math.max(m.n, k.n);
  if (k.at <= now) m.at = Math.max(m.at, k.at);
}
/** the server's road changed without a refresh of this phone (« Renvoyer le texto en route » asks TomTom again for the same
    trip; another copy of the app refreshed it): a new real time was worked out about now from where that road starts, so the
    5 minutes and the 300 m count from there (review-trip F7) */
function roadSeen(t: Trip, m: TripMemo, now: number) {
  const start = roadStart(t);
  const key = placeKey(start);
  if (!key || key === m.road) return;
  m.road = key;
  m.from = start;
  if (now > m.at) { m.at = now; keep(t.id, m, now); }
}
function disarm() {
  if (timer) clearInterval(timer);
  timer = null;
  armedFor = null;
}

/** one look: asks the server for a new time when every rule says yes. Never throws. */
export async function checkTrip(): Promise<void> {
  if (busy) return;
  const now = Date.now();
  const trip = current(now);
  if (!trip || !trip.job_id) { disarm(); return; }
  const m = memoOf(trip, now);
  roadSeen(trip, m, now);
  if (mayAsk(m, now, { visible: visible.value, online: online() }) !== 'go') return;
  busy = true;
  try {
    // the watch's reading when it is fresh, else the phone is asked (3.5 s at most)
    await quickPosition();
    const fix = lastReading();
    const moved = movedEnough(m, fix, Date.now());
    // 'first': the customer has no real time yet, the first one needs no move (review-trip F9)
    if ((moved !== 'go' && moved !== 'first') || !fix) return;
    // the server's copy of the trip, now: a trip closed meanwhile (the day ended on another phone, the trip expired) is never
    // asked for again (the server would make a new one)
    const seen = await refetch('trips', trip.id);
    if (seen === 'gone') { m.n = TRIP_RULES.maxPerTrip; keep(trip.id, m, Date.now()); return; }
    if (seen !== 'updated') return;
    const still = current(Date.now());
    if (!still || still.id !== trip.id) return;
    if (!visible.value || !online()) return;
    // the other copy of the app, or a resend, may have asked while this one read the server
    const k = keptOf(trip.id);
    if (k) mergeKept(m, k, Date.now());
    roadSeen(still, m, Date.now());
    if (mayAsk(m, Date.now(), { visible: true, online: true }) !== 'go') return;
    // counted before it goes: an answer lost on a weak signal still cost a request
    m.n += 1;
    m.at = Date.now();
    keep(trip.id, m, m.at);
    const opts = { pos: { lat: fix.lat, lng: fix.lng }, notify: false, driver_id: me.value!.id } as NonNullable<Parameters<typeof enroute>[2]> & { driver_id: string };
    const e = (await enroute('refresh', trip.job_id, opts)) as Awaited<ReturnType<typeof enroute>> & { route_source?: string | null };
    if (e.ok) {
      // a new real time (the server wrote the trip only then): the next one counts from here, and the road the answer put
      // in the phone's copy (callFn's rows) is this phone's own, not a resend
      if (e.route_source) {
        m.from = { lat: fix.lat, lng: fix.lng };
        const row = rowsOf<Trip>('trips').find((t) => t.id === trip.id);
        m.road = placeKey(row ? roadStart(row) : null) ?? m.road;
      }
      tripRefreshed.value = { tripId: trip.id, at: m.at, etaAt: e.eta_at ?? null, road: !!e.route_source };
    } else if (e.code === 'not_en_route' || e.code === 'not_found' || e.code === 'no_trip') {
      // the trip is over on the server (« Je suis arrivé » from another phone; `no_trip`: the server's answer once its
      // refresh no longer makes a trip, report build-trip §6): never again for it
      m.n = TRIP_RULES.maxPerTrip;
      keep(trip.id, m, Date.now());
      void pull('trips');
      void pull('jobs');
    }
  } catch {
    /* no answer: nothing changes, the last real time stays */
  } finally {
    busy = false;
  }
}

/** runs once for the whole app (the frame starts it with its other background services) */
export function startTripRefresh() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  visible.value = document.visibilityState !== 'hidden';
  onVis = () => { visible.value = document.visibilityState !== 'hidden'; };
  document.addEventListener('visibilitychange', onVis);
  dispose = effect(() => {
    const trip = current(Date.now());
    const v = visible.value;
    untracked(() => {
      if (!trip || !v) { disarm(); return; }
      if (armedFor === trip.id && timer) return;
      // a new trip, or the app back on the screen: look once now, then every minute
      disarm();
      armedFor = trip.id;
      timer = setInterval(() => { void checkTrip(); }, TRIP_RULES.tickMs);
      void checkTrip();
    });
  });
}
/** stops everything (sign-out, tests) */
export function stopTripRefresh() {
  disarm();
  dispose?.();
  dispose = null;
  if (onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  onVis = null;
  started = false;
  busy = false;
  memos.clear();
  tripRefreshed.value = null;
}
