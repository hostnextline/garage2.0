/* useReport with a pretend server: an old answer never replaces a newer one, the numbers kept on the device show at
   once on a month already seen (no empty frame), and numbers left open get loaded again. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useReport, STALE_MS, type ReportState } from './useReport';
import { clearReports, readReport, writeReport } from './reportCache';
import { authState } from '../../data/auth';

const box = document.createElement('div');
document.body.appendChild(box);
let seen: (ReportState<number> & { reload: () => void }) | null = null;
const frames: (number | null)[] = [];
function Probe(p: { k: string; load: () => Promise<number> }) {
  seen = useReport<number>(p.k, p.load, (raw) => Number(raw));
  frames.push(seen.data);
  return null;
}
const draw = (k: string, load: () => Promise<number>) => act(() => render(<Probe k={k} load={load} />, box));
const later = (v: number, ms: number) => () => new Promise<number>((r) => setTimeout(() => r(v), ms));

beforeEach(() => { clearReports(); localStorage.clear(); frames.length = 0; });
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); });

describe('a server report', () => {
  it('the numbers kept on the device leave it at sign-out (treasury-coffre-29, x-money-29)', () => {
    const before = authState.value;
    authState.value = 'ready';
    writeReport('his.report.u.dashboard.2026-10', { at: new Date().toISOString(), data: 10 });
    writeReport('his.report.u.treasury.2026-10', { at: new Date().toISOString(), data: 3 });
    localStorage.setItem('his.other', 'kept');
    authState.value = 'signed_out';
    expect(Object.keys(localStorage).filter((k) => k.startsWith('his.report.'))).toEqual([]);
    expect(readReport('his.report.u.dashboard.2026-10')).toBeNull();
    expect(localStorage.getItem('his.other')).toBe('kept');
    authState.value = before;
  });
  it('the answer of a month left before it arrived never shows on the new month', async () => {
    vi.useFakeTimers();
    await draw('his.report.u.dashboard.2026-10', later(10, 500));
    await draw('his.report.u.dashboard.2026-11', later(11, 100));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(seen?.data).toBe(11);
    expect(frames).not.toContain(10);
  });
  it('a month already seen shows its kept numbers in the very first frame', async () => {
    writeReport('his.report.u.dashboard.2026-09', { at: new Date().toISOString(), data: 9 });
    await draw('his.report.u.dashboard.2026-10', later(10, 5));
    frames.length = 0;
    await draw('his.report.u.dashboard.2026-09', later(9, 5));
    expect(frames[0]).toBe(9);
  });
  it('numbers older than a few minutes are loaded again while the screen stays open, keeping the old ones meanwhile', async () => {
    vi.useFakeTimers();
    let n = 0;
    await draw('his.report.u.dashboard.2026-11', () => Promise.resolve(++n));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(seen?.data).toBe(1);
    frames.length = 0;
    await act(async () => { await vi.advanceTimersByTimeAsync(STALE_MS + 61_000); });
    // the reload's answer
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(seen?.data).toBe(2);
    expect(frames).not.toContain(null);
  });
  it('old kept numbers and a server that keeps refusing: asked again once per few minutes, not every minute', async () => {
    vi.useFakeTimers();
    writeReport('his.report.u.dashboard.2026-08', { at: new Date(Date.now() - 2 * STALE_MS).toISOString(), data: 8 });
    let asked = 0;
    await draw('his.report.u.dashboard.2026-08', () => { asked++; return Promise.reject(new Error('refused')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect([asked, seen?.data, !!seen?.error]).toEqual([1, 8, true]);
    // four minutes of the timer looking every minute: no new request, the banner stays
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); });
    expect([asked, !!seen?.error]).toEqual([1, true]);
    // once STALE_MS has passed since the last try: one more
    await act(async () => { await vi.advanceTimersByTimeAsync(STALE_MS); });
    expect(asked).toBe(2);
  });
  // the scan saw two reloads on reconnection (the app's signal and the browser's « online »); both land in one render,
  // so one request: kept as a guard
  it('the signal coming back twice at once (the app’s and the browser’s) asks the server once', async () => {
    vi.useFakeTimers();
    let asked = 0;
    await draw('his.report.u.dashboard.2026-11', () => { asked++; return asked === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(7); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(seen?.error).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(asked).toBe(2);
    expect(seen?.data).toBe(7);
  });
});
