/* Agenda: pure helpers for the week and the day (layout.test.ts). */
import { weekDays, weekStart, addDays, daysBetween, duration, parseDay, type Day, type BlockKey } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';
import { blockPhraseLower } from '../booking/when';

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
export function freeWords(used: number, cap: number, l: Lang, short = false): string {
  if (cap <= 0) return used > 0 ? t('agenda.lane.offShift', undefined, l) : t('agenda.lane.closed', undefined, l);
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
  if (job.day === to.day && job.block === to.block) return 'same';
  if (target.started) return 'started';
  if (!target.open) return 'closed';
  return null;
}

/** how many days a day is from today, in words for the strip (« Aujourd'hui », « Demain »…) — '' when far */
export function dayDistance(day: Day, todayDay: Day): number { return daysBetween(todayDay, day); }
