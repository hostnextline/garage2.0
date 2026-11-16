/* « Copier / Coller un rendez-vous »: an appointment copied (right-click on it, or ⋯ on the job sheet) is pasted into a
   block (right-click on the block, or « Coller ici »): the booking screen opens with the same customer, car, address,
   work, problem and notes, in that block, and the person confirms with « Réserver » (the usual rules, nothing booked
   behind their back). The copy stays on this phone for the visit (sessionStorage). */
import { signal } from '@preact/signals';
import { href } from '../../platform/router';
import type { BlockKey, Day } from '../../lib/dates';

const KEY = 'his.agenda.copy';
function load(): string | null {
  try { const v = sessionStorage.getItem(KEY); return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null; } catch { return null; }
}
/** the id of the appointment copied, or null */
export const copiedJob = signal<string | null>(load());

export function copyJob(id: string) {
  copiedJob.value = id;
  try { sessionStorage.setItem(KEY, id); } catch { /* kept for this screen only */ }
}
export function clearCopy() {
  copiedJob.value = null;
  try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ }
}
/** the booking screen, with the copy and the block chosen (« Plages d'arrivée »: the day, block 'day'; the window is
    chosen there, or already said with `win`: the start of the window of the unit clicked on the time grid) */
export function pasteHref(day: Day, block: BlockKey, id: string | null = copiedJob.value, win: number | null = null): string {
  return href('/book', { copy: id, day, block, win: win == null ? null : String(win) });
}
/** the booking screen for a place of the agenda (`win`: the window that goes with the time clicked on the grid) */
export function bookHref(day: Day, block: BlockKey, win: number | null = null): string {
  return href('/book', { day, block, win: win == null ? null : String(win) });
}
