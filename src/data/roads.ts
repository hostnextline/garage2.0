/* « Vraies routes » (Part 27, CONTRACT §4): what the app asks the server function « drive », the switch and the two
   previews. With the switch off nothing here sends anything and nothing waits. Tested in roads.test.ts (the rules, the
   function pretended) and roads.sent.test.ts (through the real engine and outbox).
   - warmRoads: before a screen asks the planner for moments at an address, that address's trips are measured (real roads:
     TomTom, OSRM when TomTom does not answer). Switch off, no position, « Voir l'app comme… », or the demo with no pretend
     « drive »: answered at once, nothing leaves. Else ONE request per place (100 m, the server's drive_key) and PAGE of
     days: the coming days are cut in pages of 14 from today ([today, +14), [+14, +28)…, the last one cut at horizon_days),
     and an ask covers the page(s) its days fall in, so the pickers' asks of one page (14 days of blocks, each day of the
     windows one after the other, the later scores) share one request (review-data M2). Remembered 10 minutes (1 minute
     when it could not measure everything: the next screen, or « Réessayer », asks again soon). The screens wait at most
     `waitMs` counted from the START of the measure (a second screen does not wait again: review-data M4); the request
     itself runs to its end (callFn's own limit), and one that never ends is given up after STUCK_MS (review-data L2).
     When it is done, the rest of those days (other trips, rush hours) is asked without waiting. Never throws.
   - placeRoads(point, from?, days?): what a screen says of that address for those days (default: the two coming weeks):
     « mesure en cours… », « mesuré », « pas disponible » (review-data L1: per page, not per address), retryRoads(point)
     for « Réessayer » (it also replaces a request a screen already gave up on); roadsTick goes up when a measure ends
     that a screen may have stopped waiting for.
   - measureRoads (the sweep: ONE request at a time on this device, shared: review-data H1), roadsStatus, roadsSwitch
     (owner, live, a new op each tap), movePreview, stopOrderPreview.
   - warmAfterSent / warmJob / warmPlace: a booking, a move, a change of customer or of an appointment's position that
     reached the server (also one replayed from the outbox later) has its place measured for its day, in the background;
     a failure remembered for that place is not reused then (review-data M3). */
import { signal } from '@preact/signals';
import { callFn, preview } from './auth';
import { callRpc, pull } from './sync';
import { roadsOn, settings } from './select';
import { getRow } from './store';
import type { OutboxEntry } from './local';
import type { Customer, Job } from './types';
import { today, addDays, daysBetween, isValidDay, type BlockKey, type Day } from '../lib/dates';
import { Refused } from '../lib/errors';
import { t } from '../lib/i18n';

/* ---------- the answers ---------- */
export interface LatLng { lat: number; lng: number }
export type TomtomState = 'ok' | 'no_key' | 'refused' | 'busy' | 'over_budget' | 'unused';
export type OsrmState = 'ok' | 'down' | 'unused';
/** TomTom Matrix transactions charged this month, and the month's ceiling (settings.booking.roads_month_tx) */
export interface DriveSpend { month: string; tx: number; cap: number }
/** a block whose new plan would have left an appointment out: kept as it was, with the real arrival times */
export interface KeptBlock { day: string; block: string }
/** « drive » warm / sweep went through (CONTRACT §3). ready: no usual-hours trip is missing for what was asked (the
    point's trips; all of them for a sweep); left / left0: trips still missing (all / usual hours); stored: times kept;
    planned / kept / late: the re-plan that followed (late = booked appointments now after the window told); no_road:
    trips with no road at all; more: a limit was reached, call again */
