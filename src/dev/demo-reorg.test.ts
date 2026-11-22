/* The pretend « Réorganiser la journée » of the demo (Part 28, U8): day_order_preview / day_order_save answer like the real
   ones, with the database's rights (demo-rules: the twin of right_of / my_truck_ids). */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, rpcOf, find, put, type DemoRow } from './fake-server';
import { loadDemoData } from './demo-data';
import { load as loadReorg } from './demo-extra/reorg';
import { addDays, today } from '../lib/dates';

const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown> & { rows?: Record<string, DemoRow[]>; stops?: Record<string, unknown>[]; accept?: Record<string, Record<string, number>> };
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
/** a coming Wednesday (both demo vehicles work on Wednesdays) */
const DAY = (() => { for (let n = 20; n < 30; n++) { const d = addDays(today(), n); if (new Date(`${d}T12:00:00Z`).getUTCDay() === 3) return d; } return addDays(today(), 21); })();
const C = 't-complet', V = 't-voiture';
const as = (id: string) => { (globalThis as { __demoUser?: string }).__demoUser = id; };
function start() {
  for (const k of Object.keys(db)) delete db[k];
  as('u-hassan');
  loadDemoData();
  loadReorg();
  const s = find('settings', '1')!;
  put('settings', { id: '1', booking: { ...(s.booking as object), windows_on: true, shared_routes: false, win_before_min: 60, win_after_min: 180, win_round_min: 60 } });
  put('trucks', { id: V, tire_machine: false });
  const J = (id: string, truck: string, stop: number, ws: number | null, o: Partial<DemoRow> = {}) =>
    put('jobs', { id, number: 900 + stop + (truck === V ? 10 : 0), customer_id: 'c-julie', day: DAY, block: 'day', truck_id: truck, status: 'booked', stop_order: stop,
      // the arrivals a walk wrote (8 h + 20 min of road, then each 120-min job + 20 min): Part 29 holds a stop not dragged
      // not before its arrival now
      duration_min: truck === C ? 120 : 60, travel_min: 20, eta_min: truck === C ? 500 + (stop - 1) * 140 : 540, win_start: ws, win_end: ws == null ? null : ws + 240, arrive_at: null, ...o });
  J('r1', C, 1, 480); J('r2', C, 2, 480); J('r3', C, 3, 600);
  J('r4', V, 1, 540);
}
const wasNow = () => Object.fromEntries((db.jobs || []).filter((j) => j.day === DAY && !j.deleted_at && ['booked', 'en_route', 'on_site'].includes(String(j.status)) && [C, V].includes(String(j.truck_id)))
  .map((j) => [j.id, [j.truck_id, j.block, j.stop_order ?? null, j.win_start ?? null, j.win_end ?? null, j.arrive_at ?? null, j.status]]));
const LISTS = (c: string[], v: string[]) => [{ truck: C, block: 'day', jobs: c }, { truck: V, block: 'day', jobs: v }];
const ask = (c: string[], v: string[], moved: string[] = [], o: Record<string, unknown> = {}) => ({ p_day: DAY, p_lists: LISTS(c, v), p_moved: moved, p_was: wasNow(), p_auto: false, ...o });

beforeEach(start);

