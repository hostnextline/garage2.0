/* « Plages d'arrivée »: the days of the time calendar as the grid (computer) and the list (phone) draw them, from what
   the server says of each day (`suggest_windows`) and the phone's copy of the day. Pure: everything is passed in
   (tested in windowDays.test.ts). The unit maths is in domain/moment/units.ts and grid.ts. */
import type { Day, Range } from '../../lib/dates';
import type { Job } from '../../data/types';
import type { Suggestion } from '../../data/api';
import type { BlockChoice } from '../../domain/moment/choice';
import { jobBox, jobMinute, overlapColumns, unitCount, unitIndex, unitMinute, unitMinutes, workedUnits, type Box } from '../../domain/moment/grid';
import { possibleUnits, rowsByStart, unitOfWindow, unitStates, type UnitState, type Win, type WindowOf } from '../../domain/moment/units';

export type WinStatus = 'loading' | 'ok' | 'offline' | 'error';
/** what the server said of one day: its windows still possible, the best first */
export interface DayWins { status: WinStatus; rows: Suggestion[] }

export interface GridJob { id: string; top: number; height: number; col: number; cols: number; color: string; name: string; label: string }
export type DayKind = 'open' | 'full' | 'closed' | 'past' | 'failed' | 'loading';
export interface GridDay {
  day: Day; status: WinStatus; stale: boolean; kind: DayKind;
  states: UnitState[];
  /** the arrival times this booking can take, in order */
  open: number[];
  /** how many different windows those times give (what the customer may be told) */
  windows: number;
  jobs: GridJob[];
  /** moving an appointment: where it is now */
  current: Box | null; currentM: number | null;
  /** the unit chosen and its window (this day is the day chosen) */
  chosen: number | null; band: Win | null;
  /** the unit of the best moment the server offers that day */
  best: number | null;
  /** « garde-route »: the server says this day puts too much road in the vehicle's day (marked, still pickable) */
  far: boolean;
}
/** a day as drawn, with the server's row behind each possible unit (its vehicle, its arrival) */
export type WindowDay = GridDay & { possible: Map<number, Suggestion> };

/** a vehicle chosen by hand: only its rows count (a row of another vehicle says nothing of this one). Rows without a
    vehicle are kept. */
export function ofTruck<T extends { truck: string | null }>(rows: readonly T[], truckId: string | null | undefined): T[] {
  return truckId ? rows.filter((x) => !x.truck || x.truck === truckId) : rows.slice();
}

/** the units some vehicle that can take the job works in (one list of ranges per vehicle) */
export function workedOf(ranges: readonly (readonly Range[])[], span: Range): boolean[] {
  const out: boolean[] = Array(unitCount(span)).fill(false);
  for (const r of ranges) workedUnits(r, span).forEach((v, i) => { if (v) out[i] = true; });
  return out;
}

type Moving = Pick<Job, 'day' | 'block' | 'eta_min' | 'win_start' | 'duration_min'>;
export interface DayInput {
  day: Day; today: Day; now: number; span: Range; len: number; windowOf: WindowOf;
  wins: DayWins;
  /** a vehicle chosen by hand (see ofTruck) */
  truckId?: string | null;
  worked: readonly boolean[];
  /** a window chosen (not « Flexible », not the day alone), on any day */
  picked: BlockChoice | null;
  /** moving an appointment: the job as it is now */
  moving: Moving | null;
  /** the best moment the server offers that day */
  best?: { win: Win; eta?: number | null } | null;
  far?: boolean;
  jobs: GridJob[];
}

/** one day of the calendar: which units are possible, how the day reads, what is chosen and where the job now is */
export function windowDay(i: DayInput): WindowDay {
  const { span, windowOf, wins: w } = i;
  // an answer being replaced still shows (dimmed) rather than a blank column
  const known = w.status === 'ok' || (w.status === 'loading' && w.rows.length > 0);
  const possible = possibleUnits(span, ofTruck(w.rows, i.truckId), windowOf);
  const states = unitStates(span, { day: i.day, today: i.today, now: i.now, worked: i.worked, possible: known ? possible : null });
  const open = unitMinutes(span).filter((_m, k) => states[k] === 'open');
  const kind: DayKind = states.every((s) => s === 'past') ? 'past' : !states.some((s) => s !== 'off' && s !== 'past') ? 'closed'
    : w.status === 'offline' || w.status === 'error' ? 'failed' : !known ? 'loading' : open.length ? 'open' : 'full';
  const mine = i.picked && i.picked.day === i.day && i.picked.win_start != null ? i.picked : null;
  const mv = i.moving;
  const nowAt = mv && mv.day === i.day && mv.block === 'day' ? mv.eta_min ?? (mv.win_start != null ? unitOfWindow(span, mv.win_start, null, windowOf) : null) : null;
  return {
    day: i.day, status: w.status, stale: w.status === 'loading' && known, kind, states, open,
    windows: new Set(open.map((m) => windowOf(m)[0])).size, jobs: i.jobs, possible,
    current: nowAt != null ? jobBox(span, nowAt, mv!.duration_min, 1) : null,
    currentM: nowAt != null ? unitMinute(span, unitIndex(span, nowAt)) : null,
    chosen: mine ? unitOfWindow(span, mine.win_start!, mine.eta, windowOf) : null,
    band: mine ? [mine.win_start!, mine.win_end != null && mine.win_end > mine.win_start! ? mine.win_end : mine.win_start! + i.len] : null,
    best: i.best ? unitOfWindow(span, i.best.win[0], i.best.eta, windowOf) : null,
    far: !!i.far
  };
}