export interface DriveDone {
  ok: true; ready: boolean; left: number; left0: number; stored: number; planned: number; kept: KeptBlock[]; late: string[];
  no_road: number; tomtom: TomtomState; osrm: OsrmState; spent: DriveSpend | null; more: boolean;
}
/** « drive » refused (code: signin, no_access, busy, far, server, demo…) or could not be reached ('network', 'timeout') */
export interface DriveRefused { ok: false; code: string; error?: string; at?: string }
export type DriveAnswer = DriveDone | DriveRefused;
/** « drive » status: the server has a TomTom key, the switch, what is left, this month's spend, the rows kept by source */
export interface RoadsStatusDone {
  ok: true; key: boolean; on: boolean; left: number; left0: number; month: DriveSpend | null; rows: { tomtom: number; osrm: number; none: number };
}
export type RoadsStatus = RoadsStatusDone | DriveRefused;
/** roads_switch: on (the switch now), planned (blocks planned again), kept, late (job ids to call), unchanged (already so) */
export interface RoadsSwitchAnswer { ok: boolean; on: boolean; planned: number; kept: KeptBlock[]; late: string[]; unchanged: boolean }
/** move_preview: those appointments moved onto that vehicle, nothing written. order: its stops that day in driving order;
    eta: arrival minute of each; refused: the moves the action would refuse (job ids); day_min: its driving that day; day_km
    and unmeasured: roads on only (null off; day_km null while a trip is not measured). refused_why (decided 2026-11-20;
    present only when the server says why): the refusal code of each refused move (job id → 'truck_full', 'needs_truck',
    'window_full'…, the codes of move_job). The server's name is `refused_why: { id: code }` (reports/fix-sql.md « C »);
    `refused: [{ id, code }]`, the other shape proposed (fix-sheets.md §5), is read too. */
export interface MovePreview {
  order: string[]; eta: Record<string, number | null>; refused: string[]; day_min: number | null; day_km: number | null; unmeasured: number | null;
  refused_why?: Record<string, string>;
}
/** stop_order_preview: the arrival each stop would get with that order; late = after the window (or block) told.
    measured (decided 2026-11-20, the server's name: reports/fix-sql.md « C »; only when the server says it): every trip of
    the day up to that stop is measured, so its time is a real one (false: a trip counts the « unknown » time; absent: the
    server did not say — switch off (it sends null) or an older server). */
export interface StopEta { id: string; eta: number | null; late: boolean; measured?: boolean }

const num = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const kept = (x: unknown): KeptBlock[] => (Array.isArray(x) ? x : [])
  .filter((k): k is KeptBlock => !!k && typeof k === 'object' && typeof (k as KeptBlock).day === 'string' && typeof (k as KeptBlock).block === 'string')
  .map((k) => ({ day: k.day, block: k.block }));
const spendOf = (x: unknown): DriveSpend | null => {
  const s = x as Partial<DriveSpend> | null;
  return s && typeof s === 'object' && typeof s.month === 'string' ? { month: s.month, tx: num(s.tx), cap: num(s.cap) } : null;
};
const TOMTOM: TomtomState[] = ['ok', 'no_key', 'refused', 'busy', 'over_budget', 'unused'];
const OSRM: OsrmState[] = ['ok', 'down', 'unused'];
const refusedOf = (r: Record<string, unknown>): DriveRefused => ({
  ok: false, code: typeof r.code === 'string' && r.code ? r.code : 'server',
  ...(typeof r.error === 'string' ? { error: r.error } : {}), at: typeof r.at === 'string' ? r.at : 'drive'
});
/** the answer as the screens read it: every key there with its type (an older or a pretend server may leave some out) */
export function driveAnswer(raw: unknown): DriveAnswer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.ok !== true) return refusedOf(r);
  return {
    ok: true, ready: r.ready === true, left: num(r.left), left0: num(r.left0), stored: num(r.stored), planned: num(r.planned),
    kept: kept(r.kept), late: ids(r.late), no_road: num(r.no_road),
    tomtom: TOMTOM.includes(r.tomtom as TomtomState) ? (r.tomtom as TomtomState) : 'unused',
    osrm: OSRM.includes(r.osrm as OsrmState) ? (r.osrm as OsrmState) : 'unused',
    spent: spendOf(r.spent), more: r.more === true
  };
}
function statusOf(raw: unknown): RoadsStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.ok !== true) return refusedOf(r);
  const rows = (r.rows && typeof r.rows === 'object' ? r.rows : {}) as Record<string, unknown>;
  return { ok: true, key: r.key === true, on: r.on === true, left: num(r.left), left0: num(r.left0), month: spendOf(r.month),
    rows: { tomtom: num(rows.tomtom), osrm: num(rows.osrm), none: num(rows.none) } };
}
/** a request that could not be made: no signal, or no answer within callFn's limit (or STUCK_MS) */
const failed = (e: unknown): DriveRefused => ({ ok: false, code: (e as { code?: string })?.code === 'timeout' ? 'timeout' : 'network', at: 'drive' });

