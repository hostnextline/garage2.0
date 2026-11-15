/* The pretend server of the demo in window mode (dev only): the operations the screens call answer like the real ones. */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, rpcOf, find, table, put, type DemoRow } from './fake-server';
import { loadDemoData } from './demo-data';
import './demo-rpc';
import { load as loadAgenda } from './demo-extra/agenda';
import { installWindows, windowsOn } from './demo-windows';
import { addDays, today } from '../lib/dates';

const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown> & { rows?: Record<string, DemoRow[]> };
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const D = (n: number) => addDays(today(), n);
/** a coming day when the truck works (the demo's week: Monday to Saturday), far enough to be empty */
const freeDay = () => { for (let n = 20; n < 30; n++) if (new Date(D(n) + 'T12:00').getDay() === 2) return D(n); return D(21); };
function start(search: string) {
  for (const k of Object.keys(db)) delete db[k];
  history.replaceState(null, '', '/' + search);
  (globalThis as { __demoUser?: string }).__demoUser = 'u-hassan';
  loadDemoData();
  loadAgenda();
  installWindows();
}
const coming = () => table('jobs').filter((j) => !j.deleted_at && String(j.day) >= today());

describe('demo: block mode stays as it was', () => {
  beforeEach(() => start('?demo=owner'));
  it('nothing is converted and the block operations answer as before', () => {
    expect(windowsOn()).toBe(false);
    expect(coming().some((j) => j.block === 'day')).toBe(false);
    const s = call('suggest_blocks', { p_from: D(1), p_days: 7, p_duration: 60 }) as unknown as DemoRow[];
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((r) => ['am', 'pm', 'eve'].includes(String(r.block)) && r.win_start === undefined)).toBe(true);
    expect(call('suggest_windows', { p_day: D(1), p_duration: 60 })).toEqual([]);
    expect(code(() => call('book_job', { p_job: { id: 'n1', customer_id: 'c-julie', day: freeDay(), block: 'day' }, p_items: [] }))).toBe('bad_block');
    const r = call('book_job', { p_job: { id: 'n2', customer_id: 'c-julie', day: freeDay(), block: 'pm' }, p_items: [] });
    expect(r.ok).toBe(true);
    expect(find('jobs', 'n2')!.block).toBe('pm');
    expect(find('jobs', 'n2')!.win_start ?? null).toBeNull();
  });
});

