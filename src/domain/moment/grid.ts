/* The time grid of the agenda (« Plages d'arrivée »): pure maths, tested in grid.test.ts.
   One unit = 15 minutes. A day goes from the first hour of the garage to the last (`daySpan`, 8 h → 20 h = 48 units).
   Places are counted in units (a float: 14 h 20 is a third of the way into its unit); the screen multiplies by the
   height of a unit. */
import type { BlockKey, Range } from '../../lib/dates';

/** minutes in one unit of the grid */
export const UNIT = 15;
/** the smallest block drawn, in units (two lines of text fit) */
export const MIN_UNITS = 2;

/** how many units a day has (a span that does not end on a quarter keeps its last piece) */
export function unitCount(span: Range): number { return Math.max(1, Math.ceil((span[1] - span[0]) / UNIT)); }
/** the minute a unit starts at */
export function unitMinute(span: Range, index: number): number { return span[0] + index * UNIT; }
/** the unit a minute falls in (kept inside the day) */
export function unitIndex(span: Range, minute: number): number {
  return Math.min(unitCount(span) - 1, Math.max(0, Math.floor((minute - span[0]) / UNIT)));
}
/** every unit's first minute, in order */
export function unitMinutes(span: Range): number[] { return Array.from({ length: unitCount(span) }, (_, i) => unitMinute(span, i)); }
/** the first minute of the unit under a point `y` pixels below the top of the grid */
export function minuteAt(span: Range, y: number, unitPx: number): number {
  return unitMinute(span, unitIndex(span, span[0] + (y / unitPx) * UNIT));
}
/** where a minute is, in units from the top (null outside the day) */
export function unitsAt(span: Range, minute: number): number | null {
  return minute < span[0] || minute > span[1] ? null : (minute - span[0]) / UNIT;
}

export interface Box { top: number; height: number }
/** a job's block, in units: at its arrival, as tall as its work (at least `min` units), kept inside the day */
export function jobBox(span: Range, at: number, durationMin: number, min = MIN_UNITS): Box {
  const n = unitCount(span);
  const height = Math.min(n, Math.max(min, (durationMin || 0) / UNIT));
  const top = Math.min(n - height, Math.max(0, (at - span[0]) / UNIT));
  return { top, height };
}

type Timed = { block: BlockKey; eta_min: number | null; win_start?: number | null };
/** when a job is drawn: its planned arrival; without one, a job of a block goes at its block's first hour and a job
    of « the day » at the start of its window; null: nowhere on the grid (listed above it) */
export function jobMinute(j: Timed, blocks: readonly { key: BlockKey; start: number }[]): number | null {
  if (j.eta_min != null) return j.eta_min;
  if (j.block === 'day') return j.win_start ?? null;
  return blocks.find((b) => b.key === j.block)?.start ?? null;
}

export interface Slot { col: number; cols: number }
/** blocks that share some time sit side by side: each gets a column, and every block of a group that touches is cut
    in as many columns as the group needs (the usual calendar rule). Ends are exclusive: 9 h–10 h and 10 h–11 h do not
    touch. */
export function overlapColumns(items: readonly { id: string; start: number; end: number }[]): Map<string, Slot> {
  const out = new Map<string, Slot>();
  const sorted = [...items].sort((a, b) => (a.start - b.start) || (b.end - a.end) || a.id.localeCompare(b.id));
  let group: { id: string; col: number }[] = [];
  let ends: number[] = [];      // the end of the last block of each column of the group
  let groupEnd = -Infinity;
  const close = () => { for (const g of group) out.set(g.id, { col: g.col, cols: ends.length }); group = []; ends = []; };
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) close();
    let col = ends.findIndex((e) => e <= it.start);
    if (col < 0) { col = ends.length; ends.push(it.end); } else ends[col] = it.end;
    group.push({ id: it.id, col });
    groupEnd = Math.max(groupEnd, it.end);
  }
  close();
  return out;
}

/** which units a truck works in (a unit counts as soon as some of it is inside the truck's hours) */
export function workedUnits(ranges: readonly Range[], span: Range): boolean[] {
  return unitMinutes(span).map((m) => ranges.some(([a, z]) => a < m + UNIT && z > m));
}

/** the start of the window that goes with a time let go on the grid (`windowOf` = the garage's rule: an hour before
    the rounded time, kept inside the day) */
export function dropWindowStart(minute: number, windowOf: (eta: number) => Range): number { return windowOf(minute)[0]; }

/** the unit to bring to the top when the grid opens: an hour before « now » (today) or before the first job; the
    top of the day when there is neither */
export function openingUnit(span: Range, now: number | null, firstJob: number | null): number {
  const at = now != null && now >= span[0] && now <= span[1] ? now : firstJob;
  return at == null ? 0 : unitIndex(span, Math.max(span[0], at - 60));
}
