/* « Envoyer les heures aux clients » (Part 28): the phone's twin of tell_now / tell_state on THE table of cases shared with
   the database (tests/fixtures/told-cases.json; tests/db/textos-journee.test.mjs T1 reads the same file), then what the
   screens count from it: N by customer, 'drift' never in N, dueOn with told_day, dueDays, toldWindow (REARRANGE.md §6.3 U2). */
import { describe, it, expect, afterEach } from 'vitest';
import table from '../../../tests/fixtures/told-cases.json';
import { tellNow, tellState, tellKind, tellCtx, tellCtxOf, saysNo, toldWindow, toldOf, dueOn, driftOn, clientsDue, dueDays, isDue, hoursWords, whenWords, toldWords, phoneOk, tellRows,
  type TellBooking, type TellJob, type TellListJob } from './told';
import { upsertLocal, removeLocal } from '../../data/store';
import { addDays, windowFor, today as garageToday, nowMinute, DEFAULT_BLOCKS } from '../../lib/dates';

/** « today » of the table (any day works: the rule reads days only against it) */
const TODAY = '2026-11-24';
type RawJob = Record<string, unknown> & { day?: number; told_day?: number | null };
interface Case { id: string; note: string; settings?: Record<string, unknown>; now_min?: number; job: RawJob; want: { state: string | null; kind: string | null; now: { day: number; start: number | null; end: number | null; rewin: boolean; drift: boolean } } }
const T = table as unknown as { defaults: { now_min: number; settings: Record<string, unknown>; job: RawJob }; cases: Case[];
  lists: { now_min: number; jobs: { id: string; number: number; customer: string | null; job: RawJob }[]; days: Record<string, { due: string[]; drift: string[]; n: number }>; dueDays: { day: number; n: number }[]; total: number } };
const at = (n: number) => addDays(TODAY, n);
/** a row of the table as the phone holds it: the defaults, the case over them, the days from today made real days */
function jobOf(raw: RawJob): TellJob {
  const j = { ...T.defaults.job, ...raw };
  return { ...j, day: at(Number(j.day)), told_day: j.told_day == null ? null : at(Number(j.told_day)) } as unknown as TellJob;
}
const ctxOf = (c: { settings?: Record<string, unknown>; now_min?: number }) =>
  tellCtxOf({ ...T.defaults.settings, ...(c.settings || {}) } as TellBooking, TODAY, c.now_min ?? T.defaults.now_min);

describe('the cases shared with the database (told-cases.json)', () => {
  it('has every case once, each with its French note', () => {
    const ids = T.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(T.cases.length).toBeGreaterThanOrEqual(60);
    for (const c of T.cases) expect(c.note.length, c.id).toBeGreaterThan(10);
  });
  it.each(T.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const ctx = ctxOf(c), j = jobOf(c.job);
    const w = c.want;
    expect(tellNow(j, ctx), c.note).toEqual({ ...w.now, day: at(w.now.day) });
    expect(tellState(j, ctx), c.note).toBe(w.state);
    expect(tellKind(j, ctx), c.note).toBe(w.kind);
  });
  it('the table covers both ways of the switch, today and later, every state and every kind', () => {
    const states = new Set(T.cases.map((c) => c.want.state)), kinds = new Set(T.cases.map((c) => c.want.kind));
    for (const s of ['new', 'changed', 'drift', 'ok', null]) expect(states.has(s as never), String(s)).toBe(true);
    for (const k of ['booking', 'window', 'moved', null]) expect(kinds.has(k as never), String(k)).toBe(true);
    // « les plages ne bougent jamais » both ways on the same late arrival
    const late = T.cases.filter((c) => c.job.eta_min === 830 && !c.settings?.roads_on && c.job.day == null);
    expect(late.some((c) => c.want.now.rewin)).toBe(true);
    expect(late.some((c) => c.settings && 'rewin' in c.settings && !c.want.now.rewin)).toBe(true);
    // the same slip today ('drift') and tomorrow ('changed')
    expect(T.cases.find((c) => c.id === 'aujourdhui-glisse')!.want.state).toBe('drift');
    expect(T.cases.find((c) => c.id === 'demain-glisse')!.want.state).toBe('changed');
  });
});

