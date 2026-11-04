/* The glass window of a truck's hours: 30-minute panes from 6 h to 22 h, Sunday → Saturday.
   Pure helpers (grid.test.ts): panes ↔ hours, painting a rectangle, what changed, what « Appliquer » sends. */
import { cellsToRanges, rangesToCells, mergeRanges, addDays, dow, daysBetween, type Range, type Day } from '../../lib/dates';

export const STEP = 30;
export const FROM = 6 * 60;
export const TO = 22 * 60;
/** the start minute of every pane, top to bottom */
export const UNITS: number[] = Array.from({ length: (TO - FROM) / STEP }, (_, i) => FROM + i * STEP);
export const DOWS = [0, 1, 2, 3, 4, 5, 6];

export type Week = Record<number, Range[]>;
/** dow → the lit panes (start minutes, sorted) */
export type Panes = Record<number, number[]>;

export function emptyPanes(): Panes { const p: Panes = {}; for (const d of DOWS) p[d] = []; return p; }
export function weekToPanes(w: Week): Panes {
  const p = emptyPanes();
  for (const d of DOWS) p[d] = rangesToCells(w[d] || [], STEP, FROM, TO);
  return p;
}
export function dayToPanes(rs: Range[]): number[] { return rangesToCells(rs || [], STEP, FROM, TO); }

/** the hours outside the window (before 6 h, after 22 h) are kept as they were */
function outside(rs: Range[]): Range[] {
  const out: Range[] = [];
  for (const [a, b] of mergeRanges(rs || [])) {
    if (a < FROM) out.push([a, Math.min(b, FROM)]);
    if (b > TO) out.push([Math.max(a, TO), b]);
  }
  return out.filter(([a, b]) => b > a);
}
/** the hours of a day drawn on the window (the parts outside the window are kept from `before`) */
export function panesToRanges(panes: number[], before: Range[] = []): Range[] {
  return mergeRanges([...cellsToRanges([...panes].sort((x, y) => x - y), STEP), ...outside(before)]);
}

export function samePanes(a: number[] = [], b: number[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
/** the days (dow) whose panes differ */
export function changedDays(draft: Panes, base: Panes): number[] {
  return DOWS.filter((d) => !samePanes(draft[d], base[d]));
}
export function isOn(p: Panes, d: number, u: number): boolean { return (p[d] || []).includes(u); }

export interface Spot { d: number; u: number }
/**
 * Painting: from the pane where the finger went down (a) to the pane it is on now (b), every pane of the rectangle
 * (the days between, the times between) is lit (on) or put out. `cols` is the order of the days on screen.
 */
export function paintRect(p: Panes, a: Spot, b: Spot, on: boolean, cols: number[] = DOWS): Panes {
  const ia = cols.indexOf(a.d), ib = cols.indexOf(b.d);
  const days = ia < 0 || ib < 0 ? [a.d] : cols.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
  const lo = Math.min(a.u, b.u), hi = Math.max(a.u, b.u);
  const out: Panes = { ...p };
  for (const d of days) {
    const set = new Set(p[d] || []);
    for (const u of UNITS) if (u >= lo && u <= hi) { if (on) set.add(u); else set.delete(u); }
    out[d] = [...set].sort((x, y) => x - y);
  }
  return out;
}
/** one pane on or off */
export function togglePane(p: Panes, d: number, u: number): Panes { return paintRect(p, { d, u }, { d, u }, !isOn(p, d, u)); }

/* ---------- what « Appliquer » sends ---------- */
export type Mode = 'day' | 'weeks' | 'always';
export interface ApplyPlan {
  /** p_week: only the days that change */
  week: Record<number, Range[]>;
  /** the weekdays that change */
  dows: number[];
  /** the dates touched (for the words and to count the jobs already booked) */
  dates: Day[];
  /** nothing to send */
  empty: boolean;
}
/**
 * - day: the date `from` only, with the panes of its weekday (compared with what that date has now: `actual`);
 * - weeks: the weekdays that differ from the usual week, every week for `weeks` weeks from `from`;
 * - always: the weekdays that differ from the usual week, from today on (`until`: the last date counted for the jobs).
 */
export function applyPlan(mode: Mode, draft: Panes, usual: Week, o: { from: Day; weeks: number; today: Day; until: Day; actual?: Range[] }): ApplyPlan {
  const base = weekToPanes(usual);
  if (mode === 'day') {
    const d = dow(o.from);
    const now = o.actual ?? usual[d] ?? [];
    const same = samePanes(draft[d], dayToPanes(now));
    return { week: same ? {} : { [d]: panesToRanges(draft[d], now) }, dows: same ? [] : [d], dates: same ? [] : [o.from], empty: same };
  }
  const dows = changedDays(draft, base);
  const week: Record<number, Range[]> = {};
  for (const d of dows) week[d] = panesToRanges(draft[d], usual[d] || []);
  const start = mode === 'always' ? o.today : o.from;
  const end = mode === 'always' ? o.until : addDays(o.from, Math.max(1, Math.min(52, o.weeks)) * 7 - 1);
  const dates: Day[] = [];
  const n = daysBetween(start, end);
  for (let i = 0; i <= n && i < 800; i++) { const day = addDays(start, i); if (dows.includes(dow(day))) dates.push(day); }
  return { week, dows, dates, empty: dows.length === 0 };
}

/** minutes lit in a day */
export function paneMinutes(panes: number[] = []): number { return panes.length * STEP; }
