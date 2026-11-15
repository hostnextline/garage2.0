/* The time calendar of the booking screen (« Plages d'arrivée »): pure maths, tested in units.test.ts.
   A unit = 15 minutes = an estimated ARRIVAL time T. The window told to the customer for it is `windowOf(T)` (the
   garage's rule: an hour before the rounded time, three after, kept inside the day). The unit is possible when the
   server lists, for that day, a window that starts where `windowOf(T)` starts. */
import { addDays, daysBetween, type Day, type Range } from '../../lib/dates';
import { UNIT, unitMinutes } from '../agenda/grid';

export { UNIT };
export type Win = [number, number];
/** the garage's rule for an arrival time (`windowOf` of data/select with the settings) */
export type WindowOf = (eta: number) => Range;
/** what the server says of a window still possible */
export interface WinRow { win_start?: number | null; win_end?: number | null; eta?: number | null; truck: string | null; drive_min: number; wait_min?: number | null; near?: number }

/** the server's rows by the start of their window (the first of a start = the best, kept) */
export function rowsByStart<T extends WinRow>(rows: readonly T[], windowOf: WindowOf): Map<number, T> {
  const out = new Map<number, T>();
  for (const r of rows) {
    const s = r.win_start ?? (r.eta != null ? windowOf(r.eta)[0] : null);
    if (s != null && !out.has(s)) out.set(s, r);
  }
  return out;
}
/** the units of the day where this booking can arrive: arrival time → the server's row of its window */
export function possibleUnits<T extends WinRow>(span: Range, rows: readonly T[], windowOf: WindowOf): Map<number, T> {
  const by = rowsByStart(rows, windowOf);
  const out = new Map<number, T>();
  for (const m of unitMinutes(span)) { const r = by.get(windowOf(m)[0]); if (r) out.set(m, r); }
  return out;
}

/** the unit that shows a window chosen: among the units whose window starts there, the nearest to the estimated
    arrival (else to the middle of the units of that window); null when no unit of the day gives that window */
export function unitOfWindow(span: Range, winStart: number, eta: number | null | undefined, windowOf: WindowOf): number | null {
  const same = unitMinutes(span).filter((m) => windowOf(m)[0] === winStart);
  if (!same.length) return null;
  if (eta == null) {
    // no arrival said (the address bar, a paste): an hour into the window when a unit there gives it, else the first
    const natural = same.find((m) => m >= winStart + 60);
    return natural ?? same[same.length - 1];
  }
  return same.reduce((best, m) => (Math.abs(m - eta) < Math.abs(best - eta) ? m : best), same[0]);
}

export type UnitState = 'open' | 'no' | 'wait' | 'off' | 'past';
/** how each unit of a day looks:
    - past: the day is over, or today and the unit is behind us;
    - off: nobody works then;
    - open: this booking can arrive then; no: the server says it cannot;
    - wait: not known (the answer is not here yet, or it failed). */
export function unitStates(span: Range, o: { day: Day; today: Day; now: number; worked: readonly boolean[] | null; possible: { has(m: number): boolean } | null }): UnitState[] {
  return unitMinutes(span).map((m, i) => {
    if (o.day < o.today || (o.day === o.today && m + UNIT <= o.now)) return 'past';
    if (o.worked && !o.worked[i]) return 'off';
    if (!o.possible) return 'wait';
    return o.possible.has(m) ? 'open' : 'no';
  });
}

/* ---------- the days shown ---------- */
/** the days of a page: `n` days from today + page × n, never after the last day that can be booked */
export function pageDays(today: Day, lastDay: Day, page: number, n = 7): Day[] {
  const out: Day[] = [];
  const start = addDays(today, Math.max(0, page) * n);
  for (let i = 0; i < n; i++) { const d = addDays(start, i); if (d > lastDay) break; out.push(d); }
  return out;
}
/** the page a day is on (0 for a day before today) */
export function pageOf(today: Day, day: Day, n = 7): number { return Math.max(0, Math.floor(daysBetween(today, day) / n)); }
/** the last page that still has a day to book */
export function lastPage(today: Day, lastDay: Day, n = 7): number { return pageOf(today, lastDay, n); }

/* ---------- the server's answers, kept a moment ---------- */
/** one answer = one day for one place, one length of work, one kind of vehicle, one job left out */
export function cacheKey(q: { day: Day; lat: number | null; lng: number | null; duration: number; kind: string | null; need: boolean; exclude: string | null }): string {
  const at = q.lat == null || q.lng == null ? '-' : `${q.lat.toFixed(5)},${q.lng.toFixed(5)}`;
  return [q.day, at, Math.round(q.duration), q.need ? 'need' : q.kind || 'any', q.exclude || '-'].join('|');
}

/* ---------- the phone's list ---------- */
/** arrival times grouped by their hour, in order: [{ hour: 840, times: [840, 855, 870, 885] }, …] */
export function byHour(minutes: readonly number[]): { hour: number; times: number[] }[] {
  const out: { hour: number; times: number[] }[] = [];
  for (const m of [...minutes].sort((a, b) => a - b)) {
    const hour = Math.floor(m / 60) * 60;
    const last = out[out.length - 1];
    if (last && last.hour === hour) last.times.push(m); else out.push({ hour, times: [m] });
  }
  return out;
}

/** arrows on the grid: the unit reached from (col, m) — up / down one unit, left / right one day, kept inside */
export function moveFocus(span: Range, cols: number, at: { col: number; m: number }, key: string): { col: number; m: number } | null {
  const first = span[0], last = unitMinutes(span).at(-1) ?? span[0];
  const clampM = (m: number) => Math.max(first, Math.min(last, m));
  const clampC = (c: number) => Math.max(0, Math.min(cols - 1, c));
  switch (key) {
    case 'ArrowUp': return { col: at.col, m: clampM(at.m - UNIT) };
    case 'ArrowDown': return { col: at.col, m: clampM(at.m + UNIT) };
    case 'ArrowLeft': return { col: clampC(at.col - 1), m: at.m };
    case 'ArrowRight': return { col: clampC(at.col + 1), m: at.m };
    case 'PageUp': return { col: at.col, m: clampM(at.m - 60) };
    case 'PageDown': return { col: at.col, m: clampM(at.m + 60) };
    case 'Home': return { col: at.col, m: first };
    case 'End': return { col: at.col, m: last };
    default: return null;
  }
}