describe('saysNo (the twin of roads_no) and the context', () => {
  it('only false, 0, « false » and « 0 » say no', () => {
    for (const v of [false, 0, -0, 'false', '0', ' FALSE ', 'False', '  0  ']) expect(saysNo(v), JSON.stringify(v)).toBe(true);
    for (const v of [undefined, null, true, 1, 'true', 'oui', 'non', 'no', '', 'faux', {}, [], '0.0', '\tfalse']) expect(saysNo(v), JSON.stringify(v)).toBe(false);
  });
  it('rewin absent = the windows move with a sure arrival; written false = they never do', () => {
    expect(tellCtxOf({}, TODAY, 600).rewin).toBe(true);
    expect(tellCtxOf({ rewin: false }, TODAY, 600).rewin).toBe(false);
    expect(tellCtxOf({ rewin: 'oui' }, TODAY, 600).rewin).toBe(true);
  });
  it('the switches are on only when written true (as select.ts windowsOn / roadsOn, and roads_on())', () => {
    const c = tellCtxOf({ windows_on: 'true', roads_on: 1 }, TODAY, 600);
    expect([c.windowsOn, c.roadsOn]).toEqual([false, false]);
    const d = tellCtxOf({ windows_on: true, roads_on: true }, TODAY, 600);
    expect([d.windowsOn, d.roadsOn]).toEqual([true, true]);
  });
  it('no blocks written: the three of the garage, the day 8 h to 20 h', () => {
    const c = tellCtxOf({}, TODAY, 600);
    expect(c.blocks).toEqual(DEFAULT_BLOCKS);
    expect(c.windowOf(1150)).toEqual([960, 1200]);
  });
  it('the window of an arrival is select.ts windowOf (lib/dates windowFor) for every value Réglages allows', () => {
    const blocks = [{ key: 'am', start: 450, end: 720 }, { key: 'pm', start: 720, end: 1080 }];
    let n = 0;
    for (const before of [0, 15, 30, 60, 90, 120, 180]) for (const after of [30, 60, 120, 180, 240, 360]) for (const round of [15, 30, 60]) {
      const c = tellCtxOf({ blocks, win_before_min: before, win_after_min: after, win_round_min: round }, TODAY, 600);
      for (let eta = 380; eta <= 1250; eta += 7) {
        expect(c.windowOf(eta)).toEqual(windowFor(eta, { before, after, round, dayStart: 450, dayEnd: 1080 }));
        n++;
      }
    }
    expect(n).toBeGreaterThan(10000);
  });
  it('a value no screen writes is read as the server reads it (length 30 at least, rounding 5 at least, a number as text)', () => {
    expect(tellCtxOf({ win_before_min: 10, win_after_min: 5, win_round_min: 1 }, TODAY, 600).windowOf(601)).toEqual([590, 620]);
    expect(tellCtxOf({ win_before_min: '60', win_after_min: '180', win_round_min: '60' }, TODAY, 600).windowOf(830)).toEqual([780, 1020]);
    expect(tellCtxOf({ win_before_min: null, win_after_min: 'abc' }, TODAY, 600).windowOf(830)).toEqual([780, 1020]);
  });
});

describe('tellCtx() reads this device', () => {
  afterEach(() => removeLocal('settings', ['1']));
  it('the settings as the app holds them, the garage\'s today and minute', () => {
    const now = new Date('2026-11-24T15:30:00Z');
    let c = tellCtx(now);
    expect([c.today, c.nowMin, c.windowsOn, c.roadsOn, c.rewin]).toEqual([garageToday(now), nowMinute(now), false, false, true]);
    expect(c.nowMin).toBe(630);
    upsertLocal('settings', [{ id: '1', booking: { windows_on: true, roads_on: true, rewin: 'false', win_round_min: 30 } } as never], { force: true });
    c = tellCtx(now);
    expect([c.windowsOn, c.roadsOn, c.rewin]).toEqual([true, true, false]);
    expect(c.windowOf(800)).toEqual([750, 990]);
  });
});