/** the function's own limit is about 40 s: the request is given more, so the app never cuts a measure in the middle */
const FN_MS = 60_000;
const STATUS_MS = 15_000;
/** callFn's limit covers the request until its headers only: past this, a measure whose answer never ends is given up
    (« pas disponible », asked again later) instead of saying « mesure en cours… » for good (review-data L2) */
const STUCK_MS = FN_MS + 15_000;
/** what a screen waits at most before asking the planner, counted from the start of the measure (it goes on behind) */
export const WARM_MS = 3500;
/** a measure is remembered this long; one that could not measure everything only this long */
const KEEP_MS = 10 * 60_000;
const KEEP_SHORT_MS = 60_000;
/** the most days one request covers (the server's limit), and the length of a page of days */
const MAX_DAYS = 14;

function guard() { if (preview.peek()) throw new Refused('preview', t('errors.preview')); }
/** `p`, or a timeout error once STUCK_MS have passed (the request itself is not stopped: its answer is dropped) */
function limited<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tm = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), STUCK_MS);
    p.then((v) => { clearTimeout(tm); resolve(v); }, (e: unknown) => { clearTimeout(tm); reject(e); });
  });
}

/* ---------- the days asked ---------- */
interface Range { from: Day; to: Day; days: number }
/** the end of the coming days the garage books (today + horizon_days), null when the setting is not a number */
function horizonEnd(t0: Day): Day | null {
  const h = Number(settings.peek().booking.horizon_days);
  return Number.isFinite(h) && h > 0 ? addDays(t0, Math.floor(h)) : null;
}
/** the days `days` from `from` (at most 14), never before today nor past the horizon. `exact`: as asked (one day after
    a booking); else the page(s) of 14 days from today they fall in (one or two) */
function rangesOf(from: Day, days: number, exact: boolean): Range[] {
  const t0 = today();
  const start = isValidDay(from) ? from : t0;
  const n = Math.max(1, Math.min(MAX_DAYS, Math.floor(Number(days)) || 1));
  const lim = horizonEnd(t0);
  const end0 = addDays(start, n);
  const end = lim && lim < end0 ? lim : end0;
  const a = start > t0 ? start : t0;
  if (end <= a) return [];                                            // only past days (or past the horizon): nothing
  if (exact) return [{ from: a, to: end, days: daysBetween(a, end) }];
  const out: Range[] = [];
  const k0 = Math.floor(daysBetween(t0, a) / MAX_DAYS), k1 = Math.floor((daysBetween(t0, end) - 1) / MAX_DAYS);
  for (let k = k0; k <= k1; k++) {
    const f = addDays(t0, k * MAX_DAYS);
    const to0 = addDays(t0, (k + 1) * MAX_DAYS);
    const to = lim && lim < to0 ? lim : to0;
    if (to > f) out.push({ from: f, to, days: daysBetween(f, to) });
  }
  return out;
}

/* ---------- what a screen says of an address ---------- */
/** measuring: asked, not answered yet; measured: its usual-hours trips are known; unavailable: they could not be measured
    now (code: the refusal or 'network' / 'timeout'; tomtom / osrm: what each service did) */
export interface PlaceRoads { state: 'measuring' | 'measured' | 'unavailable'; code: string | null; tomtom: TomtomState | null; osrm: OsrmState | null; noRoad: number; at: number }
/** by place AND range of days asked (`place|from|to`) */
const places = signal<Record<string, PlaceRoads>>({});
/** goes up when a measure ends that a screen may have stopped waiting for (the suggestions on screen can be asked again) */
export const roadsTick = signal(0);
/** measures of everything (sweeps) under way on this device (0 or 1: one at a time) */
export const roadsSweeping = signal(0);

