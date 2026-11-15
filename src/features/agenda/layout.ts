/* Agenda: pure helpers for the week and the day (layout.test.ts). */
import { weekDays, weekStart, addDays, daysBetween, duration, parseDay, clock, longDay, type Day, type BlockKey, type Range } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';
import { blockPhraseLower, relativeDay, windowWords } from '../booking/when';

/** the 7 days shown (Sunday → Saturday) around a day */
export function weekOfDay(day: Day): Day[] { return weekDays(day); }
/** the same weekday one week before / after */
export function shiftWeek(day: Day, n: number): Day { return addDays(day, 7 * n); }
export function sameWeek(a: Day, b: Day): boolean { return weekStart(a) === weekStart(b); }

/** « Semaine du 1er au 7 novembre » / « Week of November 1 to 7 » (months and years said only when they change) */
export function weekTitle(day: Day, l: Lang): string {
  const [a, z] = [weekStart(day), addDays(weekStart(day), 6)];
  const loc = l === 'en' ? 'en-CA' : 'fr-CA';
  const dayNum = (x: Day) => { const n = parseDay(x).getDate(); return l === 'fr' && n === 1 ? '1er' : String(n); };
  const month = (x: Day) => new Intl.DateTimeFormat(loc, { month: 'long' }).format(parseDay(x));
  const year = (x: Day) => String(parseDay(x).getFullYear());
  const sameMonth = a.slice(0, 7) === z.slice(0, 7), sameYear = a.slice(0, 4) === z.slice(0, 4);
  if (l === 'en') {
    const from = `${month(a)} ${dayNum(a)}${sameYear ? '' : `, ${year(a)}`}`;
    const to = `${sameMonth ? '' : `${month(z)} `}${dayNum(z)}${sameYear ? '' : `, ${year(z)}`}`;
    return t('agenda.week.title', { from, to }, l);
  }
  const from = `${dayNum(a)}${sameMonth ? '' : ` ${month(a)}`}${sameYear ? '' : ` ${year(a)}`}`;
  const to = `${dayNum(z)} ${month(z)}${sameYear ? '' : ` ${year(z)}`}`;
  return t('agenda.week.title', { from, to }, l);
}

/* ---------- how full a truck is in a block ---------- */
export interface Fill { pct: number; over: boolean; left: number; used: number; cap: number }
export function fillOf(used: number, cap: number): Fill {
  const pct = cap > 0 ? Math.min(1, Math.max(0, used / cap)) : used > 0 ? 1 : 0;
  return { pct, over: used > cap, left: cap - used, used, cap };
}
/** « 2 h 08 », « 45 min » — short enough for a small cell, in both languages */
export function shortDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
/** « 1 h 20 de libre », « Complet », « Complet, 20 min de trop », « Ne travaille plus dans ce bloc » */
export function freeWords(used: number, cap: number, l: Lang, short = false, wholeDay = false): string {
  if (cap <= 0) return used > 0 ? t(wholeDay ? 'agenda.lane.offShiftDay' : 'agenda.lane.offShift', undefined, l) : t('agenda.lane.closed', undefined, l);
  const left = cap - used;
  const d = (x: number) => (short ? shortDuration(x) : duration(x, l));
  if (left > 0) return t('agenda.lane.free', { d: d(left) }, l);
  if (left === 0 || short) return t('agenda.lane.full', undefined, l);
  return t('agenda.lane.over', { d: d(-left) }, l);
}
/** for screen readers: « 2 h 40 prises sur 4 h » */
export function fillWords(used: number, cap: number, l: Lang): string {
  return t('agenda.lane.meter', { used: duration(Math.max(0, used), l), cap: duration(Math.max(0, cap), l) }, l);
}

/* ---------- moving a job by dragging it ---------- */
/** « Déplacer la job de Julie de mardi matin à jeudi après-midi ? » */
export function moveQuestion(name: string, from: { day: Day; block: BlockKey }, to: { day: Day; block: BlockKey }, todayDay: Day, l: Lang): string {
  return t('agenda.move.question', {
    name: name || t('agenda.move.someone', undefined, l),
    from: blockPhraseLower(from.day, from.block, todayDay, l),
    to: blockPhraseLower(to.day, to.block, todayDay, l)
  }, l);
}
export type DropRefusal = 'same' | 'started' | 'closed' | 'not_booked' | null;
/** can a job be dropped on that block? (the server checks again: room, truck…) */
export function dropRefusal(job: { day: Day; block: BlockKey; status: string }, to: { day: Day; block: BlockKey }, target: { started: boolean; open: boolean }): DropRefusal {
  if (job.status !== 'booked') return 'not_booked';
  // « Plages d'arrivée »: the same day takes the job again (another window that day)
  if (job.day === to.day && job.block === to.block && to.block !== 'day') return 'same';
  if (target.started) return 'started';
  if (!target.open) return 'closed';
  return null;
}

/** how many days a day is from today, in words for the strip (« Aujourd'hui », « Demain »…) — '' when far */
export function dayDistance(day: Day, todayDay: Day): number { return daysBetween(todayDay, day); }

/* ---------- « Plages d'arrivée »: a day drawn as one piece, each job with the window told to its customer ---------- */
/** is this day drawn as ONE day (windows) or by blocks? Windows: the garage books by windows and the day is today or
    later, or the day already holds a job booked for « the day ». A past day of blocks keeps its three blocks. */