describe('demo: ?fenetres=1', () => {
  beforeEach(() => start('?demo=owner&fenetres=1'));

  it('the coming jobs are « day » jobs with a window; the past keeps its blocks', () => {
    expect(windowsOn()).toBe(true);
    expect(coming().every((j) => j.block === 'day')).toBe(true);
    expect(find('jobs', 'j-y1')!.block).toBe('am');
    // the old block is the window those customers were told
    expect([find('jobs', 'j-3')!.win_start, find('jobs', 'j-3')!.win_end]).toEqual([720, 960]);
    // flexible examples, and one « hors plage » on today's route
    const flex = coming().filter((j) => j.win_flex === true && j.win_start == null);
    expect(flex.length).toBeGreaterThanOrEqual(1);
    const late = find('jobs', 'j-5')!;
    expect(late.forced).toBe(true);
    expect(Number(late.eta_min)).toBeGreaterThan(Number(late.win_end));
  });
  it('every other booked stop with a window is planned inside it', () => {
    for (const j of coming().filter((x) => x.status === 'booked' && x.win_start != null && !x.forced && x.truck_id && String(x.day) > today())) {
      expect(Number(j.eta_min)).toBeGreaterThanOrEqual(Number(j.win_start));
      expect(Number(j.eta_min)).toBeLessThanOrEqual(Number(j.win_end));
    }
  });
  it('suggest_blocks gives one window per day; suggest_windows several, fewer on a busy day', () => {
    const s = call('suggest_blocks', { p_from: D(1), p_days: 10, p_duration: 60, p_limit: 6 }) as unknown as DemoRow[];
    expect(s.length).toBeGreaterThan(1);
    expect(new Set(s.map((r) => r.day)).size).toBe(s.length);
    for (const r of s) { expect(r.block).toBe('day'); expect(Number(r.win_end) - Number(r.win_start)).toBe(240); expect(Number(r.eta)).toBeGreaterThanOrEqual(Number(r.win_start)); expect(Number(r.eta)).toBeLessThanOrEqual(Number(r.win_end)); }
    const day = freeDay();
    const free = call('suggest_windows', { p_day: day, p_duration: 60 }) as unknown as DemoRow[];
    expect(free.length).toBeGreaterThan(3);
    for (let i = 0; i < 3; i++) call('book_job', { p_job: { id: `fill-${i}`, customer_id: 'c-marc', day, block: 'day', duration_min: 180 }, p_items: [] });
    const busy = call('suggest_windows', { p_day: day, p_duration: 60 }) as unknown as DemoRow[];
    expect(busy.length).toBeLessThan(free.length);
  });
  it('book_job: a window chosen, a window derived, flexible, and a window that no longer fits', () => {
    const day = freeDay();
    call('book_job', { p_job: { id: 'b1', customer_id: 'c-julie', day, block: 'day', win_start: 840 }, p_items: [{ description: 'Diagnostic', duration_min: 60 }] });
    expect([find('jobs', 'b1')!.win_start, find('jobs', 'b1')!.win_end, find('jobs', 'b1')!.win_flex]).toEqual([840, 1080, false]);
    expect(Number(find('jobs', 'b1')!.eta_min)).toBeGreaterThanOrEqual(840);
    call('book_job', { p_job: { id: 'b2', customer_id: 'c-marc', day, block: 'day' }, p_items: [] });
    expect(find('jobs', 'b2')!.win_start).toBe(480);
    call('book_job', { p_job: { id: 'b3', customer_id: 'c-sophie', day, block: 'day', win_flex: true }, p_items: [] });
    expect([find('jobs', 'b3')!.win_start, find('jobs', 'b3')!.win_flex]).toEqual([null, true]);
    expect(find('jobs', 'b3')!.eta_min).not.toBeNull();
    expect(code(() => call('book_job', { p_job: { id: 'b4', customer_id: 'c-kevin', day, block: 'am' }, p_items: [] }))).toBe('bad_block');
    // a morning already full of work: the same window is refused, « quand même » books it at the end
    call('book_job', { p_job: { id: 'b5', customer_id: 'c-kevin', day, block: 'day', win_start: 480, duration_min: 230 }, p_items: [] });
    for (const t of table('trucks')) if (t.id !== find('jobs', 'b5')!.truck_id) put('trucks', { id: t.id, active: false });
    expect(code(() => call('book_job', { p_job: { id: 'b6', customer_id: 'c-amira', day, block: 'day', win_start: 480, duration_min: 200 }, p_items: [] }))).toBe('window_full');
    const forced = call('book_job', { p_job: { id: 'b7', customer_id: 'c-amira', day, block: 'day', win_start: 480, duration_min: 200, force: true }, p_items: [] });
    expect(forced.forced).toBe(true);
    expect(find('jobs', 'b7')!.forced).toBe(true);
  });
  it('move_job: a new window, flexible, and the old call keeps working', () => {
    const day = freeDay();
    call('move_job', { p_job: 'j-t1', p_day: day, p_block: 'day', p_truck: null, p_win_start: 600, p_win_flex: false });
    expect([find('jobs', 'j-t1')!.day, find('jobs', 'j-t1')!.win_start, find('jobs', 'j-t1')!.win_end]).toEqual([day, 600, 840]);
    call('move_job', { p_job: 'j-t1', p_day: day, p_block: 'day', p_truck: null, p_win_start: null, p_win_flex: true });
    expect([find('jobs', 'j-t1')!.win_start, find('jobs', 'j-t1')!.win_flex]).toEqual([null, true]);
    call('move_job', { p_job: 'j-t1', p_day: addDays(day, 1), p_block: 'day', p_truck: null });
    expect(find('jobs', 'j-t1')!.win_start).toBe(480);
    expect(code(() => call('move_job', { p_job: 'j-t1', p_day: day, p_block: 'pm', p_truck: null }))).toBe('bad_block');
  });
  it('lock_windows fixes the flexible windows of a day from the planned arrival', () => {
    const day = freeDay();
    call('book_job', { p_job: { id: 'f1', customer_id: 'c-julie', day, block: 'day', win_flex: true }, p_items: [] });
    const r = call('lock_windows', { p_day: day });
    expect(r.fixed).toBe(1);
    const j = find('jobs', 'f1')!;
    expect(j.win_flex).toBe(true);
    expect(Number(j.win_end) - Number(j.win_start)).toBe(240);
    expect(Number(j.eta_min)).toBeGreaterThanOrEqual(Number(j.win_start));
    expect(call('lock_windows', { p_day: day }).fixed).toBe(0);
    (globalThis as { __demoUser?: string }).__demoUser = 'u-saleh';
    expect(code(() => call('lock_windows', { p_day: day }))).toBe('not_allowed');
  });
  it('set_stop_order with « day »: the order by hand, then back to the planner', () => {
    const day = freeDay();
    call('book_job', { p_job: { id: 's1', customer_id: 'c-julie', day, block: 'day', win_start: 480 }, p_items: [] });
    const truck = String(find('jobs', 's1')!.truck_id);
    call('book_job', { p_job: { id: 's2', customer_id: 'c-marc', day, block: 'day', win_start: 600, truck_id: truck }, p_items: [] });
    call('set_stop_order', { p_truck: truck, p_day: day, p_block: 'day', p_jobs: ['s2', 's1'] });
    expect([find('jobs', 's2')!.stop_order, find('jobs', 's1')!.stop_order, find('jobs', 's2')!.manual_order]).toEqual([1, 2, 1]);
    call('set_stop_order', { p_truck: truck, p_day: day, p_block: 'day', p_jobs: [] });
    expect([find('jobs', 's1')!.stop_order, find('jobs', 's2')!.stop_order, find('jobs', 's1')!.manual_order]).toEqual([1, 2, null]);
  });
  it('windows_switch: back to blocks and on again (owner only)', () => {
    const off = call('windows_switch', { p_on: false });
    expect(off.ok).toBe(true);
    expect(Number(off.converted)).toBeGreaterThan(5);
    expect(windowsOn()).toBe(false);
    expect(coming().every((j) => ['am', 'pm', 'eve'].includes(String(j.block)) && j.win_start == null && j.win_flex === false)).toBe(true);
    expect(off.rows!.settings.length).toBe(1);
    const on = call('windows_switch', { p_on: true });
    expect(on.converted).toBe(off.converted);
    expect(coming().every((j) => j.block === 'day' && j.win_start != null)).toBe(true);
    expect(call('windows_switch', { p_on: true }).converted).toBe(0);
    (globalThis as { __demoUser?: string }).__demoUser = 'u-office';
    expect(code(() => call('windows_switch', { p_on: false }))).toBe('owner_only');
  });
});