describe('what he was told', () => {
  const j = (x: Partial<TellJob>): TellJob => ({ day: TODAY, block: 'day', status: 'booked', eta_min: 600, win_start: 780, win_end: 1020, ...x });
  it('toldWindow: what he was told once told, else the planned window', () => {
    expect(toldWindow(j({ told_at: '2026-11-20T15:00:00+00:00', told_day: TODAY, told_start: 540, told_end: 780 }))).toEqual([540, 780]);
    expect(toldWindow(j({ told_at: '2026-11-20T15:00:00+00:00', told_day: TODAY, told_start: null, told_end: null }))).toBeNull();
    expect(toldWindow(j({ told_at: null }))).toEqual([780, 1020]);
    expect(toldWindow(j({ told_at: null, win_start: null, win_end: null }))).toBeNull();
    expect(toldWindow({ block: 'am' } as never)).toBeNull();
  });
  it('toldOf: null when never told', () => {
    expect(toldOf(j({}))).toBeNull();
    expect(toldOf({ ...j({ told_at: '2026-11-20T15:00:00+00:00', told_day: TODAY, told_start: 540, told_end: 780 }), told_how: 'call' }))
      .toEqual({ day: TODAY, start: 540, end: 780, at: '2026-11-20T15:00:00+00:00', how: 'call' });
  });
  it('a Job of the app fits the rule (the seven columns optional: a row from an older server has none = never told)', () => {
    const old = { id: 'x', number: 1, customer_id: 'c', day: addDays(TODAY, 2), block: 'day', status: 'booked', eta_min: 600, win_start: 540, win_end: 780 } as TellListJob;
    const ctx = tellCtxOf({ windows_on: true }, TODAY, 600);
    expect(tellState(old, ctx)).toBe('new');
    expect(tellKind(old, ctx)).toBe('booking');
    expect(isDue(tellState(old, ctx))).toBe(true);
    expect(isDue('drift')).toBe(false);
    expect(isDue('ok')).toBe(false);
    expect(isDue(null)).toBe(false);
  });
});

describe('who is due on a day (the lists of the table)', () => {
  const L = T.lists;
  const jobs: TellListJob[] = L.jobs.map((x) => ({ ...jobOf(x.job), id: x.id, number: x.number, customer_id: x.customer } as TellListJob));
  const ctx = ctxOf({ now_min: L.now_min });
  it.each(Object.entries(L.days))('day %s: dueOn in tell_list\'s order, driftOn, N by customer', (d, want) => {
    const day = at(Number(d));
    expect(dueOn(day, jobs, ctx).map((j) => j.id)).toEqual(want.due);
    expect(driftOn(day, jobs, ctx).map((j) => j.id)).toEqual(want.drift);
    expect(clientsDue(day, jobs, ctx)).toBe(want.n);
  });
  it('dueDays: every day from today with N > 0, in date order, and the distinct total', () => {
    expect(dueDays(jobs, ctx)).toEqual({ days: L.dueDays.map((x) => ({ day: at(x.day), n: x.n })), total: L.total });
  });
  it('a client with two cars counts once; due on two days, once in the total and on both days', () => {
    const day1 = dueOn(at(1), jobs, ctx);
    expect(day1.map((j) => j.customer_id)).toEqual(['C', 'C']);
    expect(clientsDue(at(1), jobs, ctx)).toBe(1);
    expect(dueOn(at(0), jobs, ctx).map((j) => j.id)).toEqual(['L2']);
    expect(dueOn(at(4), jobs, ctx).map((j) => j.id)).toEqual(['L2']);
    const all = dueDays(jobs, ctx);
    expect(all.days.reduce((s, x) => s + x.n, 0)).toBeGreaterThan(all.total);
  });
  it("'drift' is never in N, nor in dueDays", () => {
    const today = jobs.filter((j) => j.id === 'L5');
    expect(driftOn(TODAY, today, ctx)).toHaveLength(1);
    expect(clientsDue(TODAY, today, ctx)).toBe(0);
    expect(dueDays(today, ctx)).toEqual({ days: [], total: 0 });
  });
  it('nothing due: N = 0, no day', () => {
    expect(dueDays([], ctx)).toEqual({ days: [], total: 0 });
    expect(clientsDue(TODAY, [], ctx)).toBe(0);
  });
  it('the lists keep the jobs given (the same objects, no copy)', () => {
    expect(dueOn(at(4), jobs, ctx)[0]).toBe(jobs.find((j) => j.id === 'L2'));
  });
});

