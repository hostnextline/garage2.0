/* The background measure of the trips still missing (roadsSweep.ts): every rule, with pretend timers and a pretend data
   layer (the switch, the person, the network, and the function « drive »'s status and sweep). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@preact/signals';

/* ---------- the pretend app around the service ---------- */
const meSig = signal<{ id: string; owner: boolean; roles: string[] } | null>({ id: 'u-owner', owner: true, roles: ['owner'] });
const previewSig = signal(false);
const onSig = signal(true);
const netSig = signal({ online: true, ready: true });
const sweepingSig = signal(0);
type Status = { ok: true; key: boolean; on: boolean; left: number; left0: number; month: { month: string; tx: number; cap: number } | null; rows: { tomtom: number; osrm: number; none: number } } | { ok: false; code: string };
const status = vi.fn<() => Promise<Status>>();
const measure = vi.fn<() => Promise<Record<string, unknown>>>();
// the factories run before this file's variables exist: they are read when the service uses them
vi.mock('../data/auth', () => ({ get me() { return meSig; }, get preview() { return previewSig; } }));
vi.mock('../data/select', () => ({ get roadsOn() { return onSig; } }));
vi.mock('../data/net', () => ({ get net() { return netSig; } }));
vi.mock('../data/roads', () => ({
  roadsStatus: () => status(),
  measureRoads: () => measure(),
  get roadsSweeping() { return sweepingSig; }
}));

import { whyNot, sweepTurn, startRoadsSweep, stopRoadsSweep, roadsSweep, leftNow, SWEEP_RULES, type SweepFacts } from './roadsSweep';

const left = (n: number, on = true): Status => ({ ok: true, key: true, on, left: n, left0: n, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } });
// a sweep that says nothing more can be done in a call (more false): one call a turn (the loop on more: below)
const SWEPT = { ok: true, ready: false, left: 40, left0: 0, stored: 60, planned: 1, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false };
let browserOnline = true;
const FACTS: SweepFacts = { on: true, owner: true, office: false, preview: false, ready: true, online: true, browserOnline: true, sweeping: false };

