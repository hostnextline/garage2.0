/* The demo's « Vraies routes » (dev only): the pretend function « drive » and roads_switch answer like the real ones
   (CONTRACT §2.5 §3), the suggestions carry the new fields with the switch on, and the demo never asks TomTom. */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, rpcOf, fnOf, find, put, table, installFakeServer, neverAsked, type DemoRow } from './fake-server';
import { loadDemoData } from './demo-data';
import './demo-rpc';
import { load as loadAgenda } from './demo-extra/agenda';
import { load as loadRoads, installRoads, resetRoadsDemo, left, wanted, pretend, tripOf, DEMO_DAYS } from './demo-extra/roads';
import { HOME } from './demo-extra/agenda';
import { installWindows } from './demo-windows';
import { addDays, today } from '../lib/dates';
import { tomtomKeyFor } from '../lib/config';
import { measureRoads, roadsStatus, resetRoads } from '../data/roads';

type Answer = Record<string, unknown> & { rows?: Record<string, DemoRow[]> };
const rpc = async (name: string, args: Record<string, unknown>) => (await rpcOf(name)!(args)) as Answer;
const drive = async (body: Record<string, unknown>) => (await fnOf('drive')!(body)) as Answer;
const code = async (fn: () => unknown) => { try { await fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const D = (n: number) => addDays(today(), n);
function start(search: string, user = 'u-hassan') {
  for (const k of Object.keys(db)) delete db[k];
  history.replaceState(null, '', '/' + search);
  (globalThis as { __demoUser?: string }).__demoUser = user;
  resetRoadsDemo();
  loadDemoData();
  loadAgenda();
  loadRoads();
  installWindows();
  installRoads();
}
const roadsOn = () => (find('settings', '1')!.booking as Record<string, unknown>).roads_on === true;
/** « Mesurer maintenant »: the sweep while it says more */
async function sweepAll(): Promise<Answer[]> {
  const out: Answer[] = [];
  for (let i = 0; i < 50; i++) { const a = await drive({ action: 'sweep' }); out.push(a); if (!a.ok || !a.more) break; }
  return out;
}
/** a coming working day of the demo's week with appointments (Monday to Friday) */
const busyDay = () => [1, 2, 3, 4, 5, 6].map(D).find((d) => table('jobs').filter((j) => j.day === d && j.status === 'booked' && j.truck_id).length >= 1 && ![0, 6].includes(new Date(d + 'T12:00').getDay()))!;

describe('demo: the pretend function « drive »', () => {
  beforeEach(() => start('?demo=owner'));
  it('status: the key, the switch, what is left (all and usual hours), the month; nothing measured at first', async () => {
    const s = await drive({ action: 'status' });
    expect(s.ok).toBe(true);
    expect([s.key, s.on]).toEqual([true, false]);
    expect(Number(s.left0)).toBeGreaterThan(0);
    expect(Number(s.left)).toBe(Number(s.left0));
    expect(s.month).toMatchObject({ tx: 0, cap: 10000 });
  });
  it('sweep in rounds: « more » until the usual hours are measured, then the rush hours; TomTom transactions counted', async () => {
    const rounds = await sweepAll();
    expect(rounds.length).toBeGreaterThan(1);
    expect(rounds.slice(0, -1).every((r) => r.more === true)).toBe(true);
    const last = rounds[rounds.length - 1];
    expect([last.ok, last.ready, last.left, last.left0, last.more, last.tomtom]).toEqual([true, true, 0, 0, false, 'ok']);
    expect(rounds.reduce((n, r) => n + Number(r.stored), 0)).toBeGreaterThan(Number(rounds[0].stored));
    expect(Number((last.spent as { tx: number }).tx)).toBeGreaterThan(0);
    expect(left()).toEqual({ left: 0, left0: 0 });
  });
  it('warm « only: point »: the point’s usual-hours trips with every place of those days, nothing else', async () => {
    const before = left();
    const p = { lat: 45.55, lng: -73.6 };
    const a = await drive({ action: 'warm', point: p, from: today(), days: 14, only: 'point' });
    expect([a.ok, a.ready, a.more]).toEqual([true, true, false]);
    expect(Number(a.stored)).toBeGreaterThan(0);
    expect(wanted(p).slot0.filter((x) => x.extra).length).toBe(0);
    // the other trips were not measured by it
    expect(left().left0).toBe(before.left0);
    expect((await drive({ action: 'warm', point: { lat: 47.5, lng: -71 } })).code).toBe('far');
  });
  it('the switch: owner only, true or false, roads_cold while a usual-hours trip is missing; then on, no rows (the screen pulls)', async () => {
    expect(await code(() => rpc('roads_switch', { p_on: 'yes' }))).toBe('bad_mode');
    expect(await code(() => rpc('roads_switch', { p_on: true }))).toBe('roads_cold');
    expect(roadsOn()).toBe(false);
    await sweepAll();
    const a = await rpc('roads_switch', { p_on: true });
    expect([a.ok, a.on, Array.isArray(a.kept), Array.isArray(a.late), typeof a.planned, a.rows]).toEqual([true, true, true, true, 'number', undefined]);
    expect(roadsOn()).toBe(true);
    expect(await rpc('roads_switch', { p_on: true })).toMatchObject({ ok: true, unchanged: true, on: true, planned: 0 });
    // off: back to the estimate of before, the travel times of before put back
    const off = await rpc('roads_switch', { p_on: false });
    expect([off.ok, off.on]).toEqual([true, false]);
    expect(roadsOn()).toBe(false);
  });
  it('on: the arrivals follow the measured trips (the stop before + the trip), and a block that no longer fits is « kept »', async () => {
    await sweepAll();
    const day = busyDay();
    await rpc('roads_switch', { p_on: true });
    const js = table('jobs').filter((j) => j.day === day && j.block === 'am' && j.status === 'booked' && j.truck_id).sort((a, b) => Number(a.stop_order) - Number(b.stop_order));
    if (js.length) {
      const first = js[0];
      expect(Number(first.eta_min)).toBe(480 + Number(first.travel_min));
    }
    // a pretend morning made too long: kept, its late customers listed
    const id = table('jobs').find((j) => j.day === day && j.status === 'booked' && j.truck_id)!.id;
    put('jobs', { id, duration_min: 600 });
    await rpc('roads_switch', { p_on: false });
    const again = await rpc('roads_switch', { p_on: true });
    expect((again.kept as unknown[]).length).toBeGreaterThan(0);
  });
  it('someone else than the owner: the switch is refused; a mechanic may not sweep', async () => {
    start('?demo=office', 'u-office');
    expect(await code(() => rpc('roads_switch', { p_on: true }))).toBe('not_allowed');
    expect((await drive({ action: 'sweep' })).ok).toBe(true);
    start('?demo=mechanic', 'u-saleh');
    expect((await drive({ action: 'sweep' })).code).toBe('not_allowed');
    expect((await drive({ action: 'status' })).ok).toBe(true);
  });
});

describe('demo: what the pretend server answers (&tomtom=…)', () => {
  it('nokey: no key, measured by OSRM without traffic, the rush hours never (left > 0, more false); the switch still goes on', async () => {
    start('?demo=owner&tomtom=nokey');
    expect((await drive({ action: 'status' })).key).toBe(false);
    const rounds = await sweepAll();
    const last = rounds[rounds.length - 1];
    expect([last.tomtom, last.osrm, last.left0, last.more]).toEqual(['no_key', 'ok', 0, false]);
    expect(Number(last.left)).toBeGreaterThan(0);
    expect((await rpc('roads_switch', { p_on: true })).on).toBe(true);
  });
  it('refuse / busy / over: TomTom says so, OSRM measures; down: nothing measured; missing: the function is not installed', async () => {
    for (const [m, tt] of [['refuse', 'refused'], ['busy', 'busy'], ['over', 'over_budget']]) {
      start(`?demo=owner&tomtom=${m}`);
      const a = await drive({ action: 'sweep' });
      expect([a.tomtom, a.osrm, Number(a.stored) > 0]).toEqual([tt, 'ok', true]);
    }
    start('?demo=owner&tomtom=down');
    const d = await drive({ action: 'sweep' });
    expect([d.ok, d.stored, d.tomtom, d.osrm, d.more, d.ready]).toEqual([true, 0, 'busy', 'down', false, false]);
    start('?demo=owner&tomtom=missing');
    expect(await drive({ action: 'status' })).toEqual({ ok: false, code: 'NOT_FOUND', error: 'Requested function was not found' });
  });
  it('the month’s ceiling: TomTom stops at it, OSRM takes the usual hours, the rush hours wait', async () => {
    start('?demo=owner');
    put('settings', { id: '1', booking: { ...(find('settings', '1')!.booking as object), roads_month_tx: 10 } });
    const rounds = await sweepAll();
    const last = rounds[rounds.length - 1];
    expect(Number((last.spent as { tx: number }).tx)).toBeLessThanOrEqual(10);
    expect(last.left0).toBe(0);
    expect(rounds.some((r) => r.tomtom === 'over_budget')).toBe(true);
  });
});

describe('demo: the suggestions with the switch on carry the real-road fields', () => {
  it('off: the keys of before only', async () => {
    start('?demo=owner');
    const s = (await rpc('suggest_blocks', { p_from: D(1), p_days: 7, p_duration: 60, p_lat: 45.52, p_lng: -73.64 })) as unknown as DemoRow[];
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((r) => !('unmeasured' in r) && !('route' in r) && !('rank' in r) && !('day_km' in r))).toBe(true);
  });
  it('on, a new address not measured yet: unmeasured > 0, no km, never « far » by a guess; measured: km; by blocks never an order (rank / route null)', async () => {
    start('?demo=owner&routes=1');
    expect(roadsOn()).toBe(true);
    expect(left()).toEqual({ left: 0, left0: 0 });
    const args = { p_from: D(1), p_days: 7, p_duration: 60, p_lat: 45.58, p_lng: -73.55 };
    const cold = (await rpc('suggest_blocks', args)) as unknown as DemoRow[];
    expect(cold.length).toBeGreaterThan(0);
    for (const r of cold) {
      expect(Number(r.unmeasured)).toBeGreaterThan(0);
      expect([r.add_km, r.day_km, r.far]).toEqual([null, null, null]);
      // by blocks the booking plans the other blocks again: the row says nothing of the order (lead's F2)
      expect([r.rank, r.route]).toEqual([null, null]);
    }
    await drive({ action: 'warm', point: { lat: 45.58, lng: -73.55 }, from: D(1), days: 7, only: 'point' });
    const warm = (await rpc('suggest_blocks', args)) as unknown as DemoRow[];
    for (const r of warm) {
      expect(r.unmeasured).toBe(0);
      expect(typeof r.add_km).toBe('number');
      expect(typeof r.day_km).toBe('number');
      expect(Number(r.day_min)).toBeGreaterThan(0);
      expect([r.rank, r.route]).toEqual([null, null]);
    }
  });
  it('by windows too (&fenetres=1&routes=1): suggest_blocks and suggest_windows rows carry them', async () => {
    start('?demo=owner&fenetres=1&routes=1');
    const day = [1, 2, 3, 4, 5].map(D).find((d) => ![0, 6].includes(new Date(d + 'T12:00').getDay()))!;
    const w = (await rpc('suggest_windows', { p_day: day, p_duration: 60, p_lat: 45.52, p_lng: -73.64 })) as unknown as DemoRow[];
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((r) => 'unmeasured' in r && Array.isArray(r.route) && typeof r.rank === 'number' && r.win_start != null)).toBe(true);
    // by windows the order is exact: the new stop's place in the day's walk
    for (const r of w) expect((r.route as string[]).indexOf('new') + 1).toBe(r.rank);
    const b = (await rpc('suggest_blocks', { p_from: day, p_days: 3, p_duration: 60, p_lat: 45.52, p_lng: -73.64 })) as unknown as DemoRow[];
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((r) => r.block === 'day' && Array.isArray(r.route) && typeof r.rank === 'number')).toBe(true);
  });
  it('the made-up road differs from the old straight-line formula of the demo and between the hours', () => {
    const a = { lat: 45.5005, lng: -73.6577 }, b = { lat: 45.4583, lng: -73.4697 };
    const p = pretend(a, b);
    expect(p.am).toBeGreaterThan(p.min);
    expect(p.pm).toBeGreaterThan(p.am);
    expect(pretend(b, a).min).not.toBe(p.min);
    expect(DEMO_DAYS).toBe(14);
  });
});

