/* The driver's phone asks the server for a new arrival time while it drives (tripRefresh.ts): every rule, with pretend
   timers, a pretend `enroute` and a pretend phone position. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import type { Trip, Job } from '../data/types';

/* ---------- the pretend app around the service ---------- */
const ME = 'u-adam';
const meSig = signal<{ id: string; trucks: string[] } | null>({ id: ME, trucks: ['t-1'] });
const previewSig = signal(false);
const shifts = signal<{ staff_id: string; ended_at: string | null; deleted_at?: string | null }[]>([]);
/** the phone's jobs (on my vehicle t-1 unless said) */
const jobs = signal<Map<string, Pick<Job, 'id' | 'status' | 'deleted_at'> & Partial<Pick<Job, 'truck_id' | 'day'>>>>(new Map());
const trips = signal<Trip[]>([]);
const netSig = signal({ online: true });

// the factories run before this file's variables exist: they are read when the service uses them
vi.mock('../data/auth', () => ({ get me() { return meSig; }, get preview() { return previewSig; } }));
vi.mock('../data/select', () => ({
  openShift: (id: string) => shifts.value.find((s) => s.staff_id === id && !s.ended_at && !s.deleted_at),
  job: (id: string) => { const j = jobs.value.get(id); return j && { truck_id: 't-1', ...j }; }
}));
vi.mock('../data/store', () => ({ rowsOf: (t: string) => (t === 'trips' ? trips.value : []) }));
vi.mock('../data/net', () => ({ get net() { return netSig; } }));
type Answer = { ok: boolean; code?: string; sms?: string; eta_at?: string | null; route_source?: string | null };
const enroute = vi.fn<(action: string, jobId: string | null, opts: Record<string, unknown>) => Promise<Answer>>();
vi.mock('../data/api', () => ({ enroute: (...a: [string, string | null, Record<string, unknown>]) => enroute(...a) }));
const refetch = vi.fn<(t: string, id: string) => Promise<'updated' | 'gone' | 'failed'>>();
const pull = vi.fn();
vi.mock('../data/sync', () => ({ refetch: (t: string, id: string) => refetch(t, id), pull: (t: string) => pull(t) }));
/** where the phone is (a fresh reading each time it is asked); null: the phone gives nothing */
let where: { lat: number; lng: number; accuracy: number | null } | null = null;
const quick = vi.fn(async () => (where ? { lat: where.lat, lng: where.lng } : undefined));
vi.mock('./position', async (orig) => ({
  ...(await orig<typeof import('./position')>()),
  quickPosition: () => quick(),
  lastReading: () => (where ? { ...where, at: Date.now() } : null)
}));

import { TRIP_RULES, tripUnderWay, drivenTrucks, mayAsk, movedEnough, roadStart, checkTrip, startTripRefresh, stopTripRefresh, tripRefreshed, type TripMemo } from './tripRefresh';

