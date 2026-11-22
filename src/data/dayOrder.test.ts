/* « Réorganiser la journée » (Part 28, REARRANGE.md §1.4, §2.4-§2.7, U1b): what the app sends and how it reads the answers,
   through the real façade and engine against the pretend server; and the draft kept on the phone per (account, day). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, syncOptions } from './sync';
import { setNet } from './net';
import { getRow } from './store';
import { dayAnswer, dayOrderPreview, dayOrderSave, dayRefusal, dropDraft, isDeadlock, isLockBusy, isNoAnswer, keepDraft, keptDraft, needsConfirm, type DayAnswer } from './dayOrder';

let srv: FakeServer;
let n = 0;
const nextUid = () => `00000000-0000-4000-b200-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
async function start() {
  const uid = nextUid();
  await startSync(clientFor(srv, uid), uid);
  await until(() => net.value.ready);
}
beforeEach(() => {
  srv = new FakeServer();
  syncOptions.realtime = false;
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => stopSync());

const DAY = '2030-01-10';
const ASK = { day: DAY, lists: [{ truck: 't1', block: 'day', jobs: ['j2', 'j1'] }], moved: ['j2'], was: { j1: ['t1', 'day', 1, 480, 720, null, 'booked'], j2: ['t1', 'day', 2, 540, 780, 600, 'booked'] }, auto: false };
const ANSWER = {
  ok: true, day: DAY, basis_ok: true, mode: 'windows', roads: true, rewin: true, auto: false,
  lists: [{ truck: 't1', block: 'day', jobs: ['j2', 'j1'] }],
  stops: [
    { id: 'j2', truck_id: 't1', truck_before: 't1', block: 'day', order: 1, order_before: 2, eta: 500, eta_before: 600, measured: true, win: [540, 780], new_win: [420, 660], win_back: false, flex_fixed: false, flex_later: false, late_min: null, early_min: null, pin: null, pin_lost: 600, pin_moved: true },
    { id: 'j1', truck_id: 't1', truck_before: 't1', block: 'day', order: 2, order_before: 1, eta: 700, eta_before: 500, measured: false, win: [480, 720], new_win: null, win_back: false, flex_fixed: false, flex_later: false, late_min: 0, early_min: 0, pin: null, pin_lost: null, pin_moved: false }
  ],
  trucks: [{ id: 't1', block: 'day', hours_end: 1020, finish: 790, over_min: 0, drive_min: 45, unmeasured: 1 }],
  accept: { windows: { j2: 420 }, flex: {}, late: {}, early: {}, pins: { j2: 600 }, over: {} },
  due_after: 3
};

describe('the preview and the save (§1.4)', () => {
  it('day_order_preview { p_day, p_lists, p_moved, p_was, p_auto }: no op, its trial rows never land on the phone', async () => {
    const got: Record<string, unknown>[] = [];
    srv.put('jobs', { id: 'j1', day: DAY, block: 'day', status: 'booked', truck_id: 't1', stop_order: 1, eta_min: 500 });
    srv.rpc('day_order_preview', (a) => { got.push(a); return { ...ANSWER, rows: { jobs: [{ id: 'j1', day: DAY, block: 'day', status: 'booked', truck_id: 't1', stop_order: 2, eta_min: 700, updated_at: '2031-01-01T00:00:00Z' }] } }; });
    await start();
    const a = await dayOrderPreview(ASK) as DayAnswer;
    expect(got[0]).toEqual({ p_day: DAY, p_lists: ASK.lists, p_moved: ['j2'], p_was: ASK.was, p_auto: false });
    expect(a.kind).toBe('answer');
    expect(a.byId.get('j2')).toMatchObject({ eta: 500, etaBefore: 600, newWin: [420, 660], pinLost: 600, pinMoved: true, measured: true });
    expect(a.byId.get('j1')).toMatchObject({ measured: false, lateMin: 0, newWin: null });
    expect(a.trucks[0]).toEqual({ id: 't1', block: 'day', hoursEnd: 1020, finish: 790, overMin: 0, driveMin: 45, unmeasured: 1 });
    expect(a.acceptRaw).toEqual(ANSWER.accept);
    expect(a.dueAfter).toBe(3);
    expect(needsConfirm(a)).toBe(true);
    expect(getRow('jobs', 'j1')).toMatchObject({ stop_order: 1, eta_min: 500 });
  });
  it('the auto preview: p_lists null, p_auto true', async () => {
    const got: Record<string, unknown>[] = [];
    srv.rpc('day_order_preview', (a) => { got.push(a); return { ...ANSWER, auto: true }; });
    await start();
    await dayOrderPreview({ day: DAY, lists: null, moved: [], was: ASK.was, auto: true });
    expect(got[0]).toMatchObject({ p_lists: null, p_moved: [], p_auto: true });
  });
  it('basis_ok false: what changed and who saved meanwhile', () => {
    expect(dayAnswer({ ok: true, basis_ok: false, gone: ['a'], new: ['b'], changed: ['c'], by: { name: 'Ibrahim' } }))
      .toEqual({ kind: 'basis', gone: ['a'], added: ['b'], changed: ['c'], by: 'Ibrahim' });
    expect(dayAnswer({ basis_ok: false, by: null })).toMatchObject({ kind: 'basis', by: null });
    expect(dayAnswer({ order: [] })).toBe(null);
    expect(dayAnswer(null)).toBe(null);
  });
  it('day_order_save: the SAME p_op given, p_accept untouched, never kept for later; its rows land on the phone at once', async () => {
    const got: Record<string, unknown>[] = [];
    srv.put('jobs', { id: 'j1', day: DAY, block: 'day', status: 'booked', truck_id: 't1', stop_order: 1, eta_min: 500 });
    srv.rpc('day_order_save', (a) => { got.push(a); return { ...ANSWER, saved: true, rows: { jobs: [{ id: 'j1', day: DAY, block: 'day', status: 'booked', truck_id: 't1', stop_order: 2, eta_min: 700, updated_at: '2031-01-01T00:00:00Z' }] } }; });
    await start();
    const a = await dayOrderSave(ASK, ANSWER.accept, 'op-1') as DayAnswer;
    expect(got[0]).toEqual({ p_op: 'op-1', p_day: DAY, p_lists: ASK.lists, p_moved: ['j2'], p_was: ASK.was, p_auto: false, p_accept: ANSWER.accept });
    expect(a.saved).toBe(true);
    expect(getRow('jobs', 'j1')).toMatchObject({ stop_order: 2, eta_min: 700 });
    // no signal: said at once, nothing kept on the phone (R7)
    srv.offline = true;
    setNet({ online: false });
    await expect(dayOrderSave(ASK, {}, 'op-2')).rejects.toMatchObject({ kind: 'network' });
    expect(net.value.pending).toBe(0);
  });
});

describe('the refusals', () => {
  it('its code and what its detail names (detail as JSON text, as PostgREST gives it)', () => {
    expect(dayRefusal({ code: 'P0001', hint: 'truck_ends', message: 'Voiture finit…', details: '{"truck": "t2", "ends": 720, "jobs": ["j9"]}' }))
      .toMatchObject({ code: 'truck_ends', truck: 't2', ends: 720, jobs: ['j9'] });
    expect(dayRefusal({ code: 'P0001', hint: 'day_changed', message: '…', details: '{"gone": ["a"], "new": [], "changed": ["b"], "by": {"name": "Nadia"}}' }))
      .toMatchObject({ code: 'day_changed', by: 'Nadia', jobs: ['a', 'b'] });
    expect(dayRefusal({ code: 'P0001', hint: 'changed', message: '…', details: '{"missing": ["m"], "extra": ["x"]}' })?.jobs).toEqual(['m', 'x']);
    const oc = dayRefusal({ code: 'P0001', hint: 'outcome_changed', message: '…', details: JSON.stringify(ANSWER) })!;
    expect((dayAnswer(oc.detail) as DayAnswer).byId.get('j2')?.newWin).toEqual([420, 660]);
    expect(dayRefusal({ code: 'P0001', hint: 'needs_truck', message: '…', details: null })).toMatchObject({ code: 'needs_truck', detail: {}, jobs: [] });
    expect(dayRefusal({ code: 'P0001', hint: 'bad_list', details: 'not json' })?.detail).toEqual({});
  });
  it('a deadlock, a lock given up, no answer: never a refusal, each told apart', () => {
    const dead = { code: '40P01', message: 'deadlock detected' };
    const lock = { code: '55P03', message: 'canceling statement due to lock timeout' };
    const lost = { name: 'TimeoutError', message: 'timeout' };
    for (const e of [dead, lock, lost]) expect(dayRefusal(e)).toBe(null);
    expect([isDeadlock(dead), isLockBusy(dead), isNoAnswer(dead)]).toEqual([true, false, false]);
    expect([isDeadlock(lock), isLockBusy(lock), isNoAnswer(lock)]).toEqual([false, true, false]);
    expect([isDeadlock(lost), isLockBusy(lost), isNoAnswer(lost)]).toEqual([false, false, true]);
  });
});

describe('the draft kept on the phone (days F12)', () => {
  const kept = { was: { j1: ['t1', 'day', 1, null, null, null, 'booked'] }, lists: [{ truck: 't1', block: 'day', jobs: ['j1'] }], moved: ['j1'], auto: false, at: '2026-11-22T02:10:00.000Z' };
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it('per account and day: kept, read back, dropped', () => {
    expect(keepDraft('u1', DAY, kept)).toBe(true);
    expect(localStorage.getItem(`his.dayOrder.u1.${DAY}`)).toBeTruthy();
    expect(keptDraft('u1', DAY)).toEqual(kept);
    expect(keptDraft('u2', DAY)).toBe(null);                                         // another account
    expect(keptDraft('u1', '2030-01-11')).toBe(null);                               // another day
    dropDraft('u1', DAY);
    expect(keptDraft('u1', DAY)).toBe(null);
  });
  it('a storage that throws: nothing kept, nothing breaks; an unreadable value reads as none', () => {
    localStorage.setItem(`his.dayOrder.u1.${DAY}`, '{not json');
    expect(keptDraft('u1', DAY)).toBe(null);
    localStorage.setItem(`his.dayOrder.u1.${DAY}`, JSON.stringify({ hello: 1 }));
    expect(keptDraft('u1', DAY)).toBe(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(keepDraft('u1', DAY, kept)).toBe(false);
    expect(keptDraft('u1', DAY)).toBe(null);
    expect(() => dropDraft('u1', DAY)).not.toThrow();
  });
});
