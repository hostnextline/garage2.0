/* « Heures travaillées » (#/timesheet): the pure parts. A day of work is a shift (« Commencer / Terminer ma journée »);
   it counts on the day it began. The week goes from Monday to Sunday here (Hassan's choice for the hours, 2026-11-19;
   the schedule's week stays Sunday to Saturday). A shift of 16 hours or more that nobody corrected is « à vérifier »:
   the night's housekeeping closes a day only 16 hours after it began, so a forgotten « Terminer ma journée » always
   shows that way. Moments are read and written on the garage's clock (lib/dates: dayOf, minuteOf, instantOf), like
   the rest of the app. Tested in logic.test.ts. */
import type { Shift, Staff } from '../../data/types';
import { addDays, addMonths, dayOf, dow, duration, instantOf, minuteOf, parseDay, type Day } from '../../lib/dates';

export const LONG_MIN = 16 * 60;
export const MAX_MIN = 24 * 60;

type ShiftLike = Pick<Shift, 'id' | 'staff_id' | 'started_at' | 'ended_at' | 'deleted_at'> & { fixed_at?: string | null; fixed_by?: string | null };

/** the Monday of a day's week */
export function mondayOf(day: Day): Day { return addDays(day, -((dow(day) + 6) % 7)); }
/** Monday … Sunday */
export function weekOf(day: Day): Day[] { const m = mondayOf(day); return Array.from({ length: 7 }, (_, i) => addDays(m, i)); }
export function monthOf(day: Day): { from: Day; to: Day } {
  const from = `${day.slice(0, 7)}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}
/** the garage's day a moment falls on */
export function dayOfIso(iso: string): Day { return dayOf(new Date(iso)); }
/** minutes after the garage's midnight of a moment */
export function minuteOfIso(iso: string): number { return minuteOf(new Date(iso)); }

/** the minutes of one shift (an open one counts until now) */
export function minutesOf(s: Pick<Shift, 'started_at' | 'ended_at'>, now = Date.now()): number {
  const a = Date.parse(s.started_at), b = s.ended_at ? Date.parse(s.ended_at) : now;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 60000)) : 0;
}
/** closed by the night (« Terminer ma journée » forgotten) and nobody corrected it yet */
export function toCheck(s: ShiftLike): boolean {
  return !!s.ended_at && !s.fixed_at && minutesOf(s) >= LONG_MIN;
}

/** one person's shifts, oldest first (removed ones left out) */
export function shiftsOfStaff<S extends ShiftLike>(all: S[], staffId: string): S[] {
  return all.filter((s) => s.staff_id === staffId && !s.deleted_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
}

export interface DayHours<S extends ShiftLike = ShiftLike> { day: Day; shifts: S[]; minutes: number; check: boolean; open: boolean }
export interface WeekHours<S extends ShiftLike = ShiftLike> { monday: Day; days: DayHours<S>[]; minutes: number; daysWorked: number; check: number; open: boolean }

/** a person's week: each day (Monday to Sunday) with its shifts and minutes, and the totals */
export function weekHours<S extends ShiftLike>(all: S[], staffId: string, anyDay: Day, now = Date.now()): WeekHours<S> {
  const mine = shiftsOfStaff(all, staffId);
  const days = weekOf(anyDay).map((day) => {
    const shifts = mine.filter((s) => dayOfIso(s.started_at) === day);
    return { day, shifts, minutes: shifts.reduce((n, s) => n + minutesOf(s, now), 0), check: shifts.some(toCheck), open: shifts.some((s) => !s.ended_at) };
  });
  return {
    monday: days[0].day, days,
    minutes: days.reduce((n, d) => n + d.minutes, 0),
    daysWorked: days.filter((d) => d.shifts.length).length,
    check: days.reduce((n, d) => n + d.shifts.filter(toCheck).length, 0),
    open: days.some((d) => d.open)
  };
}
/** a person's minutes for the shifts begun between two days (both included) */
export function periodMinutes(all: ShiftLike[], staffId: string, from: Day, to: Day, now = Date.now()): number {
  return shiftsOfStaff(all, staffId).filter((s) => { const d = dayOfIso(s.started_at); return d >= from && d <= to; })
    .reduce((n, s) => n + minutesOf(s, now), 0);
}

type Person = Pick<Staff, 'id' | 'full_name' | 'short_name' | 'roles' | 'active' | 'deleted_at'>;
export interface TeamRow<P extends Person = Person, S extends ShiftLike = ShiftLike> { staff: P; week: WeekHours<S> }
/** the owners' and the treasurer's list: every active mechanic, and anyone else who worked that week */
export function teamWeek<P extends Person, S extends ShiftLike>(all: S[], people: P[], anyDay: Day, now = Date.now()): TeamRow<P, S>[] {
  return people.filter((p) => !p.deleted_at)
    .map((p) => ({ staff: p, week: weekHours(all, p.id, anyDay, now), mech: p.active && p.roles.includes('mechanic') }))
    .filter((r) => r.mech || r.week.daysWorked > 0)
    .sort((a, b) => a.staff.full_name.localeCompare(b.staff.full_name, 'fr'))
    .map(({ staff, week }) => ({ staff, week }));
}

/** « 8 h 08 », « 0 h » */
export function hoursText(min: number, lang = 'fr'): string { return min > 0 ? duration(min, lang) : '0 h'; }
/** « 23,75 h » / « 23.75 h »: the hours with decimals (for pay) */
export function decimalHours(min: number, lang = 'fr'): string {
  const v = Math.round((min / 60) * 100) / 100;
  return `${v.toLocaleString(lang === 'en' ? 'en-CA' : 'fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

/** « 16 – 22 nov. 2026 » / « Nov 16 – 22, 2026 » (the months and years said when they change) */
export function weekLabel(monday: Day, lang = 'fr'): string {
  const a = parseDay(monday), b = parseDay(addDays(monday, 6));
  const loc = lang === 'en' ? 'en-CA' : 'fr-CA';
  const sameMonth = a.getMonth() === b.getMonth(), sameYear = a.getFullYear() === b.getFullYear();
  const f = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, o).format(d);
  if (lang === 'en') {
    const start = f(a, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    const end = sameMonth && sameYear ? `${b.getDate()}, ${b.getFullYear()}` : f(b, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${start} – ${end}`;
  }
  const start = sameMonth && sameYear ? String(a.getDate()) : f(a, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${f(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/* ---------- the correction sheet ---------- */
export interface Draft { day: Day; start: number | null; end: number | null }
export interface Planned { startIso: string; endIso: string | null; minutes: number; nextDay: boolean }
export type DraftError = 'no_start' | 'no_end' | 'too_long' | 'future' | 'overlap' | 'zero';

/** a garage day + minutes after midnight → the moment (an end before the start is the next day) */
export function isoAt(day: Day, min: number): string {
  return instantOf(day, min).toISOString();
}
/** what the sheet will send, or why not (the same rules as the server's shift_save) */
export function planDraft(dr: Draft, o: { open: boolean; others: ShiftLike[]; selfId?: string | null; now?: number }): { plan?: Planned; error?: DraftError } {
  const now = o.now ?? Date.now();
  if (dr.start == null) return { error: 'no_start' };
  if (!o.open && dr.end == null) return { error: 'no_end' };
  const startIso = isoAt(dr.day, dr.start);
  let endIso: string | null = null, nextDay = false;
  if (!o.open && dr.end != null) {
    if (dr.end === dr.start) return { error: 'zero' };
    nextDay = dr.end < dr.start;
    endIso = isoAt(nextDay ? addDays(dr.day, 1) : dr.day, dr.end);
  }
  const a = Date.parse(startIso), b = endIso ? Date.parse(endIso) : now;
  if (endIso && b - a > MAX_MIN * 60000) return { error: 'too_long' };
  if (a > now || (endIso && b > now + 5 * 60000)) return { error: 'future' };
  const hit = o.others.some((s) => s.id !== o.selfId && !s.deleted_at
    && Date.parse(s.started_at) < (endIso ? b : Infinity) && a < (s.ended_at ? Date.parse(s.ended_at) : Infinity));
  if (hit) return { error: 'overlap' };
  return { plan: { startIso, endIso, minutes: Math.max(0, Math.round((b - a) / 60000)), nextDay } };
}