const T0 = Date.UTC(2026, 10, 24, 14, 0, 0);   // Tuesday 2026-11-24, 9 h in Montréal
const HOME = { lat: 45.5312898, lng: -73.6544639 };
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lng: HOME.lng });
const road = (from: { lat: number; lng: number }): [number, number][] => [[from.lat, from.lng], [from.lat + 0.01, from.lng], [from.lat + 0.02, from.lng + 0.01]];
function tripRow(p: Partial<Trip> = {}): Trip {
  return {
    id: 'tr-1', job_id: 'j-1', kind: 'job', staff_id: ME, status: 'active', started_at: new Date(T0).toISOString(), ended_at: null,
    eta_at: new Date(T0 + 25 * 60_000).toISOString(), km: 12, minutes: 25, route: road(HOME), dest_lat: 45.45, dest_lng: -73.47,
    sms_status: 'sent', expires_at: new Date(T0 + 4 * 3600_000).toISOString(), dest_label: null, ...p
  } as Trip;
}
const MIN = 60_000;
let visibility: DocumentVisibilityState = 'visible';
const setVisible = (v: boolean) => { visibility = v ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };
/** the pretend server's `refresh`: a new time; the trip row of the phone follows (as callFn's rows do) */
function serverAnswers(minutes = 18) {
  enroute.mockImplementation(async (_a, _j, opts) => {
    const eta = new Date(Date.now() + minutes * MIN).toISOString();
    const pos = opts.pos as { lat: number; lng: number };
    trips.value = trips.value.map((t) => (t.id === 'tr-1' ? { ...t, eta_at: eta, route: road(pos) } : t));
    return { ok: true, sms: 'already', eta_at: eta, route_source: 'tomtom' };
  });
}
const calls = () => enroute.mock.calls.length;
/** the trip under way, the day started, the app on the screen, the phone at the Centrale */
function onTheRoad(p: Partial<Trip> = {}) {
  shifts.value = [{ staff_id: ME, ended_at: null }];
  jobs.value = new Map([['j-1', { id: 'j-1', status: 'en_route', deleted_at: null }]]);
  trips.value = [tripRow(p)];
  where = { ...HOME, accuracy: 10 };
}
/** drive north at `mPerMin` metres a minute for `min` minutes (one minute at a time, the service's timer runs) */
async function drive(min: number, mPerMin = 500) {
  for (let i = 0; i < min; i++) {
    const from = where ? where.lat : HOME.lat;
    where = { lat: from + mPerMin / 111_195, lng: HOME.lng, accuracy: 10 };
    await vi.advanceTimersByTimeAsync(MIN);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  try { localStorage.clear(); } catch { /* none */ }
  meSig.value = { id: ME, trucks: ['t-1'] }; previewSig.value = false; netSig.value = { online: true };
  shifts.value = []; jobs.value = new Map(); trips.value = []; where = null;
  enroute.mockReset(); refetch.mockReset(); pull.mockReset(); quick.mockClear();
  refetch.mockResolvedValue('updated');
  serverAnswers();
});
afterEach(() => { stopTripRefresh(); vi.restoreAllMocks(); vi.useRealTimers(); });

/* ---------- the rules (pure) ---------- */
describe('the trip this phone refreshes', () => {
  const job = (status: Job['status']) => () => ({ status, deleted_at: null });
  it('is my own trip to a job that is « En route », still on and not expired', () => {
    expect(tripUnderWay([tripRow()], job('en_route'), ME, T0)?.id).toBe('tr-1');
  });
  it('never the trip back to the Centrale (the server cannot refresh it), another person\'s, a closed or expired one', () => {
    expect(tripUnderWay([tripRow({ kind: 'return', job_id: null })], job('en_route'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow({ kind: 'return' })], job('en_route'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow({ staff_id: 'u-saleh' })], job('en_route'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow({ status: 'arrived' })], job('en_route'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow({ status: 'cancelled' })], job('en_route'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow({ deleted_at: new Date(T0).toISOString() })], job('en_route'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow()], job('en_route'), ME, T0 + 4 * 3600_000)).toBeNull();
  });
  it('never once the job is no longer « En route » (arrived, cancelled) or unknown to the phone', () => {
    expect(tripUnderWay([tripRow()], job('on_site'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow()], job('cancelled'), ME, T0)).toBeNull();
    expect(tripUnderWay([tripRow()], () => undefined, ME, T0)).toBeNull();
    // a job deleted meanwhile (review-trip F4 M7)
    expect(tripUnderWay([tripRow()], () => ({ status: 'en_route', deleted_at: new Date(T0).toISOString() }), ME, T0)).toBeNull();
  });
  it('the newest one when the copy holds two', () => {
    const old = tripRow({ id: 'tr-0', started_at: new Date(T0 - 30 * MIN).toISOString() });
    expect(tripUnderWay([old, tripRow()], job('en_route'), ME, T0)?.id).toBe('tr-1');
    expect(tripUnderWay([tripRow(), old], job('en_route'), ME, T0)?.id).toBe('tr-1');
  });
});

