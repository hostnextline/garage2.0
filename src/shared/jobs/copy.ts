/* « Copier / Coller un rendez-vous »: an appointment copied (right-click or long press on it in the agenda, or on a stop of
   a truck: Carte, Vue d'ensemble, Aujourd'hui) is pasted into a block or a day of the agenda (right-click on it, or
   « Coller ici »): the booking screen opens with the same customer, car, address, work, problem and notes, in that place,
   and the person confirms with « Réserver » (the usual rules, nothing booked behind their back). The copy stays on this
   phone for the visit (sessionStorage), and only while this person is signed in and the phone still holds the appointment.
   Moved here from the agenda (features/agenda/copy.ts re-exports it): the shortcut menu of a job is shared. */
import { effect, signal } from '@preact/signals';
import { href } from '../../platform/router';
import { access } from '../../data/auth';
import { job as jobRow } from '../../data/select';
import type { Job } from '../../data/types';
import type { BlockKey, Day } from '../../lib/dates';

const KEY = 'his.agenda.copy';
function load(): string | null {
  try { const v = sessionStorage.getItem(KEY); return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null; } catch { return null; }
}
/** the id of the appointment copied, or null */
export const copiedJob = signal<string | null>(load());

export function copyJob(id: string) {
  copiedJob.value = id;
  try { sessionStorage.setItem(KEY, id); } catch { /* storage refused (private window): kept for this visit only */ }
}
export function clearCopy() {
  copiedJob.value = null;
  try { sessionStorage.removeItem(KEY); } catch { /* storage refused: nothing was kept there either */ }
}
/** the appointment copied, when this phone holds it (another account's copy, or a job no longer here: none) */
export function copiedRow(): Job | undefined {
  const id = copiedJob.value;
  return id ? jobRow(id) : undefined;
}

// signing out (or another person signing in on the same tab) forgets the copy: it was the other person's. The real
// account is watched, not the one shown: « Voir l'app comme… » and back keeps the owner's copy.
let signedIn: string | null = null;
effect(() => {
  const id = access.value?.id ?? null;
  if (signedIn && id !== signedIn) clearCopy();
  if (id) signedIn = id;
});

/** the booking screen, with the copy and the block chosen (« Plages d'arrivée »: the day, block 'day'; the window is
    chosen there, or already said with `win`: the start of the window of the unit clicked on the time grid) */
export function pasteHref(day: Day, block: BlockKey, id: string | null = copiedJob.value, win: number | null = null): string {
  return href('/book', { copy: id, day, block, win: win == null ? null : String(win) });
}
/** the booking screen for a place of the agenda (`win`: the window that goes with the time clicked on the grid) */
export function bookHref(day: Day, block: BlockKey, win: number | null = null): string {
  return href('/book', { day, block, win: win == null ? null : String(win) });
}