const isPoint = (p: Partial<LatLng> | null | undefined): p is LatLng =>
  !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
/** the place as the server keys it (drive_key: 3 decimals, about 100 m) */
export function placeKey(p: LatLng): string { return `${Math.round((p.lat + 90) * 1000)}:${Math.round((p.lng + 180) * 1000)}`; }
const stateKey = (place: string, r: Pick<Range, 'from' | 'to'>) => `${place}|${r.from}|${r.to}`;
/** what the app knows of this address's trips for those days (default: the two coming weeks; null: nothing to say:
    switch off, no position, nothing asked yet for those days). Days over two pages: « pas disponible » when one of
    them is, else « mesure en cours… » while one is, else « mesuré ». Reads a signal: a screen that calls it is drawn
    again when it changes. */
export function placeRoads(point: Partial<LatLng> | null | undefined, from?: string, days?: number): PlaceRoads | null {
  const all = places.value;
  if (!roadsOn.value || !isPoint(point)) return null;
  const key = placeKey(point);
  const got = rangesOf(from ?? today(), days ?? MAX_DAYS, false).map((r) => all[stateKey(key, r)]).filter((x): x is PlaceRoads => !!x);
  if (got.length <= 1) return got[0] ?? null;
  const at = Math.max(...got.map((x) => x.at));
  const pick = got.find((x) => x.state === 'unavailable') ?? got.find((x) => x.state === 'measuring');
  return pick ? { ...pick, at } : { ...got[0], noRoad: got.reduce((s, x) => s + x.noRoad, 0), at };
}
function setPlace(key: string, p: Omit<PlaceRoads, 'at'>) { places.value = { ...places.value, [key]: { ...p, at: Date.now() } }; }
const measuring = { state: 'measuring' as const, code: null, tomtom: null, osrm: null, noRoad: 0 };
function placeAfter(a: DriveAnswer): Omit<PlaceRoads, 'at'> {
  if (!a.ok) return { state: 'unavailable', code: a.code, tomtom: null, osrm: null, noRoad: 0 };
  return { state: a.ready ? 'measured' : 'unavailable', code: null, tomtom: a.tomtom, osrm: a.osrm, noRoad: a.no_road };
}

/* ---------- warm ---------- */
type Ready = { ok: boolean; ready: boolean };
interface Warm {
  place: string; from: Day; to: Day; begun: number; done: boolean; result: Ready | null; until: number;
  /** a screen stopped waiting for it (its end raises roadsTick) */
  gaveUp: boolean;
  /** replaced by « Réessayer »: its late answer says nothing any more */
  forgotten: boolean;
  promise: Promise<Ready>;
  /** the address's trips AND the rest of those days (measureRest: the other trips, the rush times) answered: what the
      exact move waits for (A7, review F6), the point's answer then */
  all: Promise<Ready>;
  restDone: boolean;
}
const warms: Warm[] = [];
/** the demo answers an unknown function « demo »: from then on nothing is asked and nothing is said */
let quiet = false;
const READY: Ready = { ok: true, ready: true };
const NOT_YET: Ready = { ok: true, ready: false };

function prune() {
  const now = Date.now();
  for (let i = warms.length - 1; i >= 0; i--) if (warms[i].done && warms[i].until <= now) warms.splice(i, 1);
}
/** waits for `w` at most `ms` counted from the start of the measure (0: not at all); still running then: ready false.
    `all`: the rest of those days too (the exact move, A7 / review F6); its end still running at `ms`: the point's answer */