describe('may the phone ask now', () => {
  const m = (n: number, at: number): TripMemo => ({ n, at, from: HOME });
  const on = { visible: true, online: true };
  it('5 minutes at least between two (« Je pars » is the first time)', () => {
    expect(mayAsk(m(0, T0), T0 + 5 * MIN - 1, on)).toBe('soon');
    expect(mayAsk(m(0, T0), T0 + 5 * MIN, on)).toBe('go');
  });
  it('8 a trip at most', () => {
    expect(mayAsk(m(7, T0), T0 + 10 * MIN, on)).toBe('go');
    expect(mayAsk(m(8, T0), T0 + 10 * MIN, on)).toBe('spent');
    expect(TRIP_RULES.maxPerTrip).toBe(8);
  });
  it('never offline, never with the app off the screen', () => {
    expect(mayAsk(m(0, T0), T0 + 10 * MIN, { visible: true, online: false })).toBe('offline');
    expect(mayAsk(m(0, T0), T0 + 10 * MIN, { visible: false, online: true })).toBe('hidden');
  });
});

describe('has the phone moved enough', () => {
  const m: TripMemo = { n: 0, at: T0, from: HOME };
  const fix = (p: { lat: number; lng: number }, accuracy: number | null = 10, at = T0) => ({ ...p, accuracy, at });
  it('300 m or more from where the last time was worked out', () => {
    expect(movedEnough(m, fix(north(290)), T0)).toBe('still');
    expect(movedEnough(m, fix(north(310)), T0)).toBe('go');
  });
  it('no reading, an old one, or a vague one (cell towers) never counts', () => {
    expect(movedEnough(m, null, T0)).toBe('no_fix');
    expect(movedEnough(m, fix(north(900), 10, T0 - 2 * MIN), T0)).toBe('no_fix');
    expect(movedEnough(m, fix(north(900), 800), T0)).toBe('vague');
    expect(movedEnough(m, fix(north(900), null), T0)).toBe('go');
  });
  it('no place known yet (the server never had a road for this trip: no real time to keep): « first », no move needed', () => {
    expect(movedEnough({ ...m, from: null }, fix(north(900)), T0)).toBe('first');
  });
  it('the place of the last time is the start of the server\'s road; two points are not a road', () => {
    expect(roadStart({ route: road(HOME) })).toEqual(HOME);
    expect(roadStart({ route: [[HOME.lat, HOME.lng], [45.45, -73.47]] })).toBeNull();
    expect(roadStart({ route: null })).toBeNull();
  });
});

