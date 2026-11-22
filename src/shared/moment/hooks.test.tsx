/* The hooks of the moment pickers: the windows of the days (kept a moment, asked again when they may have changed),
   the best moments, the clock. The server is pretended. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const api = vi.hoisted(() => ({ suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
vi.mock('../../data/api', () => api);

import { upsertLocal, clearAll } from '../../data/store';
import type { Suggestion } from '../../data/api';
import { useDayWindows, forgetWindows, type DayWins } from './useDayWindows';
import { dayStamp } from './useWindowModels';
import { useSuggestions, useLaterScores, useClock, type SuggState } from './hooks';

const box = document.createElement('div');
document.body.appendChild(box);
const wait = async (ms = 400) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const D = '2026-12-01';
const win = (start: number): Suggestion => ({ day: D, block: 'day', drive_min: 5, near: 1, truck: 'T1', left: 300, eta: start + 60, win_start: start, win_end: start + 240 });
const Q = { lat: 45.5, lng: -73.6, duration: 60, kind: null, need: false, exclude: null };

let seen: DayWins | null = null;
function Days(p: { bump: number; online?: boolean }) {
  const of = useDayWindows([D], Q, p.online ?? true, p.bump, dayStamp);
  seen = of(D);
  return null;
}
beforeEach(() => { forgetWindows(); api.suggestWindows.mockReset(); api.suggestBlocks.mockReset(); seen = null; });
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('the windows of each day shown', () => {
  // booking-b-10: a slow answer asked before a refusal (« window_full » asks everything again) landed after the new one
  // and was kept: going back to that day showed the refused window again for 45 s
  it('an answer asked before « ask again » is never kept', async () => {
    let slow: (r: Suggestion[]) => void = () => {};
    api.suggestWindows.mockImplementationOnce(() => new Promise((ok) => { slow = ok; })).mockResolvedValueOnce([win(540)]);
    act(() => render(<Days bump={0} />, box));
    await wait();
    act(() => render(<Days bump={1} />, box));
    await wait();
    expect(seen?.rows.map((r) => r.win_start)).toEqual([540]);
    await act(async () => { slow([win(840)]); });
    expect(seen?.rows.map((r) => r.win_start)).toEqual([540]);
    // another screen opens the same day: what is kept is the newer answer, nothing asked
    act(() => render(null, box));
    act(() => render(<Days bump={1} />, box));
    expect(seen?.status).toBe('ok');
    expect(seen?.rows.map((r) => r.win_start)).toEqual([540]);
    expect(api.suggestWindows).toHaveBeenCalledTimes(2);
  });
  it('a day whose appointments change on the phone is asked again (a colleague booked it)', async () => {
    api.suggestWindows.mockResolvedValueOnce([win(540), win(840)]).mockResolvedValueOnce([win(840)]);
    act(() => render(<Days bump={0} />, box));
    await wait();
    expect(seen?.rows).toHaveLength(2);
    act(() => { upsertLocal('jobs', [{ id: 'J9', day: D, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, eta_min: 600, win_start: 540, win_end: 780, number: 9 }], { force: true }); });
    act(() => render(<Days bump={0} />, box));
    // meanwhile the last answer stays on screen, dimmed
    expect(seen).toMatchObject({ status: 'loading' });
    expect(seen?.rows).toHaveLength(2);
    await wait();
    expect(seen?.rows.map((r) => r.win_start)).toEqual([840]);
    expect(api.suggestWindows).toHaveBeenCalledTimes(2);
  });
  // review mp-8: the first entry of the day (the OLDEST answer) was shown while the day was asked a third time
  it('asked a third time, the day shows its LAST answer meanwhile, not an older one', async () => {
    api.suggestWindows.mockResolvedValueOnce([win(540), win(840)]).mockResolvedValueOnce([win(840)]).mockImplementationOnce(() => new Promise(() => {}));
    const job = (id: string, eta: number) => ({ id, day: D, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, eta_min: eta, win_start: eta - 60, win_end: eta + 180, number: 9 });
    act(() => render(<Days bump={0} />, box));
    await wait();
    act(() => { upsertLocal('jobs', [job('J8', 600)], { force: true }); });
    act(() => render(<Days bump={0} />, box));
    await wait();
    expect(seen?.rows.map((r) => r.win_start)).toEqual([840]);
    act(() => { upsertLocal('jobs', [job('J9', 660)], { force: true }); });
    act(() => render(<Days bump={0} />, box));
    await wait();
    expect(seen).toMatchObject({ status: 'loading' });
    expect(seen?.rows.map((r) => r.win_start)).toEqual([840]);
  });
  // booking-b-17: no test said what the calendar shows without network, when the server fails, or after the answers expire
  it('offline: said at once and nothing asked; no answer on the way: offline; the server failed: error', async () => {
    act(() => render(<Days bump={0} online={false} />, box));
    await wait();
    expect(seen).toEqual({ status: 'offline', rows: [] });
    expect(api.suggestWindows).not.toHaveBeenCalled();
    api.suggestWindows.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => render(<Days bump={0} />, box));
    await wait();
    expect(seen).toEqual({ status: 'offline', rows: [] });
    api.suggestWindows.mockRejectedValueOnce({ code: 'P0001', message: 'boom' });
    act(() => render(<Days bump={1} />, box));
    await wait();
    expect(seen).toEqual({ status: 'error', rows: [] });
  });
  it('an answer is kept 45 s (going back to the day asks nothing), then asked again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-18T17:00:00Z'));
      api.suggestWindows.mockResolvedValue([win(540)]);
      act(() => render(<Days bump={0} />, box));
      await wait();
      expect(api.suggestWindows).toHaveBeenCalledTimes(1);
      act(() => render(null, box));
      vi.setSystemTime(new Date('2026-11-18T17:00:40Z'));
      act(() => render(<Days bump={0} />, box));
      expect(seen?.status).toBe('ok');
      await wait();
      expect(api.suggestWindows).toHaveBeenCalledTimes(1);
      act(() => render(null, box));
      vi.setSystemTime(new Date('2026-11-18T17:00:46Z'));
      act(() => render(<Days bump={0} />, box));
      await wait();
      expect(api.suggestWindows).toHaveBeenCalledTimes(2);
      expect(seen).toMatchObject({ status: 'ok' });
    } finally { vi.useRealTimers(); }
  });
});

let state: SuggState | null = null;
let more: Suggestion[] = [];
const base = { lat: 45.5, lng: -73.6, duration: 60, exclude: null, need: false, kind: null, truckId: null };
function Sugg(p: { from: string; again?: number; online?: boolean; laterFrom?: string | null; laterOnline?: boolean }) {
  state = useSuggestions({ ...base, from: p.from, days: 14 }, p.online ?? true, p.again ?? 0);
  more = useLaterScores(base, p.laterFrom ?? null, 14, p.laterOnline ?? true, 0);
  return null;
}
describe('the best moments', () => {
  it('asked once things settle; an older answer is dropped; offline says so', async () => {
    let first: (r: Suggestion[]) => void = () => {};
    api.suggestBlocks.mockImplementationOnce(() => new Promise((ok) => { first = ok; })).mockResolvedValue([win(540)]);
    act(() => render(<Sugg from="2026-12-01" />, box));
    expect(state?.status).toBe('loading');
    await wait();
    act(() => render(<Sugg from="2026-12-02" />, box));
    await wait();
    await act(async () => { first([win(840)]); });
    expect(state?.list.map((r) => r.win_start)).toEqual([540]);
    expect(api.suggestBlocks).toHaveBeenLastCalledWith(45.5, -73.6, 60, '2026-12-02', 14, null, false, null);
    act(() => render(<Sugg from="2026-12-02" online={false} />, box));
    expect(state?.status).toBe('offline');
  });
  it('the scores of a later page are kept while the person pages back', async () => {
    api.suggestBlocks.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, from: string) => (from === '2026-12-15' ? [{ ...win(540), day: '2026-12-16', far: 'hop' }] : []));
    act(() => render(<Sugg from="2026-12-01" laterFrom="2026-12-15" />, box));
    await wait();
    expect(more.map((m) => m.day)).toEqual(['2026-12-16']);
    act(() => render(<Sugg from="2026-12-01" laterFrom={null} />, box));
    await wait();
    expect(more.map((m) => m.day)).toEqual(['2026-12-16']);
  });
  // review mp-5: the kept scores stayed offline or after an error, so cells stayed marked far and the warning could show
  it('offline, or when the server failed, the later scores say nothing (as the first two weeks)', async () => {
    api.suggestBlocks.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, from: string) => (from === '2026-12-15' ? [{ ...win(540), day: '2026-12-16', far: 'hop' }] : []));
    act(() => render(<Sugg from="2026-12-01" laterFrom="2026-12-15" />, box));
    await wait();
    expect(more.map((m) => m.day)).toEqual(['2026-12-16']);
    act(() => render(<Sugg from="2026-12-01" laterFrom="2026-12-15" laterOnline={false} />, box));
    expect(more).toEqual([]);
    act(() => render(<Sugg from="2026-12-01" laterFrom={null} laterOnline={false} />, box));
    expect(more).toEqual([]);
    api.suggestBlocks.mockRejectedValue(new Error('boom'));
    act(() => render(<Sugg from="2026-12-01" laterFrom="2026-12-29" />, box));
    await wait();
    expect(more).toEqual([]);
  });
});

describe('the clock', () => {
  // booking-b-23: today and now were read only when something else drew the picker again
  it('draws again at each new minute, so midnight and the hours passing are seen', async () => {
    vi.useFakeTimers();
    try {
      // 23 h 59 30 s in Montréal (EST, UTC−5), whatever the zone of the machine running the tests: the code reads the
      // garage's clock (lib/dates), so the instant must be given in UTC, never with the machine's local Date fields
      vi.setSystemTime(new Date('2026-11-21T04:59:30Z'));
      let at = '';
      function Clock() { const c = useClock(); at = `${c.today} ${c.now}`; return null; }
      act(() => render(<Clock />, box));
      expect(at).toBe('2026-11-20 1439');
      await act(async () => { vi.advanceTimersByTime(31_000); });
      expect(at).toBe('2026-11-21 0');
    } finally { vi.useRealTimers(); }
  });
});

describe('the switch « Vraies routes » flipped while a picker is open (final-off L5)', () => {
  const setRoads = (on: boolean) => act(() => { upsertLocal('settings', [{ id: '1', booking: { roads_on: on } } as never], { force: true }); });
  it('the best moments and the windows of a day are asked again: the rows of « on » are not kept after OFF', async () => {
    setRoads(true);
    api.suggestBlocks.mockResolvedValue([{ ...win(540), unmeasured: 2 }]);
    act(() => render(<Sugg from="2026-12-01" />, box));
    await wait();
    expect(api.suggestBlocks).toHaveBeenCalledTimes(1);
    api.suggestBlocks.mockResolvedValue([win(540)]);
    setRoads(false);
    await wait();
    expect(api.suggestBlocks).toHaveBeenCalledTimes(2);
    expect(state?.list[0].unmeasured).toBeUndefined();
    act(() => render(null, box));
    setRoads(true);
    api.suggestWindows.mockResolvedValue([win(540)]);
    act(() => render(<Days bump={0} />, box));
    await wait();
    const n = api.suggestWindows.mock.calls.length;
    setRoads(false);
    await wait();
    expect(api.suggestWindows.mock.calls.length).toBe(n + 1);
  });
});