function waitFor(w: Warm, ms: number, all = false): Promise<Ready> {
  if (w.done && w.result && (!all || w.restDone)) return Promise.resolve(w.result);
  const atLimit = (): Ready => {
    if (all && w.done && w.result) return w.result;
    w.gaveUp = true;
    return NOT_YET;
  };
  if (!(ms > 0)) return Promise.resolve(all && w.done && w.result ? w.result : NOT_YET);
  const left = w.begun + ms - Date.now();
  if (left <= 0) return Promise.resolve(atLimit());
  return new Promise((resolve) => {
    const tm = setTimeout(() => resolve(atLimit()), left);
    void (all ? w.all : w.promise).then((r) => { clearTimeout(tm); resolve(r); });
  });
}
function begin(point: LatLng, key: string, range: Range): Warm {
  const w: Warm = { place: key, from: range.from, to: range.to, begun: Date.now(), done: false, result: null, until: Infinity, gaveUp: false, forgotten: false, promise: Promise.resolve(READY), all: Promise.resolve(READY), restDone: false };
  let rest: Promise<void> = Promise.resolve();
  const sk = stateKey(key, range);
  setPlace(sk, measuring);
  const body = { action: 'warm', point: { lat: point.lat, lng: point.lng }, from: range.from, days: range.days };
  w.promise = (async () => {
    const a = await limited(callFn('drive', { ...body, only: 'point' }, FN_MS)).then(driveAnswer, failed);
    if (!a.ok && a.code === 'demo') {
      // the dev demo has no « drive »: stay quiet (no « pas disponible », nothing asked again)
      quiet = true;
      places.value = {};
      w.done = true; w.result = READY; w.until = Date.now() + KEEP_MS;
      return READY;
    }
    const result = { ok: a.ok, ready: a.ok && a.ready };
    w.done = true; w.result = result; w.until = Date.now() + (result.ready ? KEEP_MS : KEEP_SHORT_MS);
    if (a.ok) {
      if (a.planned > 0) void pull('jobs');
      if ((a.stored > 0 || a.planned > 0) && w.gaveUp) roadsTick.value++;
    }
    if (w.forgotten) return result;
    // not everything yet but the function only stopped at its limit: the rest below goes on with this point first
    setPlace(sk, a.ok && !a.ready && a.more ? measuring : placeAfter(a));
    if (a.ok) rest = measureRest(sk, body);
    return result;
  })();
  w.all = w.promise.then(async (r) => { await rest.catch(() => undefined); w.restDone = true; return r; });
  warms.push(w);
  return w;
}
/** the other trips of those days (between places already there, rush hours): nobody waits for it. Not asked when the
    switch was turned off while the address was measured (switch off: nothing leaves) */
function measureRest(sk: string, body: Record<string, unknown>): Promise<void> {
  if (!roadsOn.peek()) { if (places.value[sk]?.state === 'measuring') setPlace(sk, { ...measuring, state: 'unavailable' }); return Promise.resolve(); }
  return limited(callFn('drive', body, FN_MS)).then(driveAnswer, failed).then((a) => {
    if (a.ok) {
      if (a.planned > 0) void pull('jobs');
      if (a.stored > 0 || a.planned > 0) roadsTick.value++;
    }
    if (places.value[sk]?.state === 'measuring') setPlace(sk, placeAfter(a));
  });
}
/** `fresh`: a measure remembered as not ready (a failure, or trips still missing) is not reused: a new one is asked
    (after a booking or a move: flows F3, review-data M3) */
function warm(point: Partial<LatLng> | null | undefined, from: Day, days: number, waitMs: number, o: { exact?: boolean; fresh?: boolean; all?: boolean } = {}): Promise<Ready> {
  try {
    if (!roadsOn.peek() || !isPoint(point) || preview.peek() || quiet) return Promise.resolve(READY);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ ok: false, ready: false });
    const ranges = rangesOf(from, days, o.exact === true);
    if (!ranges.length) return Promise.resolve(READY);
    const key = placeKey(point);
    prune();
    const usable = (x: Warm, r: Range) => !x.forgotten && x.place === key && x.from <= r.from && x.to >= r.to && !(o.fresh && x.done && !x.result?.ready);
    const ws = ranges.map((r) => warms.find((x) => usable(x, r)) ?? begin(point, key, r));
    if (ws.length === 1) return waitFor(ws[0], waitMs, o.all === true);
    return Promise.all(ws.map((w) => waitFor(w, waitMs, o.all === true))).then((rs) => ({ ok: rs.every((r) => r.ok), ready: rs.every((r) => r.ready) }));
  } catch {
    return Promise.resolve({ ok: false, ready: false });
  }
}