/* ---------- the service, with pretend timers ---------- */
describe('while I drive to a job', () => {
  it('asks nothing in the first 5 minutes, then a new time once I moved 300 m; never a text', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(4);
    expect(calls()).toBe(0);
    await drive(1);
    expect(calls()).toBe(1);
    const [action, jobId, opts] = enroute.mock.calls[0];
    expect(action).toBe('refresh');
    expect(jobId).toBe('j-1');
    // the server sends no text on this path, and `notify: false` makes sure of it even if it had to make a new trip
    expect(opts.notify).toBe(false);
    expect(opts.resend).toBeUndefined();
    expect(opts.driver_id).toBe(ME);
    expect(opts.pos).toEqual({ lat: where!.lat, lng: where!.lng });
    expect(tripRefreshed.value).toMatchObject({ tripId: 'tr-1', road: true });
    expect(trips.value[0].eta_at).toBe(new Date(T0 + 5 * MIN + 18 * MIN).toISOString());
  });
  it('at most every 5 minutes and 8 times a trip, however long it drives', async () => {
    onTheRoad({ expires_at: new Date(T0 + 8 * 3600_000).toISOString() });
    startTripRefresh();
    const at: number[] = [];
    enroute.mockImplementation(async () => { at.push(Date.now()); return { ok: true, sms: 'already', route_source: 'tomtom' }; });
    await drive(90);
    expect(calls()).toBe(8);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(5 * MIN);
    expect(at[0] - T0).toBeGreaterThanOrEqual(5 * MIN);
  });
  it('stuck in traffic (less than 300 m since the last time): nothing asked', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(12, 20);   // 240 m in 12 minutes
    expect(calls()).toBe(0);
    await drive(1, 100);   // 340 m now
    expect(calls()).toBe(1);
    // the next one counts from where that time was worked out
    await drive(6, 40);
    expect(calls()).toBe(1);
    await drive(2, 40);
    expect(calls()).toBe(2);
  });
  it('a vague reading (cell towers) or no reading at all: nothing asked', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(6);
    expect(calls()).toBe(1);
    where = { ...north(5000), accuracy: 900 };
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(calls()).toBe(1);
    where = null;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(calls()).toBe(1);
  });
  it('never offline: the first minute back online asks again', async () => {
    onTheRoad();
    startTripRefresh();
    netSig.value = { online: false };
    await drive(15);
    expect(calls()).toBe(0);
    expect(refetch).not.toHaveBeenCalled();
    netSig.value = { online: true };
    await drive(1);
    expect(calls()).toBe(1);
  });
  it('the browser saying offline is enough', async () => {
    onTheRoad();
    const nav = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    startTripRefresh();
    await drive(10);
    expect(calls()).toBe(0);
    nav.mockReturnValue(true);
    await drive(1);
    expect(calls()).toBe(1);
  });
  it('the app off the screen: no timer at all; back on the screen: one look at once', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(2);
    setVisible(false);
    expect(vi.getTimerCount()).toBe(0);
    where = { ...north(8000), accuracy: 10 };
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(calls()).toBe(0);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });
  it('stops when the trip ends (« Je suis arrivé »): no timer, nothing asked', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(6);
    expect(calls()).toBe(1);
    jobs.value = new Map([['j-1', { id: 'j-1', status: 'on_site', deleted_at: null }]]);
    trips.value = [tripRow({ status: 'arrived' })];
    expect(vi.getTimerCount()).toBe(0);
    await drive(30);
    expect(calls()).toBe(1);
  });
  it('stops when the day ends (the trips are closed by the server then)', async () => {
    onTheRoad();
    startTripRefresh();
    shifts.value = [{ staff_id: ME, ended_at: new Date(T0).toISOString() }];
    await drive(20);
    expect(calls()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a new trip (the next job) starts its own count', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(6);
    expect(calls()).toBe(1);
    jobs.value = new Map([['j-1', { id: 'j-1', status: 'done', deleted_at: null }], ['j-2', { id: 'j-2', status: 'en_route', deleted_at: null }]]);
    trips.value = [tripRow({ status: 'arrived' }), tripRow({ id: 'tr-2', job_id: 'j-2', route: road(where!), started_at: new Date(Date.now()).toISOString() })];
    await drive(4);
    expect(calls()).toBe(1);
    await drive(1);
    expect(calls()).toBe(2);
    expect(enroute.mock.calls[1][1]).toBe('j-2');
  });
});

describe('never for a trip that is not mine to refresh', () => {
  it('not before my day is started (the same rule as sharing my position)', async () => {
    onTheRoad();
    shifts.value = [];
    startTripRefresh();
    await drive(20);
    expect(calls()).toBe(0);
  });
  it('not in « Voir l\'app comme… »', async () => {
    onTheRoad();
    previewSig.value = true;
    startTripRefresh();
    await drive(20);
    expect(calls()).toBe(0);
  });
  it('not another mechanic\'s trip, not the trip back to the Centrale', async () => {
    onTheRoad({ staff_id: 'u-saleh' });
    startTripRefresh();
    await drive(20);
    trips.value = [tripRow({ kind: 'return', job_id: null })];
    await drive(20);
    expect(calls()).toBe(0);
  });
});