beforeEach(() => {
  stopRoadsSweep();
  meSig.value = { id: 'u-owner', owner: true, roles: ['owner'] };
  previewSig.value = false; onSig.value = true; netSig.value = { online: true, ready: true }; sweepingSig.value = 0;
  status.mockReset(); measure.mockReset();
  status.mockResolvedValue(left(12));
  measure.mockResolvedValue(SWEPT);
  browserOnline = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => browserOnline);
});
afterEach(() => { stopRoadsSweep(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('whyNot: the rules of a turn, in order', () => {
  it('goes on only with the switch on, the owner or the office, no preview, the first download done, signal, nothing under way', () => {
    expect(whyNot(FACTS)).toBeNull();
    expect(whyNot({ ...FACTS, owner: false, office: true })).toBeNull();
    expect(whyNot({ ...FACTS, on: false })).toBe('off');
    expect(whyNot({ ...FACTS, owner: false, office: false })).toBe('role');
    expect(whyNot({ ...FACTS, preview: true })).toBe('preview');
    expect(whyNot({ ...FACTS, ready: false })).toBe('not_ready');
    expect(whyNot({ ...FACTS, online: false })).toBe('offline');
    expect(whyNot({ ...FACTS, browserOnline: false })).toBe('offline');
    expect(whyNot({ ...FACTS, sweeping: true })).toBe('busy');
    // the first « no » wins
    expect(whyNot({ ...FACTS, on: false, owner: false, online: false })).toBe('off');
  });
});

describe('a turn', () => {
  it('something left: the status first, then the sweep (one call: it says nothing more)', async () => {
    const t = await sweepTurn();
    expect(status).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(t).toMatchObject({ did: 'measured', answer: SWEPT });
    expect(roadsSweep.value).toMatchObject({ busy: false, turns: 1 });
    expect(document.documentElement.dataset.roadsSweep).toBe('idle');
  });
  it('the office too', async () => {
    meSig.value = { id: 'u-office', owner: false, roles: ['office'] };
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(1);
  });
  it('nothing left: the status only, never a sweep', async () => {
    status.mockResolvedValue(left(0));
    expect(await sweepTurn()).toMatchObject({ did: 'nothing_left' });
    expect(measure).not.toHaveBeenCalled();
  });
  it('the server says its switch is off (the phone\'s copy is late): no sweep', async () => {
    status.mockResolvedValue(left(30, false));
    expect(await sweepTurn()).toMatchObject({ did: 'nothing_left' });
    expect(measure).not.toHaveBeenCalled();
  });
  it('switch off (the rollback state): nothing is asked at all', async () => {
    onSig.value = false;
    expect(await sweepTurn()).toMatchObject({ did: 'skipped', why: 'off' });
    expect(status).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
  it('a mechanic: nothing is asked', async () => {
    meSig.value = { id: 'u-saleh', owner: false, roles: ['mechanic'] };
    expect(await sweepTurn()).toMatchObject({ did: 'skipped', why: 'role' });
    expect(status).not.toHaveBeenCalled();
  });
  it('« Voir l\'app comme… », the first download not done, no signal: nothing is asked', async () => {
    previewSig.value = true;
    expect(await sweepTurn()).toMatchObject({ why: 'preview' });
    previewSig.value = false; netSig.value = { online: true, ready: false };
    expect(await sweepTurn()).toMatchObject({ why: 'not_ready' });
    netSig.value = { online: false, ready: true };
    expect(await sweepTurn()).toMatchObject({ why: 'offline' });
    netSig.value = { online: true, ready: true }; browserOnline = false;
    expect(await sweepTurn()).toMatchObject({ why: 'offline' });
    expect(status).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
  it('never two at once: a second turn while one runs asks nothing', async () => {
    let end!: (v: Record<string, unknown>) => void;
    measure.mockImplementation(() => new Promise((r) => { end = r; }));
    const a = sweepTurn();
    await vi.waitFor(() => expect(measure).toHaveBeenCalledTimes(1));
    expect(roadsSweep.value.busy).toBe(true);
    expect(await sweepTurn()).toMatchObject({ did: 'skipped', why: 'busy' });
    end(SWEPT);
    await a;
    expect(status).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(roadsSweep.value.turns).toBe(1);
  });
  it('never beside « Mesurer maintenant » of the settings panel (roadsSweeping): nothing is asked', async () => {
    sweepingSig.value = 1;
    expect(await sweepTurn()).toMatchObject({ did: 'skipped', why: 'busy' });
    expect(status).not.toHaveBeenCalled();
  });
  it('the panel starts its measure while the status is asked: no second sweep', async () => {
    status.mockImplementation(async () => { sweepingSig.value = 1; return left(5); });
    expect(await sweepTurn()).toMatchObject({ did: 'skipped', why: 'busy' });
    expect(measure).not.toHaveBeenCalled();
  });
  it('a failure (no answer, a refusal) changes nothing and never throws; the next turn tries again', async () => {
    status.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await sweepTurn()).toMatchObject({ did: 'failed', code: 'network' });
    status.mockResolvedValueOnce({ ok: false, code: 'signin' });
    expect(await sweepTurn()).toMatchObject({ did: 'failed', code: 'signin' });
    measure.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout' }));
    expect(await sweepTurn()).toMatchObject({ did: 'failed', code: 'timeout' });
    // a refusal of the sweep itself (the brakes) is an answer
    measure.mockResolvedValueOnce({ ok: false, code: 'busy', at: 'drive' });
    expect(await sweepTurn()).toMatchObject({ did: 'measured', answer: { ok: false, code: 'busy' } });
    expect(roadsSweep.value.busy).toBe(false);
  });
});

describe('the timers: when the app opens, then every 10 minutes', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
  it('nothing before the first download is done; then one turn a few seconds after; then every 10 minutes', async () => {
    netSig.value = { online: true, ready: false };
    startRoadsSweep();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).not.toHaveBeenCalled();
    netSig.value = { online: true, ready: true };
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.readyPollMs + SWEEP_RULES.firstMs - 1);
    expect(status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledTimes(1);
    // started at 0: the 10-minute timer counts from the start (written in minutes, not read from SWEEP_RULES, so the
    // contract's « every 10 minutes » is pinned: final-critic A7)
    expect(SWEEP_RULES.everyMs).toBe(600_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 35_000);
    expect(measure).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(measure).toHaveBeenCalledTimes(3);
  });
  it('started once for the life of the page', async () => {
    startRoadsSweep(); startRoadsSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.readyPollMs + SWEEP_RULES.firstMs);
    expect(status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.everyMs);
    expect(status).toHaveBeenCalledTimes(2);
  });
  it('while nothing is left: only the status every 10 minutes, never a sweep; something new: swept at the next turn', async () => {
    status.mockResolvedValue(left(0));
    startRoadsSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.readyPollMs + SWEEP_RULES.firstMs);
    await vi.advanceTimersByTimeAsync(3 * SWEEP_RULES.everyMs);
    expect(status).toHaveBeenCalledTimes(4);
    expect(measure).not.toHaveBeenCalled();
    status.mockResolvedValue(left(2));
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.everyMs);
    expect(measure).toHaveBeenCalledTimes(1);
  });
  it('switch off all along: nothing is ever asked', async () => {
    onSig.value = false;
    startRoadsSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.readyPollMs + SWEEP_RULES.firstMs + 6 * SWEEP_RULES.everyMs);
    expect(status).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
  it('a turn missed offline is done a few seconds after the signal comes back; an « online » with nothing missed does nothing', async () => {
    startRoadsSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.readyPollMs + SWEEP_RULES.firstMs);
    expect(status).toHaveBeenCalledTimes(1);
    // a flaky signal that says « online » again and again: no extra turn
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.onlineMs);
    expect(status).toHaveBeenCalledTimes(1);
    // the 10-minute turn falls while offline
    browserOnline = false;
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.everyMs);
    expect(status).toHaveBeenCalledTimes(1);
    browserOnline = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.onlineMs - 1);
    expect(status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenCalledTimes(2);
    expect(measure).toHaveBeenCalledTimes(2);
  });
  it('stopRoadsSweep stops every timer', async () => {
    startRoadsSweep();
    stopRoadsSweep();
    await vi.advanceTimersByTimeAsync(SWEEP_RULES.readyPollMs + SWEEP_RULES.firstMs + 2 * SWEEP_RULES.everyMs);
    expect(status).not.toHaveBeenCalled();
  });
});