/** measures the usual-hours trips of `point` for `days` days from `from` (the page(s) of 14 days they fall in) before a
    screen asks for moments (the switch on; else at once). Resolves within `waitMs` of the start of that measure (0: at
    once); ready false → « pas encore mesuré ». Never throws. */
export function warmRoads(point: LatLng | null, from: string, days: number, waitMs = WARM_MS): Promise<{ ok: boolean; ready: boolean }> {
  return warm(point, from, days, waitMs);
}
/** « Réessayer »: what was remembered of this address is forgotten and it is measured again. A request under way for
    less than WARM_MS is shared; one a screen already gave up on (older) is replaced, its late answer ignored. */
export function retryRoads(point: LatLng | null, from: string = today(), days = MAX_DAYS, waitMs = WARM_MS): Promise<{ ok: boolean; ready: boolean }> {
  if (isPoint(point)) {
    const key = placeKey(point);
    const now = Date.now();
    for (let i = warms.length - 1; i >= 0; i--) {
      const x = warms[i];
      if (x.place === key && (x.done || now - x.begun >= WARM_MS)) { x.forgotten = true; warms.splice(i, 1); }
    }
  }
  return warm(point, from, days, waitMs);
}

/** what reached the server (now, or replayed from the outbox later) and changes where an appointment is or which day:
    its place is measured for its day, nobody waits (the server plans that day again with the real times when they
    come: drive_store). A booking, a move, and a change of an appointment's position (« Modifier », the locator). Never
    throws: it runs inside the sender. */
export function warmAfterSent(e: OutboxEntry): void {
  try {
    if (!e || !roadsOn.peek()) return;
    if (e.kind === 'rpc' && e.args) {
      if (e.rpc === 'book_job') {
        const j = (e.args.p_job || {}) as Partial<Job>;
        if (typeof j.id === 'string') warmJob(j.id, typeof j.day === 'string' ? j.day : null, j);
      } else if (e.rpc === 'move_job') {
        if (typeof e.args.p_job === 'string') warmJob(e.args.p_job, typeof e.args.p_day === 'string' ? e.args.p_day : null);
      } else if (e.rpc === 'set_truck_start') {
        // « Départ de ce camion » (null: back to « Départ des camions »)
        warmStart((e.args.p_start ?? settings.peek().booking.home) as Partial<LatLng> | null);
      }
    } else if (e.kind === 'update' && e.table === 'jobs' && typeof e.id === 'string' && e.values && ('lat' in e.values || 'lng' in e.values)) {
      warmJob(e.id, null, e.values as Partial<Job>);
    } else if (e.kind === 'update' && e.table === 'settings' && e.values && e.values.booking && typeof e.values.booking === 'object') {
      // « Départ des camions »: only when the start sent is not the one measured last by this phone (any booking save sends it)
      const home = (e.values.booking as { home?: Partial<LatLng> | null }).home;
      if (isPoint(home) && placeKey(home) !== homeWarmed) { homeWarmed = placeKey(home); warmStart(home); }
    }
  } catch { /* the sweep measures it later */ }
}
/** the start last measured after a « Départ des camions » save (one warm per start, not one per booking save) */
let homeWarmed: string | null = null;
/** a truck's start (or « Départ des camions ») changed and reached the server: the planner re-planned every coming day of
    it with the new start's trips not measured (each first and last leg = the unknown time), so they are measured at once
    for the two coming weeks, in the background (decision 7, final-guess G1-start); later days: the background sweep and
    the nightly job. Never throws. */
