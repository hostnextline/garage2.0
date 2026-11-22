/* « Vraies routes » (CONTRACT §4): what the app asks the function « drive » before a screen asks the planner for
   moments, point by point, with the real modules (the function « drive » and the planner pretended). The proofs of the
   review (reports/review-data.md H1, M2–M4, L1, L2) are the tests marked with their id. The warm after a booking or a
   move that reached the server, the switch and the two previews go through the real engine: roads.sent.test.ts. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fn = vi.hoisted(() => ({
  impl: null as null | ((name: string, body: Record<string, unknown>, ms?: number) => Promise<unknown>),
  calls: [] as { name: string; body: Record<string, unknown>; at: number; ms?: number }[]
}));
const rq = vi.hoisted(() => ({ calls: [] as { name: string; at: number }[], rows: [] as unknown[] }));
const pulls = vi.hoisted(() => [] as string[]);
vi.mock('./auth', async (orig) => {
  const real = await orig<typeof import('./auth')>();
  return {
    ...real,
    callFn: (name: string, body: Record<string, unknown>, ms?: number) => {
      fn.calls.push({ name, body, at: Date.now(), ms });
      return fn.impl ? fn.impl(name, body, ms) : new Promise(() => undefined);
    }
  };
});
vi.mock('./client', async (orig) => {
  const real = await orig<typeof import('./client')>();
  return { ...real, ask: async () => { rq.calls.push({ name: 'planner', at: Date.now() }); return rq.rows; } };
});
vi.mock('./sync', async (orig) => {
  const real = await orig<typeof import('./sync')>();
  return { ...real, pull: async (t: string) => { pulls.push(t); } };
});

import { warmRoads, retryRoads, placeRoads, resetRoads, measureRoads, roadsStatus, roadsTick, roadsSweeping, driveAnswer, placeKey, WARM_MS } from './roads';
import { suggestBlocks, suggestWindows, type Suggestion } from './api';
import { upsertLocal, clearAll } from './store';
import { viewAs } from './auth';
import type { Access } from './types';
import { Refused } from '../lib/errors';
import { today, addDays } from '../lib/dates';

const P = { lat: 45.5017, lng: -73.5673 };
const setRoads = (on: boolean, more: Record<string, unknown> = {}) =>
  upsertLocal('settings', [{ id: '1', updated_at: new Date().toISOString(), booking: { roads_on: on, ...more } } as never], { force: true });
const drive = () => fn.calls.filter((c) => c.name === 'drive');
const pointWarms = () => drive().filter((c) => c.body.action === 'warm' && c.body.only === 'point');
const rests = () => drive().filter((c) => c.body.action === 'warm' && c.body.only === undefined);
const ANS = { ok: true, ready: true, left: 0, left0: 0, stored: 3, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false };
const answered = (x: Record<string, unknown> = {}) => async () => ({ ...ANS, ...x });
const never = () => new Promise<never>(() => undefined);
const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetRoads(); clearAll(); viewAs.value = null;
  fn.calls.length = 0; fn.impl = null; rq.calls.length = 0; rq.rows = []; pulls.length = 0;
});
afterEach(() => { vi.useRealTimers(); viewAs.value = null; });

describe('switch off: nothing leaves, nothing waits (the rollback state)', () => {
  it('warmRoads answers at once, suggestBlocks / suggestWindows ask the planner at once, no « drive » call', async () => {
    setRoads(false);
    const t0 = Date.now();
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: true });
    await suggestBlocks(P.lat, P.lng, 60, today(), 14);
    await suggestWindows(P.lat, P.lng, 60, today());
    expect(fn.calls).toEqual([]);
    expect(rq.calls).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(placeRoads(P)).toBeNull();
  });
  it('the setting missing is off', async () => {
    upsertLocal('settings', [{ id: '1', updated_at: new Date().toISOString(), booking: {} } as never], { force: true });
    await suggestBlocks(P.lat, P.lng, 60, today(), 14);
    expect(fn.calls).toEqual([]);
  });
});

describe('switch on: at once and nothing sent when there is nothing to measure', () => {
  beforeEach(() => setRoads(true));
  it('no position (an address not located yet)', async () => {
    expect(await warmRoads(null, today(), 14)).toEqual({ ok: true, ready: true });
    await suggestBlocks(null, null, 60, today(), 14);
    expect(fn.calls).toEqual([]);
    expect(rq.calls).toHaveLength(1);
  });
  it('a position that is not one (NaN, out of range)', async () => {
    expect(await warmRoads({ lat: Number.NaN, lng: -73 }, today(), 14)).toEqual({ ok: true, ready: true });
    expect(await warmRoads({ lat: 120, lng: -73 }, today(), 14)).toEqual({ ok: true, ready: true });
    expect(fn.calls).toEqual([]);
  });
  it('only past days', async () => {
    expect(await warmRoads(P, addDays(today(), -5), 3)).toEqual({ ok: true, ready: true });
    expect(fn.calls).toEqual([]);
  });
  it('« Voir l\'app comme… »: nothing is measured for the person previewed', async () => {
    viewAs.value = { id: 'x', roles: ['office'], owner: false, rights: {}, trucks: [] } as unknown as Access;
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: true });
    expect(fn.calls).toEqual([]);
  });
  it('the phone says it has no signal: not ready, nothing sent', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(await warmRoads(P, today(), 14)).toEqual({ ok: false, ready: false });
      expect(fn.calls).toEqual([]);
    } finally { spy.mockRestore(); }
  });
  it('the demo without a pretend « drive » (code demo): ready, nothing said, never asked again', async () => {
    fn.impl = async () => ({ ok: false, code: 'demo', error: 'Pas disponible dans la démo.' });
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: true });
    expect(placeRoads(P)).toBeNull();
    await warmRoads({ lat: 45.6, lng: -73.7 }, today(), 14);
    await retryRoads(P);
    expect(fn.calls).toHaveLength(1);
  });
});

describe('switch on: the request', () => {
  beforeEach(() => setRoads(true));
  it('is the contract\'s: drive { action: warm, point, from, days ≤ 14, only: point }, then the rest without only', async () => {
    fn.impl = answered();
    expect(await warmRoads(P, today(), 30)).toEqual({ ok: true, ready: true });
    await settle();
    expect(pointWarms()).toHaveLength(1);
    expect(pointWarms()[0].body).toEqual({ action: 'warm', point: P, from: today(), days: 14, only: 'point' });
    // the rest of those days (other trips, rush hours) without « only », nobody waiting for it
    expect(rests()).toHaveLength(1);
    expect(rests()[0].body).toEqual({ action: 'warm', point: P, from: today(), days: 14 });
  });
  it('the screen does not wait for the rest', async () => {
    let n = 0;
    fn.impl = (_n, body) => (body.only === 'point' ? Promise.resolve({ ...ANS }) : (n++, never()));
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: true });
    await settle();
    expect(n).toBe(1);
  });
  it('the switch turned OFF while the address was measured: the rest is not asked (switch off sends nothing)', async () => {
    let done!: (v: unknown) => void;
    fn.impl = (_n, body) => (body.only === 'point' ? new Promise((r) => { done = r; }) : Promise.resolve({ ...ANS }));
    setRoads(true);
    const w = warmRoads(P, today(), 14);
    await settle();
    expect(pointWarms()).toHaveLength(1);
    setRoads(false);                                        // the owner turns it off (realtime brings the settings)
    done({ ...ANS });
    await w;
    await settle(); await settle();
    expect(rests()).toHaveLength(0);
  });
  it('never throws: no signal, a timeout, a refusal, an answer that is not one', async () => {
    fn.impl = async () => { throw new TypeError('Failed to fetch'); };
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: false, ready: false });
    resetRoads();
    fn.impl = async () => { throw Object.assign(new Error('timeout'), { code: 'timeout' }); };
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: false, ready: false });
    expect(placeRoads(P)).toMatchObject({ state: 'unavailable', code: 'timeout' });
    resetRoads();
    fn.impl = async () => ({ ok: false, code: 'busy', error: 'Trop de demandes.' });
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: false, ready: false });
    expect(placeRoads(P)).toMatchObject({ state: 'unavailable', code: 'busy' });
    resetRoads();
    fn.impl = async () => 'nonsense';
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: false, ready: false });
  });
  it('waits at most waitMs (3.5 s by default), then the planner is asked; the measure goes on behind', async () => {
    fake();
    const asked = suggestBlocks(P.lat, P.lng, 60, today(), 14);
    await vi.advanceTimersByTimeAsync(WARM_MS - 1);
    expect(rq.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    await asked;
    expect(rq.calls).toHaveLength(1);
    expect(placeRoads(P)?.state).toBe('measuring');
  });
  it('waitMs 0: not at all', async () => {
    fake();
    expect(await warmRoads(P, today(), 14, 0)).toEqual({ ok: true, ready: false });
    await suggestBlocks(P.lat, P.lng, 60, today(), 14, null, false, null, 0);
    expect(rq.calls).toHaveLength(1);
    expect(pointWarms()).toHaveLength(1);
  });
  it('ready false (a trip of the point still missing) → « pas encore mesuré » (unavailable once the rest also ended)', async () => {
    fn.impl = answered({ ready: false, left0: 2, tomtom: 'over_budget', osrm: 'down' });
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: false });
    await settle();
    expect(placeRoads(P)).toMatchObject({ state: 'unavailable', tomtom: 'over_budget', osrm: 'down' });
  });
  it('more: the function stopped at its limit → still « mesure en cours » while the rest goes on, then measured', async () => {
    let rest!: (v: unknown) => void;
    fn.impl = (_n, body) => (body.only === 'point' ? Promise.resolve({ ...ANS, ready: false, more: true }) : new Promise((r) => { rest = r; }));
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: false });
    expect(placeRoads(P)?.state).toBe('measuring');
    rest({ ...ANS });
    await settle(); await settle();
    expect(placeRoads(P)?.state).toBe('measured');
  });
  it('a re-plan that followed (planned > 0) pulls the appointments; a measure a screen stopped waiting for raises roadsTick', async () => {
    fake();
    let answer!: (v: unknown) => void;
    fn.impl = (_n, body) => (body.only === 'point' ? new Promise((r) => { answer = r; }) : Promise.resolve({ ...ANS, stored: 0 }));
    const w = warmRoads(P, today(), 14);
    await vi.advanceTimersByTimeAsync(WARM_MS + 1);
    expect(await w).toEqual({ ok: true, ready: false });
    expect(roadsTick.value).toBe(0);
    answer({ ...ANS, stored: 4, planned: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(roadsTick.value).toBe(1);
    expect(pulls).toContain('jobs');
  });
});

describe('one request per place and range of days, remembered', () => {
  beforeEach(() => setRoads(true));
  it('the first two weeks: blocks (14 days) + each day of the windows + an address 40 m away = ONE warm', async () => {
    fn.impl = answered();
    const asks: Promise<unknown>[] = [suggestBlocks(P.lat, P.lng, 60, today(), 14)];
    for (let i = 0; i < 14; i++) asks.push(suggestWindows(P.lat, P.lng, 60, addDays(today(), i)));
    asks.push(suggestBlocks(P.lat + 0.0002, P.lng + 0.0002, 60, today(), 14));
    await Promise.all(asks);
    expect(pointWarms()).toHaveLength(1);
    expect(rq.calls).toHaveLength(16);
  });
  it('the place is the server\'s drive_key (3 decimals, about 100 m)', () => {
    expect(placeKey(P)).toBe(placeKey({ lat: 45.50174, lng: -73.56726 }));
    expect(placeKey(P)).not.toBe(placeKey({ lat: 45.5027, lng: -73.5673 }));
  });
  it('M2: a page of the window picker past the two weeks (7 days one by one + its later scores) = ONE warm, ONE rest', async () => {
    fn.impl = answered();
    const t = today();
    const asks: Promise<unknown>[] = [];
    for (let i = 14; i < 21; i++) asks.push(suggestWindows(P.lat, P.lng, 60, addDays(t, i)));
    asks.push(suggestBlocks(P.lat, P.lng, 60, addDays(t, 14), 7));
    await Promise.all(asks);
    await settle();
    expect(pointWarms()).toHaveLength(1);
    expect(pointWarms()[0].body).toMatchObject({ from: addDays(t, 14), days: 14 });
    expect(rests()).toHaveLength(1);
  });
  it('M2: a range across two pages asks both pages (each shared after)', async () => {
    fn.impl = answered();
    await warmRoads(P, addDays(today(), 10), 7);
    expect(pointWarms().map((c) => c.body.from)).toEqual([today(), addDays(today(), 14)]);
    await warmRoads(P, addDays(today(), 3), 1);
    await warmRoads(P, addDays(today(), 20), 5);
    expect(pointWarms()).toHaveLength(2);
  });
  it('a page is cut at the horizon (horizon_days)', async () => {
    setRoads(true, { horizon_days: 20 });
    fn.impl = answered();
    await warmRoads(P, addDays(today(), 16), 3);
    expect(pointWarms()[0].body).toMatchObject({ from: addDays(today(), 14), days: 6 });
    // past the horizon: nothing to measure
    expect(await warmRoads(P, addDays(today(), 25), 3)).toEqual({ ok: true, ready: true });
    expect(pointWarms()).toHaveLength(1);
  });
  it('measured: remembered 10 minutes, then asked again', async () => {
    fake();
    fn.impl = answered();
    await warmRoads(P, today(), 14);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: true });
    expect(pointWarms()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(61_000);
    await warmRoads(P, today(), 14);
    expect(pointWarms()).toHaveLength(2);
  });
  it('not measured (a failure): remembered 1 minute only; « Réessayer » asks at once', async () => {
    fake();
    fn.impl = async () => { throw new TypeError('Failed to fetch'); };
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: false, ready: false });
    expect(placeRoads(P)?.state).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(30_000);
    await warmRoads(P, today(), 14);
    expect(pointWarms()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    fn.impl = answered();
    expect(await warmRoads(P, today(), 14)).toEqual({ ok: true, ready: true });
    expect(pointWarms()).toHaveLength(2);
    expect(placeRoads(P)?.state).toBe('measured');
    fn.impl = async () => { throw new TypeError('Failed to fetch'); };
    await retryRoads(P);
    expect(pointWarms()).toHaveLength(3);
  });
});

describe('M4: the wait counts from the start of the measure, once for every screen', () => {
  beforeEach(() => setRoads(true));
  it('a measure no screen waited for to its end: a later ask of that place does not wait again', async () => {
    fake();
    const p1 = suggestBlocks(P.lat, P.lng, 60, today(), 14);
    await vi.advanceTimersByTimeAsync(WARM_MS + 1);
    await p1;
    expect(rq.calls).toHaveLength(1);
    const p2 = suggestWindows(P.lat, P.lng, 60, addDays(today(), 3));
    await vi.advanceTimersByTimeAsync(1);
    await p2;
    expect(rq.calls).toHaveLength(2);
    expect(pointWarms()).toHaveLength(1);
  });
  it('a second screen asking 2 s after the first waits only the 1.5 s left', async () => {
    fake();
    const p1 = suggestBlocks(P.lat, P.lng, 60, today(), 14);
    await vi.advanceTimersByTimeAsync(2000);
    const p2 = suggestWindows(P.lat, P.lng, 60, addDays(today(), 2));
    await vi.advanceTimersByTimeAsync(WARM_MS - 2000 + 1);
    await Promise.all([p1, p2]);
    expect(rq.calls).toHaveLength(2);
  });
  it('the far checks can ask without any wait (waitMs 0): suggestBlocks and suggestWindows take it last', async () => {
    fake();
    await suggestBlocks(P.lat, P.lng, 60, addDays(today(), 3), 1, 'job', false, null, 0);
    await suggestWindows(P.lat, P.lng, 60, addDays(today(), 3), 'job', false, null, 0);
    expect(rq.calls).toHaveLength(2);
    // the measure was started all the same (shared by the screen that opens next)
    expect(pointWarms()).toHaveLength(1);
  });
});

describe('L1: what a screen says of an address is per range of days', () => {
  beforeEach(() => setRoads(true));
  it('two weeks measured, then a day of week 3 fails: the two weeks still read « mesuré », week 3 « pas disponible »', async () => {
    fn.impl = answered();
    await warmRoads(P, today(), 14);
    expect(placeRoads(P)?.state).toBe('measured');
    fn.impl = async () => ({ ok: false, code: 'busy', at: 'drive' });
    await suggestWindows(P.lat, P.lng, 60, addDays(today(), 18));
    expect(placeRoads(P)?.state).toBe('measured');
    expect(placeRoads(P, today(), 14)?.state).toBe('measured');
    expect(placeRoads(P, addDays(today(), 18), 1)).toMatchObject({ state: 'unavailable', code: 'busy' });
  });
  it('a later page in flight does not say « mesure en cours » on the two weeks already measured', async () => {
    fn.impl = answered();
    await warmRoads(P, today(), 14);
    fn.impl = () => never();
    void warmRoads(P, addDays(today(), 15), 1, 0);
    expect(placeRoads(P)?.state).toBe('measured');
    expect(placeRoads(P, addDays(today(), 15), 1)?.state).toBe('measuring');
  });
  it('switch off: nothing to say', async () => {
    fn.impl = answered();
    await warmRoads(P, today(), 14);
    setRoads(false);
    expect(placeRoads(P)).toBeNull();
  });
});

describe('L2: a request that never ends', () => {
  beforeEach(() => setRoads(true));
  it('« Réessayer » replaces it (a request a screen already gave up on)', async () => {
    fake();
    fn.impl = () => never();
    await warmRoads(P, today(), 14, 0);
    await vi.advanceTimersByTimeAsync(WARM_MS + 1);
    void retryRoads(P, today(), 14, 0);
    expect(pointWarms()).toHaveLength(2);
  });
  it('« Réessayer » a moment after the ask shares the request under way', async () => {
    fake();
    fn.impl = () => never();
    await warmRoads(P, today(), 14, 0);
    await vi.advanceTimersByTimeAsync(500);
    void retryRoads(P, today(), 14, 0);
    expect(pointWarms()).toHaveLength(1);
  });
  it('is given up by itself after its limit: « pas disponible », asked again a minute later', async () => {
    fake();
    fn.impl = () => never();
    await warmRoads(P, today(), 14, 0);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(placeRoads(P)).toMatchObject({ state: 'unavailable', code: 'timeout' });
    await vi.advanceTimersByTimeAsync(61_000);
    await warmRoads(P, today(), 14, 0);
    expect(pointWarms()).toHaveLength(2);
  });
  it('the late answer of a request replaced by « Réessayer » does not overwrite what the new one said', async () => {
    fake();
    let late!: (v: unknown) => void;
    fn.impl = () => new Promise((r) => { late = r; });
    await warmRoads(P, today(), 14, 0);
    await vi.advanceTimersByTimeAsync(WARM_MS + 1);
    const first = late;
    fn.impl = answered();
    await retryRoads(P);
    expect(placeRoads(P)?.state).toBe('measured');
    first({ ok: false, code: 'busy' });
    await vi.advanceTimersByTimeAsync(0);
    expect(placeRoads(P)?.state).toBe('measured');
  });
});

describe('measureRoads (« Mesurer maintenant », the background sweep)', () => {
  it('drive { action: sweep }; its answer read with every key typed', async () => {
    fn.impl = async () => ({ ok: true, ready: false, left: 12, left0: 3, stored: 40, planned: 2, kept: [{ day: '2026-12-01', block: 'am' }, { bad: 1 }], late: ['j1', 7], no_road: 1, tomtom: 'ok', osrm: 'weird', spent: { month: '2026-11-01', tx: 120, cap: 10000 }, more: true });
    const a = await measureRoads();
    expect(drive().map((c) => c.body)).toEqual([{ action: 'sweep' }]);
    expect(a).toEqual({ ok: true, ready: false, left: 12, left0: 3, stored: 40, planned: 2, kept: [{ day: '2026-12-01', block: 'am' }], late: ['j1'], no_road: 1, tomtom: 'ok', osrm: 'unused', spent: { month: '2026-11-01', tx: 120, cap: 10000 }, more: true });
    expect(pulls).toContain('jobs');
    expect(roadsTick.value).toBe(1);
  });
  it('a refusal is an answer; no signal throws', async () => {
    fn.impl = async () => ({ ok: false, code: 'not_allowed', error: 'Non.' });
    expect(await measureRoads()).toEqual({ ok: false, code: 'not_allowed', error: 'Non.', at: 'drive' });
    fn.impl = async () => { throw new TypeError('Failed to fetch'); };
    await expect(measureRoads()).rejects.toThrow('Failed to fetch');
    expect(roadsSweeping.value).toBe(0);
  });
  it('H1: two sweeps asked at once are ONE request (the background and « Mesurer maintenant »)', async () => {
    let end!: (v: unknown) => void;
    fn.impl = () => new Promise((r) => { end = r; });
    const a = measureRoads(), b = measureRoads();
    expect(roadsSweeping.value).toBe(1);
    end({ ...ANS, more: true });
    const [x, y] = await Promise.all([a, b]);
    expect(x).toEqual(y);
    expect(drive()).toHaveLength(1);
    expect(roadsSweeping.value).toBe(0);
    // one after the other: two requests (the panel's loop while « more »)
    fn.impl = answered();
    await measureRoads();
    expect(drive()).toHaveLength(2);
  });
  it('« Voir l\'app comme… »: refused, nothing sent', async () => {
    viewAs.value = { id: 'x', roles: ['owner'], owner: true, rights: {}, trucks: [] } as unknown as Access;
    await expect(measureRoads()).rejects.toBeInstanceOf(Refused);
    expect(fn.calls).toEqual([]);
  });
});

describe('roadsStatus', () => {
  it('drive { action: status }, read only', async () => {
    fn.impl = async () => ({ ok: true, key: true, on: false, left: 5, left0: 5, month: { month: '2026-11-01', tx: 0, cap: 10000 }, rows: { tomtom: 10, osrm: 2 } });
    expect(await roadsStatus()).toEqual({ ok: true, key: true, on: false, left: 5, left0: 5, month: { month: '2026-11-01', tx: 0, cap: 10000 }, rows: { tomtom: 10, osrm: 2, none: 0 } });
    expect(drive().map((c) => c.body)).toEqual([{ action: 'status' }]);
    fn.impl = async () => ({ ok: false, code: 'signin' });
    expect(await roadsStatus()).toMatchObject({ ok: false, code: 'signin' });
  });
});

describe('driveAnswer: an older or a pretend server may leave keys out', () => {
  it('every key there with its type', () => {
    expect(driveAnswer({ ok: true })).toEqual({ ok: true, ready: false, left: 0, left0: 0, stored: 0, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'unused', osrm: 'unused', spent: null, more: false });
    expect(driveAnswer(null)).toEqual({ ok: false, code: 'server', at: 'drive' });
  });
});

describe('the suggestion rows carry the new fields when the server sends them', () => {
  it('unmeasured, add_km null, day_km, rank / route (null in blocks mode: F2)', async () => {
    setRoads(true);
    fn.impl = answered();
    rq.rows = [{ day: today(), block: 'am', drive_min: 20, near: 0, truck: 't1', left: 100, unmeasured: 2, add_km: null, day_km: null, rank: null, route: null, far: null }];
    const rows: Suggestion[] = await suggestBlocks(P.lat, P.lng, 60, today(), 14);
    expect(rows[0]).toMatchObject({ unmeasured: 2, add_km: null, day_km: null, rank: null, route: null, far: null });
    // L3: the type says add_km may be null (the server sends null while a trip is not measured)
    const km: number | null | undefined = rows[0].add_km;
    expect(km).toBeNull();
  });
});