type PlacedJob = Pick<Job, 'id' | 'status' | 'number' | 'block' | 'eta_min' | 'win_start' | 'duration_min' | 'truck_id'>;
/** the appointments already booked that day, at their planned arrival, side by side where they share time (the one being
    moved is left out; cancelled and missed ones are not drawn) */
export function gridJobs<J extends PlacedJob>(jobs: readonly J[], span: Range, o: {
  exclude?: string | null; blocks: readonly { key: Job['block']; start: number }[];
  nameOf: (j: J) => string; colorOf: (truckId: string | null) => string; labelOf: (name: string, at: number) => string;
}): GridJob[] {
  const placed = jobs.filter((j) => j.status !== 'cancelled' && j.status !== 'no_show' && j.id !== o.exclude)
    .map((j) => ({ j, at: jobMinute(j, o.blocks) })).filter((x): x is { j: J; at: number } => x.at != null)
    .map((x) => ({ ...x, box: jobBox(span, x.at, x.j.duration_min, 1) }));
  const slots = overlapColumns(placed.map((x) => ({ id: x.j.id, start: x.box.top, end: x.box.top + x.box.height })));
  return placed.map((x) => {
    const name = o.nameOf(x.j) || `#${x.j.number}`;
    const s = slots.get(x.j.id) || { col: 0, cols: 1 };
    return { id: x.j.id, top: x.box.top, height: x.box.height, col: s.col, cols: s.cols, color: o.colorOf(x.j.truck_id), name, label: o.labelOf(name, x.at) };
  });
}

/** a window chosen elsewhere (the agenda's grid, a paste) that the server no longer lists for this address: only said
    once the day's answer is in */
export function windowGone(picked: BlockChoice | null, day: Pick<GridDay, 'status'> | null, rows: readonly Suggestion[], truckId: string | null | undefined, windowOf: WindowOf): boolean {
  if (!picked || picked.win_start == null || !day || day.status !== 'ok') return false;
  return !rowsByStart(ofTruck(rows, truckId), windowOf).has(picked.win_start);
}

/** a phone lists one day's times. The day chosen; else the first day that has some — but a day still waiting for its
    answer before it is shown first (its skeleton), so times on screen never give way to another day's while the
    answers arrive in any order (the thumb going to « 14 h 30 » would land on another day's 14 h 30) */
export function listDay(days: readonly Pick<GridDay, 'day' | 'kind' | 'open'>[], chosen: Day | null): Day | null {
  if (chosen && days.some((d) => d.day === chosen)) return chosen;
  for (const d of days) {
    if (d.open.length) return d.day;
    if (d.kind === 'loading') return d.day;
  }
  return days[0]?.day ?? null;
}

/** every day of the page has its answer (or failed): only then are the hours brought into view chosen, so the grid does
    not open on the afternoon because today's answer came first */
export function pageSettled(days: readonly Pick<GridDay, 'status' | 'stale'>[]): boolean {
  return days.every((d) => d.status !== 'loading' || d.stale);
}

/** the hours brought into view when a page opens: the time chosen; on the page of today, today's first possible time
    (the hours around now: what the person on the phone with a customer looks at first) as soon as today has answered;
    on another page, or when today has nothing left, the first possible time of the whole page once every day has
    answered; nothing possible: half an hour before now today, or the top of the day. null: not decided yet. Before, the
    first day to answer decided, so the grid opened at hours that changed with the order of the answers. */
export function openingMinute(days: readonly Pick<GridDay, 'day' | 'status' | 'stale' | 'open' | 'chosen'>[], o: { today: Day; now: number; span: Range }): number | null {
  const chosen = days.find((x) => x.chosen != null)?.chosen ?? null;
  if (chosen != null) return chosen;
  const today = days.find((x) => x.day === o.today);
  if (today && pageSettled([today]) && today.open.length) return today.open[0];
  if (!pageSettled(days)) return null;
  const first = days.reduce<number | null>((a, x) => (x.open.length && (a == null || x.open[0] < a) ? x.open[0] : a), null);
  if (first != null) return first;
  return today ? Math.max(o.span[0], o.now - 30) : o.span[0];
}