export function isWindowDay(day: Day, todayDay: Day, windowsOn: boolean, jobBlocks: readonly BlockKey[]): boolean {
  return (windowsOn && day >= todayDay) || jobBlocks.includes('day');
}
/** a whole day as a booking place: over once its last hour has passed (not when it starts, as a block does); open
    while a truck still has enough hours left in it */
export function dayState(day: Day, todayDay: Day, now: number, span: Range, caps: readonly number[], minBlock: number): { started: boolean; open: boolean } {
  const started = day < todayDay || (day === todayDay && now >= span[1]);
  const need = Math.min(minBlock, span[1] - span[0]);
  return { started, open: !started && caps.some((c) => c > 0 && c >= need) };
}
type Planned = { stop_order: number | null; eta_min: number | null; number: number };
/** the stops in the order planned: the stop number, then the estimated arrival */
export function byPlan(a: Planned, b: Planned): number {
  return ((a.stop_order ?? 99) - (b.stop_order ?? 99)) || ((a.eta_min ?? 9999) - (b.eta_min ?? 9999)) || (a.number - b.number);
}
/** the stops by the hour: the planned arrival first (none: last), then the stop number (the list of a phone) */
export function byArrival(a: Planned, b: Planned): number {
  return ((a.eta_min ?? 9999) - (b.eta_min ?? 9999)) || ((a.stop_order ?? 99) - (b.stop_order ?? 99)) || (a.number - b.number);
}
export interface WinInfo { win: Range | null; flex: boolean; late: boolean }
type Windowed = { block: BlockKey; win_start?: number | null; win_end?: number | null; win_flex?: boolean; eta_min: number | null; status: string };
/** what to say of a job booked for « the day »: its window, « flexible » (no window yet), « hors plage » (the arrival
    planned falls outside the window promised). null: a job of a block (drawn as before). */
export function winInfo(j: Windowed): WinInfo | null {
  if (j.block !== 'day') return null;
  const win: Range | null = j.win_start != null && j.win_end != null ? [j.win_start, j.win_end] : null;
  // a stop on the way or there is not judged: the planner no longer moves it (the same rule as the job ticket)
  const late = !!win && j.status === 'booked' && j.eta_min != null && (j.eta_min < win[0] || j.eta_min > win[1]);
  return { win, flex: !win && j.win_flex === true, late };
}
/** « 14 h – 18 h » / « 2 p.m. – 6 p.m. »: a window, short enough for a small ticket */
export function winShort(win: Range, l: Lang): string { return `${clock(win[0], l)} – ${clock(win[1], l)}`; }
/** the same, as short as it gets, for a narrow block of the week's grid: « 14–18 h » / “2–6 p.m.” (the hour or the half
    of the day said once when both ends share it) */
export function winTiny(win: Range, l: Lang): string {
  const a = clock(win[0], l), b = clock(win[1], l);
  if (l === 'en') {
    const m = /^(.*) ([ap]\.m\.)$/.exec(a);
    return m && b.endsWith(m[2]) ? `${m[1]}–${b}` : `${a}–${b}`;
  }
  return win[0] % 60 === 0 && win[1] % 60 === 0 ? `${win[0] / 60}–${b}` : `${a}–${b}`;
}

/** « Demain », « Jeudi », « Jeudi 19 novembre »: a day in words, for a title */
export function dayWords(day: Day, todayDay: Day, l: Lang): string {
  const diff = daysBetween(todayDay, day);
  const s = relativeDay(day, todayDay, l) || (diff >= 2 && diff <= 6 ? new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' }).format(parseDay(day)) : longDay(day, l));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** « Déplacer la job de Julie : demain » / the same day: « Changer la plage de Julie : demain » */
export function moveDayTitle(name: string, from: Day, to: Day, todayDay: Day, l: Lang): string {
  const day = dayWords(to, todayDay, l);
  return t(from === to ? 'agenda.move.winTitleSame' : 'agenda.move.winTitle', { name: name || t('agenda.move.someone', undefined, l), day: l === 'en' ? day : day.charAt(0).toLowerCase() + day.slice(1) }, l);
}
export interface WindowChoice { start: number; end: number; eta: number | null; best: boolean; current: boolean; words: string }
/** the windows to offer for a move, as the server ranked them (best first), each once; the job's own window that same
    day is marked (nothing to change there) and is never « the best » */
export function windowChoices(list: readonly { win_start?: number | null; win_end?: number | null; eta?: number | null }[], job: { day: Day; win_start?: number | null }, day: Day, l: Lang): WindowChoice[] {
  const out: WindowChoice[] = [];
  for (const s of list) {
    if (s.win_start == null || s.win_end == null || out.some((x) => x.start === s.win_start)) continue;
    const current = job.day === day && job.win_start === s.win_start;
    const w = windowWords([s.win_start, s.win_end], l);
    out.push({ start: s.win_start, end: s.win_end, eta: s.eta ?? null, best: false, current, words: w.charAt(0).toUpperCase() + w.slice(1) });
  }
  const best = out.find((x) => !x.current);
  if (best) best.best = true;
  return out;
}