describe('a refresh that fails changes nothing', () => {
  it('no answer (weak signal): the last real time stays, it counted, the next try 5 minutes later', async () => {
    onTheRoad();
    const before = tripRow().eta_at;
    enroute.mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch'), { code: 'network' }));
    startTripRefresh();
    await drive(5);
    expect(calls()).toBe(1);
    expect(trips.value[0].eta_at).toBe(before);
    expect(tripRefreshed.value).toBeNull();
    await drive(4);
    expect(calls()).toBe(1);
    await drive(1);
    expect(calls()).toBe(2);
  });
  it('the server found no road (TomTom and OSRM down): nothing written, the next try still from the old place', async () => {
    onTheRoad();
    const before = tripRow().eta_at;
    enroute.mockResolvedValueOnce({ ok: true, sms: 'already', eta_at: before, route_source: null });
    startTripRefresh();
    await drive(5);
    expect(calls()).toBe(1);
    expect(trips.value[0].eta_at).toBe(before);
    expect(tripRefreshed.value).toMatchObject({ road: false, etaAt: before });
    // standing still from now on: still 300 m from where the last REAL time was worked out (the Centrale), so tried again
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(calls()).toBe(2);
  });
  it('a refusal of the server (an error): nothing changes, tried again later', async () => {
    onTheRoad();
    enroute.mockResolvedValueOnce({ ok: false, code: 'server' });
    startTripRefresh();
    await drive(5);
    await drive(5);
    expect(calls()).toBe(2);
  });
  it.each(['not_en_route', 'not_found', 'no_trip'])('the trip is over on the server (%s): never asked again for it', async (code) => {
    onTheRoad();
    enroute.mockResolvedValue({ ok: false, code });
    startTripRefresh();
    await drive(30);
    expect(calls()).toBe(1);
    expect(pull).toHaveBeenCalledWith('trips');
  });
  it('the trip closed on the server meanwhile (read again just before): never asked, so never made again', async () => {
    onTheRoad();
    refetch.mockImplementation(async () => { trips.value = [tripRow({ status: 'cancelled' })]; return 'updated'; });
    startTripRefresh();
    await drive(30);
    expect(refetch).toHaveBeenCalledWith('trips', 'tr-1');
    expect(calls()).toBe(0);
  });
  it('the trip gone from the server: never asked again', async () => {
    onTheRoad();
    refetch.mockResolvedValue('gone');
    startTripRefresh();
    await drive(30);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(0);
  });
  it('the server could not be read just before: nothing asked, and it did not count', async () => {
    onTheRoad({ expires_at: new Date(T0 + 8 * 3600_000).toISOString() });
    refetch.mockResolvedValueOnce('failed');
    startTripRefresh();
    await drive(5);
    expect(calls()).toBe(0);
    await drive(1);
    expect(calls()).toBe(1);
    await drive(80);
    expect(calls()).toBe(8);
  });
});

describe('the count is kept on the phone', () => {
  it('the app opened again in the middle of the trip: still 8 at most, still 5 minutes after the last one', async () => {
    onTheRoad({ expires_at: new Date(T0 + 8 * 3600_000).toISOString() });
    startTripRefresh();
    await drive(26);
    expect(calls()).toBe(5);
    // the app is closed and opened again (memory lost, the phone's storage kept)
    stopTripRefresh();
    startTripRefresh();
    await drive(1);
    expect(calls()).toBe(5);
    await drive(80);
    expect(calls()).toBe(8);
    // no position is kept on the phone, only the count and the time
    expect(localStorage.getItem('his.tripRefresh')).not.toMatch(/45\.|73\./);
  });
  it('the phone cannot keep it (private window): the service still works in memory', async () => {
    onTheRoad();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    startTripRefresh();
    await drive(6);
    expect(calls()).toBe(1);
  });
});

/* ---------- rules the build report claims, each with a test of its own now (review-trip F4: these mutants survived) ---------- */
describe('battery and one request at a time', () => {
  it('a trip that only expires (no row changes): the timer stops at the next look (M6)', async () => {
    onTheRoad({ expires_at: new Date(T0 + 3 * MIN).toISOString() });
    startTripRefresh();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(vi.getTimerCount()).toBe(0);
    expect(calls()).toBe(0);
  });
  it('two looks at once (the app back on the screen while the minute ticks): one request, never two (R9)', async () => {
    onTheRoad();
    startTripRefresh();                       // the first look: « Je pars » just now, nothing asked
    vi.setSystemTime(T0 + 6 * MIN);
    where = { ...north(1000), accuracy: 10 };
    await Promise.all([checkTrip(), checkTrip()]);
    expect(calls()).toBe(1);
  });
  it('started twice, stopped once: nothing runs any more (M8)', async () => {
    startTripRefresh();
    startTripRefresh();
    stopTripRefresh();
    onTheRoad();
    await drive(20);
    expect(vi.getTimerCount()).toBe(0);
    expect(calls()).toBe(0);
  });
});