describe('demo: the app’s own data layer against the pretend server (what « ?demo » does)', () => {
  let was: typeof fetch;
  beforeEach(() => { was = window.fetch; resetRoads(); });
  afterEach(() => { window.fetch = was; });
  it('« Mesurer maintenant » (measureRoads while more) reaches the pretend « drive », then the switch goes on', async () => {
    start('?demo=owner');
    const seen: string[] = [];
    const net = vi.fn(async (input: RequestInfo | URL) => { seen.push(String(input)); return new Response('{}'); });
    window.fetch = net as unknown as typeof fetch;
    installFakeServer();
    const s = await roadsStatus();
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect([s.key, s.on, s.left0 > 0, s.month?.cap]).toEqual([true, false, true, 10000]);
    let last = await measureRoads();
    for (let i = 0; i < 50 && last.ok && last.more; i++) last = await measureRoads();
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect([last.ready, last.left0, last.more, last.tomtom]).toEqual([true, 0, false, 'ok']);
    const after = await roadsStatus();
    expect(after.ok && after.left0 === 0 && after.rows.tomtom > 0).toBe(true);
    expect((await rpc('roads_switch', { p_on: true })).on).toBe(true);
    // nothing left the page: no request reached the real network
    expect(seen).toEqual([]);
  });
  it('&tomtom=missing: the app reads « the function is not installed » (NOT_FOUND)', async () => {
    start('?demo=owner&tomtom=missing');
    window.fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    installFakeServer();
    const a = await measureRoads();
    expect(a).toMatchObject({ ok: false, code: 'NOT_FOUND', at: 'drive' });
  });
});

