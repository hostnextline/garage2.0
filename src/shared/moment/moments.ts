/* The moments the server offers (`suggest_blocks`) as both pickers use them: which rows are kept, the best ones offered,
   and « garde-route » (Part 25: a moment far from the vehicle's other stops that day is marked, never offered, warned
   with « Plutôt … » and asked about before booking or moving). Pure: tested in moments.test.ts. The block-mode rules of
   garde-route themselves are in domain/moment/logic.ts (isFar, farInfo, betterMoments). */
import { duration, isValidDay, type Day } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';
import type { Suggestion } from '../../data/api';
import type { Job } from '../../data/types';
import type { BlockChoice } from '../../domain/moment/choice';
import { betterMoments, farInfo, isFar, offered, sameMoment, suggWindow, type FarInfo, type FarLimits, type Moment } from '../../domain/moment/logic';
import { windowPhrase } from '../../domain/moment/words';
import type { Win, WindowOf } from '../../domain/moment/units';

/** the rows a picker keeps: a real day, and with a vehicle chosen by hand only its rows (or rows without a vehicle) */
export function keptRows<T extends { day: string; truck: string | null }>(list: readonly T[], truckId: string | null | undefined): T[] {
  return list.filter((x) => isValidDay(String(x.day)) && (!truckId || !x.truck || x.truck === truckId));
}

/* ---------- « Plages d'arrivée »: one row per day, with its best window ---------- */
/** a day's best moment in windows mode, with the window to tell the customer */
export type DayRow = Suggestion & { win: Win };
/** every row as a whole-day moment (block 'day'): the scores of garde-route are the day's */
export function dayScores(list: readonly Suggestion[]): Suggestion[] {
  return list.map((x) => ({ ...x, block: 'day' as const }));
}
/** the rows that have a window to tell (the server's, else the one its estimated arrival gives) */
export function dayRows(list: readonly Suggestion[], windowOf: WindowOf, len: number): DayRow[] {
  const out: DayRow[] = [];
  for (const x of list) {
    const win = suggWindow(x, (m) => windowOf(m) as Win, len);
    if (win) out.push({ ...x, block: 'day', win });
  }
  return out;
}
/** the best moments of windows mode: never a far one (the server only puts them last), the first three */
export const bestWindows = (rows: readonly DayRow[], n = 3): DayRow[] => offered(rows.slice(), n);

/** the choice a best moment gives */
export function rowChoice(s: DayRow): BlockChoice {
  return { day: s.day, block: 'day', win_start: s.win[0], win_end: s.win[1], eta: s.eta ?? null, truck: s.truck };
}

/** garde-route of a choice in windows mode. The window's own score when the server gives one (a newer
    `suggest_windows` may), else the day's (`suggest_blocks`, one row per day): « Flexible » and the day alone take the
    day's. The question before booking (farQuestion) compares day and block, so the warning is raised for block 'day'. */
export function windowFar(c: BlockChoice | null, day: Moment | undefined, win: Moment | undefined, lim: FarLimits, l: Lang): FarInfo | null {
  if (!c || c.block !== 'day') return null;
  const s = win && win.far !== undefined ? win : day;
  return s ? farInfo({ ...s, day: c.day, block: 'day' }, lim, l) : null;
}

type Current = Pick<Job, 'day' | 'block' | 'win_start' | 'win_flex'> | null | undefined;
/** the moments to propose instead of a far one: the best that are not far, never the moment the appointment being moved
    is in now (choosing it would change nothing) */
export function betterThan<M extends Moment>(picked: Moment, list: readonly M[], current: Current, choiceOf: (m: M) => BlockChoice, n = 2): { moment: M; saved: number | null }[] {
  const pool = current ? list.filter((m) => !sameMoment(choiceOf(m), current)) : list.slice();
  return betterMoments(picked, pool, n);
}

/** a phrase inside a sentence: « Plutôt demain, entre 14 h et 18 h » (English weekdays and months keep their capital) */
export function lowerFirst(s: string, l: Lang): string {
  if (!s || (l === 'en' && !/^(Today|Tomorrow|Yesterday|This)\b/.test(s))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
/** « Plutôt demain, entre 14 h et 18 h : 13 min de route en moins » */
export function betterWindowText(b: { moment: DayRow; saved: number | null }, today: Day, l: Lang): string {
  const when = lowerFirst(windowPhrase(b.moment.day, b.moment.win, today, l), l);
  return b.saved != null ? t('booking.far.better', { when, d: duration(b.saved, l) }, l) : t('booking.far.betterPlain', { when }, l);
}

/** some moment the server scored is far: the legend says what the dashed mark means */
export const anyFar = (list: Iterable<Moment>): boolean => { for (const m of list) if (isFar(m)) return true; return false; };
