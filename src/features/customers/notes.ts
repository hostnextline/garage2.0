/* The rules of a customer's notes: the quick reminder days, the order (reminders still to do first, the oldest due
   first; then the rest, newest first) and how many are due. Pure, tested in notes.test.ts. */
import { addMonths, type Day } from '../../lib/dates';
import type { CustomerNote } from '../../data/types';

/** the next time it is that month and day (spring: tires off; fall: winter tires on) */
export function nextOn(day: Day, month: number, date: number): Day {
  const y = Number(day.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, '0');
  const thisYear = `${y}-${pad(month)}-${pad(date)}`;
  return thisYear > day ? thisYear : `${y + 1}-${pad(month)}-${pad(date)}`;
}
/** the chips under a new note: in 1 month, in 3 months, spring (1 April), fall (15 October) */
export const quickDays = (today: Day) => [
  { key: 'in1', day: addMonths(today, 1) }, { key: 'in3', day: addMonths(today, 3) },
  { key: 'spring', day: nextOn(today, 4, 1) }, { key: 'fall', day: nextOn(today, 10, 15) }
] as const;

const toDo = (n: CustomerNote) => !!n.remind_on && !n.done_at;
/** the reminders still to do first (the oldest due date first), then the rest as they come (newest first) */
export function orderNotes(all: CustomerNote[]): CustomerNote[] {
  const open = all.filter(toDo).sort((a, b) => String(a.remind_on).localeCompare(String(b.remind_on)));
  return [...open, ...all.filter((n) => !toDo(n))];
}
/** how many reminders are due today or before */
export const dueCount = (all: CustomerNote[], today: Day) => all.filter((n) => toDo(n) && String(n.remind_on) <= today).length;

type NoteState = 'done' | 'late' | 'today' | 'later' | null;
/** what the pill of a note says */
export function noteState(n: Pick<CustomerNote, 'remind_on' | 'done_at'>, today: Day): NoteState {
  if (!n.remind_on) return null;
  if (n.done_at) return 'done';
  return n.remind_on < today ? 'late' : n.remind_on === today ? 'today' : 'later';
}