describe('demo: TomTom is never asked', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('the demo has no TomTom key, whatever the build was given; the published app keeps it', () => {
    expect(tomtomKeyFor('tt-key', true, '?demo', '')).toBe('');
    expect(tomtomKeyFor('tt-key', true, '?demo=office&tomtom=nokey', '')).toBe('');
    expect(tomtomKeyFor('tt-key', true, '', '#/book?demo=office')).toBe('');
    expect(tomtomKeyFor('tt-key', true, '?demolition', '')).toBe('tt-key');
    expect(tomtomKeyFor('tt-key', true, '', '')).toBe('tt-key');
    expect(tomtomKeyFor('tt-key', false, '?demo', '')).toBe('tt-key');
  });
  it('the pretend server answers api.tomtom.com itself (503), and lets the other addresses go', async () => {
    expect(neverAsked(new URL('https://api.tomtom.com/routing/1/calculateRoute/1,2:3,4/json?key=x'))?.status).toBe(503);
    expect(neverAsked(new URL('https://TOMTOM.com/'))?.status).toBe(503);
    expect(neverAsked(new URL('https://router.project-osrm.org/route/v1'))).toBeNull();
    expect(neverAsked(new URL('https://nottomtom.com.evil.org/'))).toBeNull();
    const real = vi.fn(async () => new Response('{}'));
    const was = window.fetch;
    window.fetch = real as unknown as typeof fetch;
    try {
      installFakeServer();
      const r = await window.fetch('https://api.tomtom.com/routing/matrix/2?key=tt-key', { method: 'POST', body: '{}' });
      expect(r.status).toBe(503);
      expect(real).not.toHaveBeenCalled();
      await window.fetch('https://photon.komoot.io/api?q=x');
      expect(real).toHaveBeenCalledTimes(1);
    } finally { window.fetch = was; }
  });
});