describe('right before the request', () => {
  it('the phone went offline while the trip was read again: nothing asked (M4)', async () => {
    onTheRoad();
    refetch.mockImplementationOnce(async () => { netSig.value = { online: false }; return 'updated'; });
    startTripRefresh();
    await drive(6);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(0);
  });
  it('the app left the screen while the trip was read again: nothing asked (M4)', async () => {
    onTheRoad();
    refetch.mockImplementationOnce(async () => { setVisible(false); return 'updated'; });
    startTripRefresh();
    await drive(6);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(0);
    setVisible(true);
  });
  it('the trip read again is no longer THE one (« Défaire » then « Je pars » again: a new trip for the same job): not asked for the old one (M11)', async () => {
    onTheRoad();
    refetch.mockImplementationOnce(async () => {
      trips.value = [tripRow({ status: 'cancelled' }), tripRow({ id: 'tr-1b', started_at: new Date(Date.now()).toISOString(), route: road(where!) })];
      return 'updated';
    });
    startTripRefresh();
    await drive(5);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(0);
    // the new trip has its own 5 minutes, from the first look at it (the next minute: the look at minute 5 was busy)
    await drive(5);
    expect(calls()).toBe(0);
    await drive(1);
    expect(calls()).toBe(1);
    expect(enroute.mock.calls[0][1]).toBe('j-1');
  });
});

describe('what the phone keeps', () => {
  it('after the server said the trip is over: never asked again, also after the app is opened again (M5)', async () => {
    onTheRoad();
    enroute.mockResolvedValue({ ok: false, code: 'not_en_route' });
    startTripRefresh();
    await drive(6);
    expect(calls()).toBe(1);
    stopTripRefresh();
    startTripRefresh();
    await drive(30);
    expect(calls()).toBe(1);
  });
  it('a time kept in the future (the phone’s clock was put back): the trip is not blocked (M1)', async () => {
    localStorage.setItem('his.tripRefresh', JSON.stringify({ 'tr-1': { n: 1, at: T0 + 2 * 3600_000 } }));
    onTheRoad();
    startTripRefresh();
    await drive(5);
    expect(calls()).toBe(1);
  });
  it('what is older than a day is forgotten; the rest stays (M9)', async () => {
    localStorage.setItem('his.tripRefresh', JSON.stringify({ old: { n: 3, at: T0 - 25 * 3600_000 }, recent: { n: 2, at: T0 - 3600_000 } }));
    onTheRoad();
    startTripRefresh();
    await drive(5);
    expect(calls()).toBe(1);
    const kept = JSON.parse(localStorage.getItem('his.tripRefresh') || '{}') as Record<string, unknown>;
    expect(Object.keys(kept).sort()).toEqual(['recent', 'tr-1']);
  });
});

/* ---------- review-trip F5, F7, F8, F9 (low): each failing first, then fixed ---------- */
describe('two copies of the app on one phone (a Safari tab and the home-screen app share its storage) (F5)', () => {
  it('one trip: still 8 at most, never two closer than 5 minutes', async () => {
    onTheRoad({ expires_at: new Date(T0 + 8 * 3600_000).toISOString() });
    vi.resetModules();
    const B = await import('./tripRefresh');
    const at: number[] = [];
    enroute.mockImplementation(async () => { at.push(Date.now()); return { ok: true, sms: 'already', route_source: 'tomtom' }; });
    await checkTrip(); await B.checkTrip();          // both see the trip at « Je pars »
    for (let i = 0; i < 18; i++) {
      await drive(5);
      await checkTrip();                              // copy A on the screen
      await drive(1);
      await B.checkTrip();                            // copy B a minute later
    }
    expect(at.length).toBeGreaterThan(0);
    expect(at.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(5 * MIN);
    B.stopTripRefresh();
  });
  it('the other copy just asked (its count is in the phone’s storage): this one waits 5 minutes from it', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(4);
    localStorage.setItem('his.tripRefresh', JSON.stringify({ 'tr-1': { n: 7, at: Date.now() } }));
    await drive(4);
    expect(calls()).toBe(0);
    await drive(1);
    expect(calls()).toBe(1);
    await drive(30);
    expect(calls()).toBe(1);                          // 7 + this one = 8
  });
});