export function warmStart(point: Partial<LatLng> | null | undefined): void {
  try {
    if (!roadsOn.peek() || !isPoint(point)) return;
    void warm(point, today(), MAX_DAYS, 0, { fresh: true });
  } catch { /* the sweep measures it later */ }
}
/** the trips of one appointment's place for its day (its own position, else its customer's), in the background */
export function warmJob(jobId: string, day: string | null = null, sent: Partial<Job> = {}): void {
  try {
    if (!roadsOn.peek()) return;
    const j = getRow<Job>('jobs', jobId);
    const c = getRow<Customer>('customers', j?.customer_id ?? sent.customer_id ?? null);
    const lat = j?.lat ?? sent.lat ?? c?.lat ?? null, lng = j?.lng ?? sent.lng ?? c?.lng ?? null;
    warmPlace(lat != null && lng != null ? { lat, lng } : null, day ?? j?.day ?? sent.day ?? null);
  } catch { /* the sweep measures it later */ }
}
/** « exact move » (STATE.md A7, the owner's correction of 2026-11-21 20:25): the trips of an appointment's place (its own
    position, else its customer's) for the day it is moved to, measured BEFORE the move's preview and the move, waited at
    most `waitMs` from the start of that measure as the suggestions wait (a measure of that page already done is used, a
    failure remembered is not): so no measure lands seconds after the move and plans that day again. A measure still
    running then goes on and plans the day as usual. Switch off, no position, the demo: at once. Never throws. */
export function warmJobDay(jobId: string, day: string, waitMs = WARM_MS): Promise<Ready> {
  try {
    if (!roadsOn.peek()) return Promise.resolve(READY);
    const j = getRow<Job>('jobs', jobId);
    const c = getRow<Customer>('customers', j?.customer_id ?? null);
    const lat = j?.lat ?? c?.lat ?? null, lng = j?.lng ?? c?.lng ?? null;
    // the whole measure of that day (the rest too: its rush times, the other trips), so none of it lands during the
    // question or seconds after the move (review F6)
    return warm(lat != null && lng != null ? { lat, lng } : null, day, 1, waitMs, { exact: true, fresh: true, all: true });
  } catch {
    return Promise.resolve({ ok: false, ready: false });
  }
}
/** the trips of a place for one day, in the background (« Changer de client »: the appointment takes the new customer's
    address). A failure remembered for that place is not reused. Never throws. */
export function warmPlace(point: LatLng | null, day: string | null): void {
  try {
    if (!roadsOn.peek() || !point || !day) return;
    void warm(point, day, 1, 0, { exact: true, fresh: true });
  } catch { /* the sweep measures it later */ }
}

/* ---------- the settings panel and the sweep ---------- */
let sweep: Promise<DriveAnswer> | null = null;
/** « Mesurer maintenant » and the background sweep (services/roadsSweep.ts): everything missing over the coming days,
    in rounds, until nothing is left or a limit is reached (more: call again). One at a time on this device: a call while
    one is under way gets that one's answer (review-data H1). A refusal is an answer (ok false); no signal or no answer
    throws. */
export async function measureRoads(): Promise<DriveAnswer> {
  guard();
  if (!sweep) {
    roadsSweeping.value++;
    const mine: Promise<DriveAnswer> = (async () => {
      const a = driveAnswer(await limited(callFn('drive', { action: 'sweep' }, FN_MS)));
      if (a.ok) {
        if (a.planned > 0) void pull('jobs');
        if (a.stored > 0 || a.planned > 0) roadsTick.value++;
      }
      return a;
    })().finally(() => { if (sweep === mine) { sweep = null; roadsSweeping.value = Math.max(0, roadsSweeping.value - 1); } });
    sweep = mine;
  }
  return sweep;
}
/** where the measures stand (read only): the server's key, the switch, what is left, this month's spend */
export async function roadsStatus(): Promise<RoadsStatus> {
  return statusOf(await callFn('drive', { action: 'status' }, STATUS_MS));
}
/** the planner counts the real roads (on) or the estimate of before (off): owner, needs the network now (never kept for
    later), a new operation each tap. ON is refused (roads_cold) while a usual-hours trip of the coming days is not
    measured: measureRoads first. The answer has no rows: pull settings and jobs after it.
    `op`: the SAME operation asked again because its first answer was lost on the way (no signal, the server unwell): the
    server answers that first answer again (op_begin), with its list of customers to call, instead of « unchanged »
    (fix-settings R6). Without it, a new op. */