/* review-settings R13 (demo only): the pretend re-plan counts each vehicle from its own stops and leaves the stops under way
   alone; by windows, the new stop's drive is the measured trip (the unknown time when not measured), never the demo's
   straight-line formula. Each test failed on the demo before the fix. */
describe('demo: the pretend re-plan and the windows with the switch on (review R13)', () => {
  const weekdayFrom = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => D(from + i)).find((d) => ![0, 6].includes(new Date(d + 'T12:00').getDay()))!;
  const empty = (day: string) => { for (const j of table('jobs').filter((x) => x.day === day && !x.deleted_at)) put('jobs', { id: j.id, deleted_at: new Date().toISOString() }); };
  const bk = () => find('settings', '1')!.booking as Record<string, unknown>;
  it('two vehicles in one block: each leaves from the start, not from the other one’s last stop; en route / on site keep their time', async () => {
    start('?demo=owner');
    const day = weekdayFrom(7, 13);
    empty(day);
    const [t1, t2] = table('trucks').filter((x) => x.active && !x.deleted_at).map((x) => x.id);
    const P1 = { lat: 45.52, lng: -73.6 }, P2 = { lat: 45.47, lng: -73.75 }, P3 = { lat: 45.56, lng: -73.55 };
    const job = (id: string, truck: string, status: string, order: number, p: { lat: number; lng: number }, eta: number | null = null) =>
      put('jobs', { id, number: 900 + order, day, block: 'am', truck_id: truck, status, stop_order: order, eta_min: eta, duration_min: 60, travel_min: 15, lat: p.lat, lng: p.lng, customer_id: null });
    job('r13-e', t1, 'en_route', 1, P3, 500);
    job('r13-a', t1, 'booked', 2, P1);
    job('r13-b', t2, 'booked', 1, P2);
    await sweepAll();
    expect(left().left0).toBe(0);
    await rpc('roads_switch', { p_on: true });
    const eta = (id: string) => Number(find('jobs', id)!.eta_min);
    // the stop under way keeps its time; the next one follows it
    expect(eta('r13-e')).toBe(500);
    const free = 500 + 5 + 60;
    expect(eta('r13-a')).toBe(free + tripOf(P3, P1, day, free).min);
    // the other vehicle leaves from the start
    expect(eta('r13-b')).toBe(480 + tripOf(HOME, P2, day, 480).min);
  });
  it('by windows, the earliest window of an empty day is the start + the measured drive (the unknown time before it is measured)', async () => {
    start('?demo=owner&fenetres=1&routes=1');
    const day = weekdayFrom(1, 6);
    empty(day);
    const here = { lat: 45.58, lng: -73.55 };
    const rows = async (unknown: number) => {
      put('settings', { id: '1', booking: { ...bk(), unknown_min: unknown } });
      return (await rpc('suggest_windows', { p_day: day, p_duration: 60, p_lat: here.lat, p_lng: here.lng })) as unknown as DemoRow[];
    };
    const first = async (unknown: number) => Math.min(...(await rows(unknown)).map((r) => Number(r.eta)));
    // not measured yet: the unknown time counts
    expect((await first(77)) - (await first(33))).toBe(44);
    await drive({ action: 'warm', point: here, from: day, days: 1, only: 'point' });
    // measured: the trip counts, the unknown time no longer
    expect(await first(77)).toBe(await first(33));
    // each row says the drive of its walk: the measured trip to the new stop
    for (const r of await rows(33)) expect(r.drive_min).toBe(tripOf(HOME, here, day).min);
    // the switch off: the demo's estimate of before (the unknown time does not count)
    await rpc('roads_switch', { p_on: false });
    expect((await first(77)) - (await first(33))).toBe(0);
  });
});
