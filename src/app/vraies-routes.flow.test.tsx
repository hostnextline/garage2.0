/* « Vraies routes » from end to end on the phone, the joins together (the integrator, 2026-11-20): the REAL data layer
   (api.ts → roads.ts → the engine, outbox and sender of sync.ts) and the REAL pickers (shared/moment BlockPicker), against
   pretend servers at the lowest seams the other tests use:
   - the function « drive »: `callFn` of data/auth (as roads.test.ts, roads.sent.test.ts, roads-measure.test.tsx);
   - the planner (suggest_blocks / suggest_windows): `sb.rpc` of data/client, under the real `ask` (roads.test.ts and
     roads-measure.test.tsx pretend `ask` itself; one level lower here);
   - the database for the engine (pulls, book_job): testkit.ts's FakeServer behind the app's guarded door (clientFor).
   Proved: switch ON, an address is measured BEFORE the planner is asked; the picker shows the measured moments, with
   « Arrêt n sur N » from the server's row in window mode and nothing of the order in blocks mode; a row not measured says
   « pas encore mesurée », never its 20-minute unknown time; when nothing could be measured (TomTom busy, OSRM down) the
   person is told so and the booking still goes through, and its place is measured once it reached the server. Switch
   OFF (the rollback state): not one request leaves for « drive », and the planner is asked at once. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

/* ---------- the function « drive » (callFn) ---------- */
const DONE = { ok: true, ready: true, left: 0, left0: 0, stored: 6, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false };
const fn = vi.hoisted(() => ({
  log: [] as string[],
  /** « drive » requests not answered yet (a test ends only once none is: a late one belongs to no later test) */
  inflight: 0,
  calls: [] as { name: string; body: Record<string, unknown> }[],
  answer: null as null | ((body: Record<string, unknown>) => unknown)
}));
vi.mock('../data/auth', async (orig) => {
  const real = await orig<typeof import('../data/auth')>();
  return {
    ...real,
    callFn: async (name: string, body: Record<string, unknown>) => {
      fn.calls.push({ name, body });
      fn.log.push(`fn:${name}:${String(body.action)}${body.only ? `:${String(body.only)}` : ''}`);
      fn.inflight++;
      try { await new Promise((r) => setTimeout(r, 20)); return fn.answer ? fn.answer(body) : DONE; } finally { fn.inflight--; }
    }
  };
});
/* ---------- the map (no tiles, no route planner in a test) ---------- */
vi.mock('../shared/map/MapView', async () => {
  const { h } = await import('preact');
  return { MapView: () => h('div', {}) };
});

import { sb } from '../data/client';
import { FakeServer, clientFor } from '../data/testkit';
import { startSync, stopSync, net, flush, syncOptions } from '../data/sync';
import { setNet } from '../data/net';
import { clearAll } from '../data/store';
import { resetRoads } from '../data/roads';
import { bookJob, moveJob } from '../data/api';
import { lang } from '../lib/i18n';
import { addDays, today } from '../lib/dates';
import { BlockPicker, type BlockChoice } from '../shared/moment/BlockPicker';
import { forgetWindows } from '../shared/moment/useDayWindows';
import { forgetRoads } from '../shared/map/roads';