/* the lead's decision of 2026-11-20 19:20 (build-fn « for the lead »): the loop goes on while the sweep says `more`, never
   while `left` is above 0 — without TomTom's key `left` never reaches 0 (OSRM cannot measure the rush hours) */
describe('the loop of a turn: on `more`, never on `left`', () => {
  const ans = (o: Record<string, unknown>) => ({ ...SWEPT, ...o });
  it('calls again while `more` is true, and stops when it is false (left still above 0)', async () => {
    measure.mockResolvedValueOnce(ans({ more: true, stored: 60, left: 200 }))
      .mockResolvedValueOnce(ans({ more: true, stored: 50, left: 150 }))
      .mockResolvedValueOnce(ans({ more: false, stored: 10, left: 140 }));
    const t = await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenCalledTimes(1);
    expect(t).toMatchObject({ did: 'measured', answer: { more: false, left: 140 } });
    // left 140 > 0, more false: nothing more this turn
    expect(roadsSweep.value).toMatchObject({ busy: false, turns: 1 });
  });
  it('more false with plenty left: ONE call (never a loop on left)', async () => {
    measure.mockResolvedValue(ans({ more: false, stored: 0, left: 500, left0: 0 }));
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(1);
  });
  it('at most SWEEP_RULES.maxCalls calls a turn, even while `more` stays true', async () => {
    measure.mockResolvedValue(ans({ more: true, stored: 30 }));
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(SWEEP_RULES.maxCalls);
    expect(SWEEP_RULES.maxCalls).toBeLessThanOrEqual(6);           // at most 6 of the person's 60 calls an hour… per turn
  });
  it('a call that measured nothing and planned nothing ends the turn (never an empty loop); a refusal too', async () => {
    measure.mockResolvedValue(ans({ more: true, stored: 0, planned: 0 }));
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(1);
    measure.mockReset();
    measure.mockResolvedValueOnce(ans({ more: true, stored: 5 })).mockResolvedValueOnce({ ok: false, code: 'busy', at: 'drive' });
    expect(await sweepTurn()).toMatchObject({ did: 'measured', answer: { ok: false, code: 'busy' } });
    expect(measure).toHaveBeenCalledTimes(2);
  });
  it('the switch turned off, the signal lost or « Mesurer maintenant » started between two calls: no next call', async () => {
    measure.mockImplementation(async () => { onSig.value = false; return ans({ more: true, stored: 30 }); });
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(1);
    onSig.value = true;
    measure.mockReset();
    measure.mockImplementation(async () => { browserOnline = false; return ans({ more: true, stored: 30 }); });
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(1);
  });
  it('without TomTom (no key on the server, a ceiling of 0, the month reached): the rush-hour trips are not « left » — no sweep for them alone', async () => {
    const st = (key: boolean, left: number, left0: number, month: { tx: number; cap: number } | null = { tx: 0, cap: 10000 }): Status =>
      ({ ok: true, key, on: true, left, left0, month: month ? { month: '2026-11-01', ...month } : null, rows: { tomtom: 0, osrm: 0, none: 0 } });
    expect(leftNow(st(false, 40, 0) as never)).toBe(0);
    expect(leftNow(st(false, 40, 3) as never)).toBe(3);
    expect(leftNow(st(true, 40, 0, { tx: 0, cap: 0 }) as never)).toBe(0);
    expect(leftNow(st(true, 40, 0, { tx: 10000, cap: 10000 }) as never)).toBe(0);
    expect(leftNow(st(true, 40, 0) as never)).toBe(40);
    expect(leftNow(st(true, 40, 0, null) as never)).toBe(40);
    status.mockResolvedValue(st(false, 40, 0));
    expect(await sweepTurn()).toMatchObject({ did: 'nothing_left' });
    expect(measure).not.toHaveBeenCalled();
    status.mockResolvedValue(st(false, 40, 2));
    await sweepTurn();
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