export async function roadsSwitch(on: boolean, op?: string): Promise<RoadsSwitchAnswer> {
  guard();
  const d = (await callRpc<RoadsSwitchAnswer>('roads_switch', { p_on: on, ...(op ? { p_op: op } : {}) }, { label: t('log.settings'), queue: false })).data;
  const r = (d && typeof d === 'object' ? d : {}) as Partial<RoadsSwitchAnswer>;
  return { ok: r.ok !== false, on: r.on === true, planned: num(r.planned), kept: kept(r.kept), late: ids(r.late), unchanged: r.unchanged === true };
}

/* ---------- what an action would do (nothing written; the action's own right and refusals) ---------- */
/** those appointments moved onto `truckId` that day (block null: each one's own block), as « La voiture ferme » sends them.
    `asTold`: preview the 5-argument move_job that « Changer de camion » taps (the window kept as told), not the 7-argument
    one (`p_as_told: true`, decided 2026-11-20: fix-sql.md « C »; sent only when true, so a server of before still answers).
    null: the server gave no preview (an older one, the demo). Throws the action's refusal, or no signal. */
export async function movePreview(truckId: string, day: string, block: BlockKey | null, jobIds: string[], o: { asTold?: boolean } = {}): Promise<MovePreview | null> {
  const args = { p_truck: truckId, p_day: day, p_block: block, p_jobs: jobIds, ...(o.asTold === true ? { p_as_told: true } : {}) };
  const d = (await callRpc<MovePreview>('move_preview', args, { noOp: true })).data;
  const r = (d && typeof d === 'object' ? d : null) as Partial<MovePreview> | null;
  if (!r || !Array.isArray(r.order)) return null;
  const eta: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(r.eta && typeof r.eta === 'object' ? r.eta : {})) eta[k] = numOrNull(v);
  // refused: job ids, or [{ id, code }] (then the codes are the reasons)
  const listed = (Array.isArray(r.refused) ? r.refused : []) as unknown[];
  const why: Record<string, string> = {};
  for (const x of listed) {
    const o = x as { id?: unknown; code?: unknown } | null;
    if (o && typeof o === 'object' && typeof o.id === 'string' && typeof o.code === 'string' && o.code) why[o.id] = o.code;
  }
  const refused = listed.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : null))
    .filter((x): x is string => x != null);
  const out: MovePreview = { order: ids(r.order), eta, refused, day_min: numOrNull(r.day_min), day_km: numOrNull(r.day_km), unmeasured: numOrNull(r.unmeasured) };
  if (r.refused_why && typeof r.refused_why === 'object' && !Array.isArray(r.refused_why)) {
    for (const [k, v] of Object.entries(r.refused_why)) if (typeof v === 'string' && v) why[k] = v;
  }
  if (Object.keys(why).length || (r.refused_why && typeof r.refused_why === 'object')) out.refused_why = why;
  return out;
}
/** the arrival each booked stop of that block would get with this order (an empty list: the planner's order). null: no
    preview from the server. Throws set_stop_order's refusal, or no signal. */
export async function stopOrderPreview(truckId: string, day: string, block: BlockKey, jobIds: string[]): Promise<StopEta[] | null> {
  const d = (await callRpc<StopEta[]>('stop_order_preview', { p_truck: truckId, p_day: day, p_block: block, p_jobs: jobIds }, { noOp: true })).data;
  if (!Array.isArray(d)) return null;
  return d.filter((x) => !!x && typeof x === 'object' && typeof x.id === 'string')
    .map((x) => ({ id: x.id, eta: numOrNull(x.eta), late: x.late === true, ...(typeof x.measured === 'boolean' ? { measured: x.measured } : {}) }));
}

/** tests only: forget every request remembered and every state */
export function resetRoads() { warms.length = 0; quiet = false; sweep = null; homeWarmed = null; places.value = {}; roadsTick.value = 0; roadsSweeping.value = 0; }
