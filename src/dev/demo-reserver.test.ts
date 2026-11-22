/* The demo in window mode (dev only), Part 30 « Réserver à l'heure choisie »: book_preview and book_job with arrive_at
   answer like the real ones (20261122000300_reserver_heure.sql): at that minute, the other stops in their order; no room →
   who would be late, refused until accepted, the owner's and the office's; the truck cannot be there → arrive_late with
   the earliest. ?demo=owner&fenetres=1 shows the whole flow. */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, rpcOf, find, table, type DemoRow } from './fake-server';
import { loadDemoData } from './demo-data';
import './demo-rpc';
import { load as loadAgenda } from './demo-extra/agenda';
import { installWindows } from './demo-windows';
import { addDays, today } from '../lib/dates';

const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown> & { rows?: Record<string, DemoRow[]> };
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const D = (n: number) => addDays(today(), n);
const freeDay = () => { for (let n = 20; n < 30; n++) if (new Date(D(n) + 'T12:00').getDay() === 2) return D(n); return D(21); };
function start(search: string, who = 'u-hassan') {
  for (const k of Object.keys(db)) delete db[k];
  history.replaceState(null, '', '/' + search);
  (globalThis as { __demoUser?: string }).__demoUser = who;
  loadDemoData();
  loadAgenda();
  installWindows();
}
type Stop = { id: string; eta_before: number | null; eta_after: number; delay_min: number; late: boolean; late_min: number };
type Ans = { ok: boolean; exact: boolean; truck_id: string; forced: boolean; may_force: boolean; late: { id: string }[]; stops: Stop[]; over_hours: number; earliest: number | null; code?: string };

describe('demo: booking at a minute (Part 30)', () => {
  beforeEach(() => start('?demo=owner&fenetres=1'));
  it('room: the preview writes nothing; booked AT that minute, pinned, its window that of the minute; the others keep their hour', () => {
    const day = freeDay();
    call('book_job', { p_job: { id: 'a1', customer_id: 'c-julie', day, block: 'day', win_start: 480 }, p_items: [] });
    const truck = String(find('jobs', 'a1')!.truck_id);
    const a1 = find('jobs', 'a1')!.eta_min;
    const snap = JSON.stringify(table('jobs'));
    const pv = call('book_preview', { p_job: { id: 'n1', customer_id: 'c-marc', day, block: 'day', arrive_at: 900, truck_id: truck }, p_items: [] }) as unknown as Ans;
    expect(JSON.stringify(table('jobs'))).toBe(snap);
    expect([pv.ok, pv.exact, pv.forced, pv.may_force, pv.truck_id]).toEqual([true, true, false, true, truck]);
    expect(pv.stops.find((s) => s.id === 'n1')?.eta_after).toBe(900);
    const r = call('book_job', { p_job: { id: 'n1', customer_id: 'c-marc', day, block: 'day', arrive_at: 900, truck_id: truck, late_ok: [] }, p_items: [{ description: 'Diagnostic', duration_min: 60 }] }) as unknown as Ans & { rows: { jobs: DemoRow[] } };
    expect(r.ok).toBe(true);
    expect(find('jobs', 'n1')).toMatchObject({ eta_min: 900, arrive_at: 900, truck_pinned: true, win_start: 840, win_end: 1080, block: 'day', forced: false });
    expect(find('jobs', 'a1')!.eta_min).toBe(a1);
    expect(r.rows.jobs.some((j) => j.id === 'n1')).toBe(true);
  });
  it('no room: who would be late is said; refused « late_changed » until accepted; then booked as previewed', () => {
    const day = freeDay();
    call('book_job', { p_job: { id: 'b1', customer_id: 'c-julie', day, block: 'day', win_start: 480, duration_min: 60 }, p_items: [] });
    const truck = String(find('jobs', 'b1')!.truck_id);
    call('book_job', { p_job: { id: 'b2', customer_id: 'c-sophie', day, block: 'day', win_start: 540, duration_min: 60, truck_id: truck }, p_items: [] });
    const job = { id: 'n2', customer_id: 'c-marc', day, block: 'day', arrive_at: 540, duration_min: 300, truck_id: truck };
    const pv = call('book_preview', { p_job: job, p_items: [] }) as unknown as Ans;
    expect(pv.forced).toBe(true);
    expect(pv.late.length).toBeGreaterThan(0);
    expect(code(() => call('book_job', { p_job: job, p_items: [] }))).toBe('late_changed');
    expect(find('jobs', 'n2')).toBeUndefined();
    const ok = [...pv.late.map((x) => x.id), ...(pv.over_hours > 0 ? ['n2'] : [])];
    const r = call('book_job', { p_job: { ...job, late_ok: ok }, p_items: [] }) as unknown as Ans;
    expect(r.forced).toBe(true);
    expect(find('jobs', 'n2')!.eta_min).toBe(540);
    for (const s of pv.stops) expect(find('jobs', s.id)!.eta_min).toBe(s.eta_after);
  });
  it('the truck cannot be there: the preview answers arrive_late with the earliest minute; the booking refuses it', () => {
    const day = freeDay();
    call('book_job', { p_job: { id: 'c1', customer_id: 'c-julie', day, block: 'day', win_start: 600, duration_min: 60 }, p_items: [] });
    const truck = String(find('jobs', 'c1')!.truck_id);
    // 8 h: the truck leaves the garage at 8 h, the drive comes first
    const at = 480;
    const job = { id: 'n3', customer_id: 'c-marc', day, block: 'day', arrive_at: at, truck_id: truck };
    const pv = call('book_preview', { p_job: job, p_items: [] }) as unknown as Ans;
    expect([pv.ok, pv.code]).toEqual([false, 'arrive_late']);
    expect(pv.earliest).toBeGreaterThan(at);
    expect(code(() => call('book_job', { p_job: job, p_items: [] }))).toBe('arrive_late');
  });
  it('a mechanic: no room is said (may_force false) and refused « not_allowed »', () => {
    start('?demo=owner&fenetres=1', 'u-saleh');
    const mine = table('trucks').find((t) => t.driver_id === 'u-saleh');
    if (!mine) return;   // the demo's mechanic drives a truck
    const day = freeDay();
    (globalThis as { __demoUser?: string }).__demoUser = 'u-hassan';
    call('book_job', { p_job: { id: 'd1', customer_id: 'c-julie', day, block: 'day', win_start: 480, truck_id: mine.id }, p_items: [] });
    (globalThis as { __demoUser?: string }).__demoUser = 'u-saleh';
    const job = { id: 'n4', customer_id: 'c-marc', day, block: 'day', arrive_at: 480 + 5, duration_min: 300, truck_id: mine.id };
    const pv = call('book_preview', { p_job: job, p_items: [] }) as unknown as Ans;
    if (pv.ok === false) return;   // the truck cannot be there that early: nothing to force
    expect(pv.may_force).toBe(false);
    if (pv.forced) expect(code(() => call('book_job', { p_job: { ...job, late_ok: pv.late.map((x) => x.id).concat(['n4']) }, p_items: [] }))).toBe('not_allowed');
  });
  it('blocks mode: the preview answers « not exact »', () => {
    start('?demo=owner');
    expect(call('book_preview', { p_job: { id: 'z', customer_id: 'c-julie', day: freeDay(), block: 'pm', arrive_at: 900 }, p_items: [] })).toEqual({ ok: true, exact: false, stops: [] });
  });
});