describe('two copies of the app: the other one asks at the same time (F5)', () => {
  it('it asked before this look: neither the position nor the server is asked', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(4);
    const q = quick.mock.calls.length;
    localStorage.setItem('his.tripRefresh', JSON.stringify({ 'tr-1': { n: 1, at: T0 + 30_000 } }));
    await drive(1);
    expect(quick.mock.calls.length).toBe(q);
    expect(refetch).not.toHaveBeenCalled();
    expect(calls()).toBe(0);
  });
  it('it asked while this one read the server: this one does not ask too', async () => {
    onTheRoad();
    refetch.mockImplementationOnce(async () => {
      localStorage.setItem('his.tripRefresh', JSON.stringify({ 'tr-1': { n: 1, at: Date.now() } }));
      return 'updated';
    });
    startTripRefresh();
    await drive(5);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(0);
    await drive(4);
    expect(calls()).toBe(0);
    await drive(1);
    expect(calls()).toBe(1);
  });
});

describe('« Renvoyer le texto en route » (the same trip, a new road and time from where the truck is) (F7)', () => {
  it('the 5 minutes and the 300 m count from the resend, not from « Je pars »', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(4);                                   // 2 km from the Centrale
    await vi.advanceTimersByTimeAsync(30_000);
    trips.value = [tripRow({ route: road(where!), eta_at: new Date(Date.now() + 20 * MIN).toISOString() })];
    await vi.advanceTimersByTimeAsync(10 * MIN);      // standing still where the resend's road starts
    expect(calls()).toBe(0);
    await drive(1, 400);                              // 400 m from there, 5 minutes after the phone saw the new road
    expect(calls()).toBe(1);
  });
  it('driving on after the resend: nothing asked (not even the server) until 5 minutes after the phone saw it', async () => {
    onTheRoad();
    startTripRefresh();
    await drive(4);
    await vi.advanceTimersByTimeAsync(30_000);
    trips.value = [tripRow({ route: road(where!), eta_at: new Date(Date.now() + 20 * MIN).toISOString() })];
    await drive(4, 400);                              // the look at minute 5 sees the new road
    expect(calls()).toBe(0);
    expect(refetch).not.toHaveBeenCalled();
    await drive(1, 400);
    expect(calls()).toBe(0);
    await drive(1, 400);                              // minute 10
    expect(calls()).toBe(1);
  });
  it('a refresh of its own is not a resend: driving on, one every 5 minutes exactly', async () => {
    onTheRoad();
    startTripRefresh();
    const at: number[] = [];
    enroute.mockImplementation(async (_a, _j, opts) => {
      at.push(Date.now());
      const pos = opts.pos as { lat: number; lng: number };
      // the server's road starts on the street near the phone, not on the phone itself
      trips.value = trips.value.map((t) => (t.id === 'tr-1' ? { ...t, route: road({ lat: pos.lat + 0.0002, lng: pos.lng }) } : t));
      return { ok: true, sms: 'already', route_source: 'tomtom' };
    });
    await drive(16);
    expect(at.map((x) => (x - T0) / MIN)).toEqual([5, 10, 15]);
  });
});

