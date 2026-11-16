/* « Fixer les plages »: which flexible customers to text their window, and who could not be told (pure,
   windowTexts.test.ts). The server's `notify` never texts the same window twice (« already »), so asking again for a
   customer already told is safe. */
import type { Job } from '../../../data/types';

/** the booked flexible appointments that already have their window (fixed now, or earlier by the server) */
export function flexibleWithWindow(jobs: readonly Pick<Job, 'id' | 'block' | 'status' | 'win_flex' | 'win_start'>[]): string[] {
  return jobs.filter((j) => j.block === 'day' && j.win_flex && j.win_start != null && j.status === 'booked').map((j) => j.id);
}

/** a window of `day` already over at `minute` (its end, else its start, passed): nothing to tell any more. Pressed in
    the evening, « Fixer les plages » never texts « votre plage est confirmée » for a window gone (settings-team-st-2).
    An appointment not on this device (`undefined`) is left to the server. */
export function windowOver(j: Pick<Job, 'day' | 'win_start' | 'win_end'> | undefined, day: string, minute: number): boolean {
  if (!j || j.day !== day) return false;
  const end = j.win_end ?? j.win_start;
  return end != null && end <= minute;
}

/** what `notify` answered for one appointment (or `failed`: no answer at all) */
export interface TellAnswer { id: string; failed?: boolean; ok?: boolean; status?: string; code?: string; message?: string; phone?: string | null }
export interface Untold { id: string; phone: string | null; message: string | null }

/** the customers told (sent now, or already told) and the ones to tell by hand. Not counted: an appointment no longer
    coming or without a window (nothing to tell), and every text when the « window » switch is off (the owner's choice). */
export function tellOutcome(answers: readonly TellAnswer[], switchOff: boolean): { told: number; untold: Untold[] } {
  let told = 0;
  const untold: Untold[] = [];
  for (const a of answers) {
    if (!a.failed && (a.status === 'sent' || a.status === 'already')) { told++; continue; }
    if (!a.failed && (a.code === 'not_booked' || a.code === 'no_window')) continue;
    if (!a.failed && a.status === 'quiet' && switchOff) continue;
    untold.push({ id: a.id, phone: a.phone ?? null, message: a.message ?? null });
  }
  return { told, untold };
}