/* ---------- the planner (sb.rpc under the real ask) ---------- */
const planner = { calls: [] as { name: string; args: Record<string, unknown> }[], rows: (_name: string, _args: Record<string, unknown>): unknown[] => [] };
let srv: FakeServer; let n = 0;
let urls: string[] = [];
const uid = () => `00000000-0000-4000-c000-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
}
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
/** the screen drawn again until `ok` (at most `ms`) */
async function seen(ok: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('not seen in time'); await wait(50); }
}
/** no « drive » request under way, nor one about to start behind an answer (the rest of a warm) */
async function quiet() { for (let calm = 0; calm < 3;) { await new Promise((r) => setTimeout(r, 40)); calm = fn.inflight === 0 ? calm + 1 : 0; } }
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const box = document.createElement('div');
document.body.appendChild(box);

const P = { lat: 45.5612, lng: -73.5491 };                   // the customer's address, already found
const tomorrow = addDays(today(), 1);
const HOME = { label: 'Centrale', address: '1401 rue Legendre Ouest', lat: 45.5313, lng: -73.6545 };
/** the garage on the pretend server: one vehicle working every day, two appointments tomorrow (A then B) */
async function start(o: { roads: boolean; windows: boolean }) {
  srv.put('settings', { id: '1', booking: { roads_on: o.roads, windows_on: o.windows, unknown_min: 20, horizon_days: 120, min_block_min: 45, home: HOME } });
  srv.put('trucks', { id: 'T1', name: 'Camion', active: true, sort: 0, color: '#D3000E', driver_id: null, tire_machine: true });
  for (let d = 0; d < 7; d++) srv.put('truck_week', { id: `w${d}`, truck_id: 'T1', dow: d, ranges: [[480, 1200]] });
  srv.put('customers', { id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lat: P.lat, lng: P.lng });
  const block = o.windows ? 'day' : 'am';
  srv.put('jobs', { id: 'A', number: 1, customer_id: null, day: tomorrow, block, status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 1, eta_min: 600, lat: 45.52, lng: -73.58, ...(o.windows ? { win_start: 540, win_end: 780 } : {}) });
  srv.put('jobs', { id: 'B', number: 2, customer_id: null, day: tomorrow, block, status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 2, eta_min: 700, lat: 45.54, lng: -73.56, ...(o.windows ? { win_start: 660, win_end: 900 } : {}) });
  const u = uid();
  const client = clientFor(srv, u);
  // the database goes to the pretend server; anything else (route planners, tiles) never answers, and is noted
  const rest = srv.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/rest/v1/')) return rest(input, init);
    urls.push(url);
    return new Promise(() => undefined);
  }) as typeof fetch;
  await startSync(client, u);
  await until(() => net.value.ready);
}
let picked: BlockChoice | null = null;
function Host() {
  const [v, setV] = useState<BlockChoice | null>(null);
  return <BlockPicker lat={P.lat} lng={P.lng} duration={60} value={v} onPick={(c) => { picked = c; setV(c); }} onClear={() => setV(null)} layout="grid" />;
}
const driveCalls = () => fn.calls.filter((c) => c.name === 'drive');
const pointWarm = () => driveCalls().find((c) => c.body.action === 'warm' && c.body.only === 'point');

/** a moment of the planner, as Part 27 answers it with the switch on (unmeasured, day_km, rank, route) */
const row = (o: Record<string, unknown> = {}) => ({ day: tomorrow, block: 'am', drive_min: 12, near: 0, truck: 'T1', left: 120, add_min: 14, add_km: 5, day_min: 50,
  hop_min: 14, stops: 2, far: null, unmeasured: 0, day_km: 20, rank: null, route: null, ...o });

beforeEach(() => {
  srv = new FakeServer(); syncOptions.realtime = false; resetRoads(); forgetWindows(); forgetRoads(); clearAll();
  fn.calls.length = 0; fn.log.length = 0; fn.answer = null; urls = []; picked = null; lang.value = 'fr';
  planner.calls.length = 0; planner.rows = () => [];
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
  srv.rpc('book_job', (a) => ({ ok: true, job_id: (a.p_job as { id: string }).id, truck_id: 'T1' }));
  srv.rpc('move_job', () => ({ ok: true, changed: true }));
  vi.spyOn(sb, 'rpc').mockImplementation(((name: string, args: Record<string, unknown>) => {
    planner.calls.push({ name, args });
    fn.log.push(`rpc:${name}`);
    const data = planner.rows(name, args);
    const answer = Promise.resolve({ data, error: null, status: 200 });
    return { abortSignal: () => answer, then: answer.then.bind(answer) };
  }) as never);
});
afterEach(async () => { act(() => render(null, box)); await quiet(); stopSync(); vi.restoreAllMocks(); clearAll(); });

describe('« Vraies routes » ON, window mode: the address measured, then the server’s moments and its order', () => {
  it('measured before the planner is asked; the measured moment with « Arrêt 1 sur 3 » from the server’s row', async () => {
    await start({ roads: true, windows: true });
    // the server's exact place in window mode: first of the day, before A and B
    const best = row({ block: 'day', eta: 560, win_start: 540, win_end: 780, rank: 1, route: ['new', 'A', 'B'] });
    planner.rows = (name, args) => (name === 'suggest_windows' ? [{ ...best, day: args.p_day }] : [best]);
    act(() => render(<Host />, box));
    await seen(() => !!q('bp-sugg-order'));
    // the address is measured (the usual hours of its trips: « only: point »), and only then is the planner asked
    expect(pointWarm()?.body).toEqual({ action: 'warm', point: P, from: today(), days: 14, only: 'point' });
    const firstWarm = fn.log.indexOf('fn:drive:warm:point'), firstPlan = fn.log.findIndex((x) => x.startsWith('rpc:suggest_'));
    expect(firstWarm).toBeGreaterThanOrEqual(0);
    expect(firstPlan).toBeGreaterThan(firstWarm);
    expect(q('roads-measuring')).toBeNull();
    expect(q('roads-failed')).toBeNull();
    // the measured moment: the server's order, and its real driving
    expect(q('bp-sugg-order')?.textContent).toBe('Arrêt 1 sur 3 de la journée');
    expect(q('win-sugg-0')?.textContent).toContain('12 min de route');
    expect(q('win-sugg-0')?.textContent).not.toMatch(/pas encore mesur/);
    // the rest of those days is measured behind, without the screen waiting for it
    await until(() => driveCalls().some((c) => c.body.action === 'warm' && c.body.only === undefined));
  });
  it('a row whose trips are not all measured: « pas encore mesurée », never its 20 minutes, no order guessed by the phone', async () => {
    await start({ roads: true, windows: true });
    const best = row({ block: 'day', eta: 560, win_start: 540, win_end: 780, unmeasured: 1, drive_min: 20, add_min: 20, add_km: null, day_km: null, rank: 1, route: ['new', 'A', 'B'] });
    planner.rows = (name, args) => (name === 'suggest_windows' ? [{ ...best, day: args.p_day }] : [best]);
    act(() => render(<Host />, box));
    await seen(() => !!q('win-sugg-0'));
    const text = q('win-sugg-0')?.textContent || '';
    expect(text).toContain('Route pas encore mesurée');
    expect(text).not.toMatch(/20 min/);
    expect(text).not.toMatch(/\bkm\b/);
  });
});

describe('« Vraies routes » ON, blocks mode: nothing of the order (the lead’s decision F2)', () => {
  it('the measured moments, their real driving; no « Arrêt n sur N » even when a row carries a rank', async () => {
    await start({ roads: true, windows: false });
    planner.rows = () => [row({ block: 'am', rank: 1, route: ['new', 'A', 'B'] }), row({ block: 'pm', add_min: 9, add_km: 3, rank: null, route: null })];
    act(() => render(<Host />, box));
    await seen(() => all('bp-sugg').length === 2);
    expect(pointWarm()).toBeTruthy();
    const rows = all('bp-sugg');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('14 min de route (5 km)');
    expect(all('bp-sugg-order')).toEqual([]);
    expect(box.textContent).not.toMatch(/Arrêt \d+ sur \d+/);
  });
});

describe('« Vraies routes » ON, nothing could be measured (TomTom busy, OSRM down): the booking still goes through', () => {
  it('the person is told; the moment says « pas encore mesurée »; « Réserver » reaches the server; its place is measured after', async () => {
    await start({ roads: true, windows: false });
    fn.answer = () => ({ ...DONE, ready: false, stored: 0, left: 12, left0: 12, tomtom: 'busy', osrm: 'down' });
    planner.rows = () => [row({ block: 'am', unmeasured: 2, add_min: 40, drive_min: 20, add_km: null, day_km: null })];
    act(() => render(<Host />, box));
    await seen(() => !!q('roads-failed') && all('bp-sugg').length === 1);
    expect(q('roads-failed')?.textContent).toContain('Tu peux réserver quand même');
    const s = all('bp-sugg')[0];
    expect(s.textContent).toContain('Route pas encore mesurée');
    expect(s.textContent).not.toMatch(/40 min|20 min/);
    await act(async () => { s.click(); });
    expect(picked).toMatchObject({ day: tomorrow, block: 'am' });
    const before = driveCalls().length;
    const r = await bookJob({ customer_id: 'c1', day: picked!.day, block: picked!.block, lat: P.lat, lng: P.lng }, [{ description: 'Vidange' }]);
    await flush(); await until(() => net.value.pending === 0);
    expect(r.queued).toBe(false);
    expect(srv.count((c) => c.table === 'rpc/book_job')).toBe(1);
    expect(net.value.failed).toEqual([]);
    // once it reached the server, its place is measured for its day (in the background: nobody waits)
    await until(() => driveCalls().slice(before).some((c) => c.body.action === 'warm' && c.body.days === 1));
    expect(driveCalls().slice(before).find((c) => c.body.days === 1)?.body).toMatchObject({ point: P, from: tomorrow, days: 1, only: 'point' });
  });
});

describe('« Vraies routes » OFF (the rollback state): no request for « drive »', () => {
  it('the pickers, a booking and a move: « drive » never called, the planner asked at once', async () => {
    await start({ roads: false, windows: false });
    planner.rows = () => [row({ block: 'am', unmeasured: undefined, day_km: undefined, rank: undefined, route: undefined })];
    act(() => render(<Host />, box));
    await seen(() => all('bp-sugg').length === 1);
    expect(planner.calls.filter((c) => c.name === 'suggest_blocks').length).toBeGreaterThanOrEqual(1);
    expect(all('bp-sugg').length).toBe(1);
    expect(q('roads-measuring')).toBeNull();
    expect(q('roads-failed')).toBeNull();
    await bookJob({ customer_id: 'c1', day: tomorrow, block: 'am', lat: P.lat, lng: P.lng }, [{ description: 'Vidange' }]);
    await moveJob('A', addDays(today(), 2), 'pm');
    await moveJob('B', addDays(today(), 3), 'pm', null, null, { queue: false });
    await flush(); await until(() => net.value.pending === 0);
    await wait(200);
    expect(driveCalls()).toEqual([]);
    expect(fn.calls).toEqual([]);
    expect(urls.filter((u) => u.includes('/functions/v1/drive'))).toEqual([]);
  });
});