describe('whose position: only a trip to a stop of the vehicles this person drives (F8)', () => {
  it('the vehicles: mine; with several (« Routes partagées »), the route I said I do', () => {
    expect(drivenTrucks(['t-1'], null)).toEqual(['t-1']);
    expect(drivenTrucks(['t-1', 't-2'], null)).toEqual(['t-1', 't-2']);
    expect(drivenTrucks(['t-1', 't-2'], 't-2')).toEqual(['t-2']);
    expect(drivenTrucks(['t-1', 't-2'], 't-9')).toEqual(['t-1', 't-2']);
    const job = (truck_id: string | null) => () => ({ status: 'en_route' as const, deleted_at: null, truck_id });
    expect(tripUnderWay([tripRow()], job('t-9'), ME, T0, ['t-1'])).toBeNull();
    expect(tripUnderWay([tripRow()], job(null), ME, T0, ['t-1'])).toBeNull();
    expect(tripUnderWay([tripRow()], job('t-1'), ME, T0, ['t-1'])?.id).toBe('tr-1');
  });
  it('a stop left « En route » (« Je suis arrivé » forgotten) and the next one: the newest trip, the one being driven', async () => {
    onTheRoad();
    jobs.value = new Map([...jobs.value, ['j-2', { id: 'j-2', status: 'en_route', deleted_at: null }]]);
    startTripRefresh();
    await drive(2);
    trips.value = [...trips.value, tripRow({ id: 'tr-2', job_id: 'j-2', started_at: new Date(Date.now()).toISOString(), route: road(where!) })];
    await drive(30);
    const asked = enroute.mock.calls.map((c) => c[1]);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((j) => j === 'j-2')).toBe(true);
  });
  it('a newer trip the server gave me for ANOTHER vehicle’s stop (I pressed « Je pars » for it): my own customer is the one refreshed', async () => {
    onTheRoad();
    jobs.value = new Map([...jobs.value, ['j-9', { id: 'j-9', status: 'en_route', deleted_at: null, truck_id: 't-9' }]]);
    startTripRefresh();
    await drive(2);
    trips.value = [...trips.value, tripRow({ id: 'tr-9', job_id: 'j-9', started_at: new Date(Date.now()).toISOString(), route: road(where!) })];
    await drive(40);
    const asked = enroute.mock.calls.map((c) => c[1]);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((j) => j === 'j-1')).toBe(true);
  });
  it('my only trip is for another vehicle’s stop while I work at mine: never refreshed from where I am', async () => {
    shifts.value = [{ staff_id: ME, ended_at: null }];
    jobs.value = new Map([['j-1', { id: 'j-1', status: 'on_site', deleted_at: null }], ['j-9', { id: 'j-9', status: 'en_route', deleted_at: null, truck_id: 't-9' }]]);
    trips.value = [tripRow({ id: 'tr-9', job_id: 'j-9' })];
    where = { ...HOME, accuracy: 10 };
    startTripRefresh();
    await drive(30);
    expect(calls()).toBe(0);
  });
  it('« Routes partagées »: the route I said I do decides (« La route que je fais »)', async () => {
    const { setMyRoute } = await import('./position');
    meSig.value = { id: ME, trucks: ['t-1', 't-2'] };
    onTheRoad();
    jobs.value = new Map([...jobs.value, ['j-2', { id: 'j-2', status: 'en_route', deleted_at: null, truck_id: 't-2' }]]);
    trips.value = [...trips.value, tripRow({ id: 'tr-2', job_id: 'j-2', started_at: new Date(T0 - MIN).toISOString() })];
    setMyRoute('t-2');
    try {
      startTripRefresh();
      await drive(20);
      const asked = enroute.mock.calls.map((c) => c[1]);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((j) => j === 'j-2')).toBe(true);
    } finally { setMyRoute(null); }
  });
});

describe('a trip with NO time (no road at « Je pars »: TomTom and OSRM did not answer) (F9)', () => {
  it('no reading when the phone first saw it: its first time at minute 5, even standing still', async () => {
    onTheRoad({ route: null, eta_at: null });
    where = null;
    startTripRefresh();
    where = { ...HOME, accuracy: 10 };
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(calls()).toBe(1);
  });
  it('a reading when it first saw it: the same, minute 5 (stuck in traffic)', async () => {
    onTheRoad({ route: null, eta_at: null });
    startTripRefresh();
    await drive(5, 50);
    expect(calls()).toBe(1);
  });
  it('once a refresh brought a road: the next needs 300 m again', async () => {
    onTheRoad({ route: null, eta_at: null });
    startTripRefresh();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(calls()).toBe(1);
  });
  it('a refresh that brought no road either: tried again 5 minutes later, still 8 at most', async () => {
    onTheRoad({ route: null, eta_at: null, expires_at: new Date(T0 + 8 * 3600_000).toISOString() });
    enroute.mockResolvedValue({ ok: true, sms: 'already', eta_at: null, route_source: null });
    startTripRefresh();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(90 * MIN);
    expect(calls()).toBe(8);
  });
});