describe('day_order_preview: nothing written, the times of the order given', () => {
  it('the day as it is: every stop with its arrival, no window to change; no row written', () => {
    const before = JSON.stringify(db.jobs);
    const a = call('day_order_preview', ask(['r1', 'r2', 'r3'], ['r4']));
    expect(a).toMatchObject({ ok: true, basis_ok: true, mode: 'windows', rewin: true });
    expect(a.stops!.map((s) => s.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(a.accept!.windows).toEqual({});
    expect(JSON.stringify(db.jobs)).toBe(before);
  });
  it('the basis changed meanwhile: basis_ok false with what changed (the save refuses day_changed)', () => {
    const was = wasNow();
    put('jobs', { id: 'r2', stop_order: 5 });
    expect(call('day_order_preview', { ...ask(['r1', 'r2', 'r3'], ['r4']), p_was: was })).toMatchObject({ ok: true, basis_ok: false, changed: ['r2'] });
    expect(code(() => call('day_order_save', { ...ask(['r1', 'r2', 'r3'], ['r4']), p_was: was, p_accept: {} }))).toBe('day_changed');
  });
  it('coverage, tire work on the car, the past, a list without its basis', () => {
    expect(code(() => call('day_order_preview', ask(['r1', 'r2'], ['r4'])))).toBe('changed');
    put('jobs', { id: 'r3', needs_machine: true });
    expect(code(() => call('day_order_preview', ask(['r1', 'r2'], ['r4', 'r3'], ['r3'])))).toBe('needs_truck');
    expect(code(() => call('day_order_preview', { ...ask(['r1', 'r2', 'r3'], ['r4']), p_day: addDays(today(), -1) }))).toBe('past');
    expect(code(() => call('day_order_save', { ...ask(['r1', 'r2', 'r3'], ['r4']), p_was: null, p_accept: {} }))).toBe('bad_list');
  });
});

describe('day_order_save: writes exactly what the preview showed', () => {
  it('a new window must be accepted first (outcome_changed); accepted: trucks, orders, windows written; no order by hand', () => {
    // r1 put last: it arrives after its window (8 h à 12 h) → a new window
    const a = call('day_order_preview', ask(['r2', 'r3', 'r1'], ['r4'], ['r1']));
    expect(Object.keys(a.accept!.windows)).toEqual(['r1']);
    expect(code(() => call('day_order_save', { ...ask(['r2', 'r3', 'r1'], ['r4'], ['r1']), p_accept: {} }))).toBe('outcome_changed');
    expect(find('jobs', 'r1')!.win_start).toBe(480);
    const s = call('day_order_save', { ...ask(['r2', 'r3', 'r1'], ['r4'], ['r1']), p_accept: a.accept });
    expect(s.saved).toBe(true);
    expect(find('jobs', 'r1')).toMatchObject({ stop_order: 3, manual_order: null, win_start: a.accept!.windows.r1 });
    expect(find('jobs', 'r2')!.stop_order).toBe(1);
    expect(s.rows!.jobs.map((j) => j.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
  it('a stop put on the other truck: truck_pinned; « Laisser l\'app choisir » gives the planner\'s lists', () => {
    const a = call('day_order_preview', ask(['r1', 'r3'], ['r4', 'r2'], ['r2']));
    call('day_order_save', { ...ask(['r1', 'r3'], ['r4', 'r2'], ['r2']), p_accept: a.accept });
    expect(find('jobs', 'r2')).toMatchObject({ truck_id: V, truck_pinned: true });
    const auto = call('day_order_preview', { p_day: DAY, p_lists: null, p_moved: [], p_was: wasNow(), p_auto: true });
    expect(auto.auto).toBe(true);
    expect((auto.lists as { truck: string; jobs: string[] }[]).find((l) => l.truck === C)!.jobs).toEqual(['r1', 'r3']);
  });
  it('rights: a mechanic orders his own truck, never moves a stop to the other, never « Laisser l\'app choisir »; his save writes no window, marks hand_at', () => {
    // the demo's mechanics have « Réserver » (role_rights): this one has not, as a driver without the office's right
    put('settings', { id: '1', role_rights: { mechanic: { book: false, hours: true } } });
    as('u-saleh');                                                                  // drives the Camion Complet
    const mine = (c: string[], moved: string[] = []) => ({ p_day: DAY, p_lists: [{ truck: C, block: 'day', jobs: c }], p_moved: moved, p_was: Object.fromEntries(Object.entries(wasNow()).filter(([, v]) => v[0] === C)), p_auto: false });
    expect(code(() => call('day_order_preview', { ...mine(['r1', 'r2', 'r3']), p_lists: LISTS(['r1', 'r2', 'r3'], ['r4']) }))).toBe('not_allowed');
    expect(code(() => call('day_order_preview', { ...mine(['r1', 'r2', 'r3']), p_lists: null, p_auto: true }))).toBe('not_allowed');
    // « Routes partagées »: he orders either vehicle, but never moves a stop from one to the other
    put('settings', { id: '1', booking: { ...(find('settings', '1')!.booking as object), shared_routes: true } });
    expect(code(() => call('day_order_preview', { ...mine(['r1', 'r2', 'r3']), p_lists: LISTS(['r1', 'r2', 'r3'], ['r4']), p_was: wasNow() }))).toBe('ok');
    expect(code(() => call('day_order_preview', { ...mine(['r1', 'r3']), p_lists: LISTS(['r1', 'r3'], ['r4', 'r2']), p_moved: ['r2'], p_was: wasNow() }))).toBe('not_allowed');
    put('settings', { id: '1', booking: { ...(find('settings', '1')!.booking as object), shared_routes: false } });
    const a = call('day_order_preview', mine(['r2', 'r3', 'r1'], ['r1']));
    expect(a.rewin).toBe(false);
    expect(a.accept!.windows).toEqual({});
    expect(Object.keys(a.accept!.late)).toEqual(['r1']);
    call('day_order_save', { ...mine(['r2', 'r3', 'r1'], ['r1']), p_accept: a.accept });
    expect(find('jobs', 'r1')).toMatchObject({ win_start: 480, stop_order: 3 });
    expect(typeof find('jobs', 'r1')!.hand_at).toBe('string');
    expect(find('jobs', 'r2')!.hand_at ?? null).toBeNull();
  });
});

describe('Part 29: the stop dragged takes the hour of its new place and keeps it; the others keep theirs (drag-keeps-spec.md §5)', () => {
  type S = { id: string; eta: number; eta_before: number | null; pin: number | null; pin_new: boolean; pin_was: number | null; new_win: [number, number] | null; win: [number, number] | null; pin_lost: number | null };
  const byId = (a: ReturnType<typeof call>) => Object.fromEntries((a.stops as unknown as S[]).map((x) => [x.id, x]));
  it('dragged DOWN (r1 last): r1 right after r3 (its end + the drive), pinned there (pin_new, accept.at); r2 and r3 keep their hour; a save without that minute is refused; saved: arrive_at, truck_pinned, his order', () => {
    const eta0 = Object.fromEntries((call('day_order_preview', ask(['r1', 'r2', 'r3'], ['r4'])).stops as unknown as S[]).map((x) => [x.id, x.eta]));
    const args = ask(['r2', 'r3', 'r1'], ['r4'], ['r1']);
    const a = call('day_order_preview', args);
    const s = byId(a);
    expect([s.r2.eta, s.r3.eta]).toEqual([eta0.r2, eta0.r3]);
    expect([s.r2.eta_before, s.r3.eta_before]).toEqual([eta0.r2, eta0.r3]);
    expect(s.r1.eta).toBe(eta0.r3 + 120 + 20);
    expect(s.r1).toMatchObject({ pin: s.r1.eta, pin_new: true, pin_was: null, pin_lost: null, eta_before: eta0.r1 });
    expect(a.accept!.at).toEqual({ r1: s.r1.eta });
    expect(a.accept!.pins).toEqual({});
    expect(code(() => call('day_order_save', { ...args, p_accept: { ...a.accept, at: {} } }))).toBe('outcome_changed');
    expect(find('jobs', 'r1')!.arrive_at ?? null).toBeNull();
    call('day_order_save', { ...args, p_accept: a.accept });
    expect(find('jobs', 'r1')).toMatchObject({ arrive_at: s.r1.eta, eta_min: s.r1.eta, truck_pinned: true, stop_order: 3, manual_order: null });
    expect(find('jobs', 'r2')).toMatchObject({ stop_order: 1, eta_min: eta0.r2, arrive_at: null });
    expect(find('jobs', 'r3')).toMatchObject({ stop_order: 2, eta_min: eta0.r3, arrive_at: null });
    // opened again: the day as it is keeps r1 at its minute, nothing to accept
    const again = byId(call('day_order_preview', ask(['r2', 'r3', 'r1'], ['r4'])));
    expect(again.r1).toMatchObject({ eta: s.r1.eta, pin: s.r1.eta, pin_new: false });
    // and the others stay at their hour (r2 is first now: walked from the garage it would come back to 8 h 20)
    expect([again.r2.eta, again.r3.eta]).toEqual([eta0.r2, eta0.r3]);
  });
  it('dragged UP (r3 first): r3 at the garage\'s first hour, pinned; the ones after it pushed only by the time it truly takes (never earlier)', () => {
    const eta0 = Object.fromEntries((call('day_order_preview', ask(['r1', 'r2', 'r3'], ['r4'])).stops as unknown as S[]).map((x) => [x.id, x.eta]));
    const s = byId(call('day_order_preview', ask(['r3', 'r1', 'r2'], ['r4'], ['r3'])));
    expect(s.r3).toMatchObject({ pin_new: true, pin: s.r3.eta });
    expect(s.r1.eta).toBe(s.r3.eta + 120 + 20);
    expect(s.r1.eta).toBeGreaterThan(eta0.r1);
    expect(s.r2.eta).toBeGreaterThanOrEqual(eta0.r2);
  });
  it('D2: a pin already late, not made later by the order: pinned again at its arrival (accept.at, pin_was); made later: lost (accept.pins)', () => {
    put('jobs', { id: 'r2', arrive_at: 600 });                                     // r1 holds the truck until 10 h 20: r2 arrives 10 h 40
    const a = call('day_order_preview', ask(['r1', 'r2', 'r3'], ['r4']));
    const s = byId(a);
    expect(s.r2).toMatchObject({ eta: 640, pin: 640, pin_was: 600, pin_new: false, pin_lost: null });
    expect(a.accept!.at).toEqual({ r2: 640 });
    const b = call('day_order_preview', ask(['r3', 'r1', 'r2'], ['r4'], ['r3']));
    expect(byId(b).r2).toMatchObject({ pin_lost: 600, pin: null });
    expect(b.accept!.pins).toEqual({ r2: 600 });
  });
  it('a stop dragged with a pin: its old minute is replaced by the new one (pin_was), never « lost »; « Laisser l\'app choisir » forgets the pins', () => {
    put('jobs', { id: 'r1', arrive_at: 500 });
    const a = call('day_order_preview', ask(['r2', 'r3', 'r1'], ['r4'], ['r1']));
    expect(byId(a).r1).toMatchObject({ pin_new: true, pin_was: 500, pin_lost: null, pin_moved: false });
    expect(a.accept!.pins).toEqual({});
    const auto = call('day_order_preview', { p_day: DAY, p_lists: null, p_moved: [], p_was: wasNow(), p_auto: true });
    expect(Object.keys(auto.accept!.at)).toEqual([]);
    expect(byId(auto).r1.pin).toBeNull();
  });
});