describe('in words, the number a text reaches, the phone\'s send list (TellSheet, TomorrowPanel)', () => {
  it('hoursWords / whenWords / toldWords, French and English', () => {
    expect(hoursWords(540, 780, 'fr')).toBe('9 h à 13 h');
    expect(hoursWords(540, 780, 'en')).toBe('9 a.m. to 1 p.m.');
    expect(hoursWords(null, null, 'fr')).toBe('dans la journée (plage confirmée la veille)');
    expect(whenWords(garageToday(), 540, 780, 'fr')).toBe('aujourd’hui, 9 h à 13 h');
    const j = { day: at(3), block: 'day', status: 'booked', eta_min: 600, told_day: '2030-01-15', told_start: 780, told_end: 1020, told_at: '2026-11-20T10:00:00Z' } as TellJob;
    expect(toldWords(j, 'fr')).toBe('mardi 15 janvier 2030, 13 h à 17 h');
    expect(toldWords({ ...j, told_at: null }, 'fr')).toBe('');
  });
  it('phoneOk: 10 digits, or 11 starting with 1 (the server\'s e164); else no', () => {
    expect(['514 555-0101', '+1 (514) 555-0101', '15145550101'].map(phoneOk)).toEqual([true, true, true]);
    expect(['', null, undefined, '555-0101', '25145550101', '514555010'].map(phoneOk)).toEqual([false, false, false, false, false, false]);
  });
  it('tellRows: the due ones and today\'s drift ones of a day, in tell_list\'s order, with who and what Réglages says', () => {
    const ctx = tellCtxOf({ windows_on: true }, TODAY, 540);
    const base = { block: 'day', status: 'booked', win_flex: false, deleted_at: null } as const;
    const jobs = [
      { ...base, id: 'b', number: 2, customer_id: 'c2', day: at(1), win_start: 780, win_end: 1020, eta_min: 840 },                        // never told
      { ...base, id: 'a', number: 1, customer_id: 'c1', day: at(1), win_start: 780, win_end: 1020, eta_min: 840,
        told_day: at(1), told_start: 540, told_end: 780, told_at: '2026-11-20T10:00:00Z' },                                               // changed
      { ...base, id: 'c', number: 3, customer_id: 'c3', day: at(1), win_start: 480, win_end: 720, eta_min: 500,
        told_day: at(1), told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00Z' },                                               // ok
      { ...base, id: 'd', number: 4, customer_id: null, day: at(1), win_start: null, win_end: null, eta_min: null }                       // flexible, never told
    ] as unknown as TellListJob[];
    const who = (cid: string | null) => (cid === 'c2' ? { phone: '514 555-0102', sms_ok: false } : cid ? { phone: '514 555-0101', sms_ok: true } : null);
    const rows = tellRows(at(1), jobs, ctx, who, (k) => k !== 'moved');
    expect(rows.map((r) => r.id)).toEqual(['d', 'a', 'b']);
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ state: 'changed', kind: 'moved', told: { day: at(1), start: 540, end: 780 }, now: { start: 780, end: 1020, rewin: false },
      phone_ok: true, sms_ok: true, kind_on: false });
    expect(rows.find((r) => r.id === 'b')).toMatchObject({ state: 'new', kind: 'booking', told: null, sms_ok: false, kind_on: true });
    expect(rows.find((r) => r.id === 'd')).toMatchObject({ customer_id: null, phone_ok: false, now: { start: null, end: null } });
    // today: a slipped arrival is listed, as 'drift', with no kind
    const today = [{ ...base, id: 'e', number: 5, customer_id: 'c1', day: TODAY, win_start: 540, win_end: 780, eta_min: 800,
      told_day: TODAY, told_start: 540, told_end: 780, told_at: '2026-11-20T10:00:00Z' }] as unknown as TellListJob[];
    expect(tellRows(TODAY, today, ctx, who, () => true)).toMatchObject([{ id: 'e', state: 'drift', kind: null }]);
  });
});
