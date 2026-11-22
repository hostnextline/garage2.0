/* « Déplacer » and « Changer de camion » from the job sheet: does the customer get the « moved » text? Only when what they
   were told changed (the day, the block, the arrival window, fixed ↔ flexible): never for a truck changed at the same
   moment, nor for a move the server answered « nothing to change ». Pure (move.test.ts).
   The server says it itself since the rebuild (move_job's `tell`, read on its own row); an older server does not, and then
   the agenda's rules decide (domain/moment/moveRules.ts: the job as written against the job as it was). */
import type { Job } from '../../data/types';
import { moveOutcome, textAfterMove } from '../moment/moveRules';

type Told = Pick<Job, 'id' | 'day' | 'block'> & { win_start?: number | null; win_end?: number | null; win_flex?: boolean };

/** `r`: what moveJob gave (kept on the phone, or the server's answer); `before`: the job as the sheet showed it;
    `deviceAfter`: the job as this phone has it now (used only when the answer carries no row); `wanted`: the garage texts
    moves (settings messages.on.moved). A move kept on the phone (no signal) never texts: nothing is sure yet. */
export function moveTextGoes(r: { queued: boolean; data?: unknown }, before: Told, deviceAfter: Told | null | undefined, wanted: boolean): boolean {
  if (!wanted || r.queued) return false;
  const tell = (r.data as { tell?: unknown } | null | undefined)?.tell;
  if (typeof tell === 'boolean') return tell;
  const o = moveOutcome(r, before.id);
  return textAfterMove(o, before, o.kind === 'moved' ? o.after ?? deviceAfter : null, wanted);
}

/** an answer of move_preview says every trip of that day is measured (unmeasured = 0). With a trip not measured the
    server counts a fixed time (booking.unknown_min) for it, so its arrival times are not said as facts (CONTRACT §0,
    review-sheets M1); null (the server's switch off, an older server): not said either. */
export function timesMeasured(answer: { unmeasured: number | null }): boolean { return answer.unmeasured === 0; }

/** « Changer de camion » with the real roads on: what the server says of this appointment on that truck (move_preview
    with only it: the very move_job, undone): it fits, with its arrival there (null when the answer has none, or while a
    trip of that day is not measured: `unmeasured` true then, so the sheet says why), or the move would be refused (full,
    the wrong vehicle for the work, a moment started…). null answer (an older server): nothing said. */
export function fitOf(answer: { refused: readonly string[]; eta: Readonly<Record<string, number | null>>; unmeasured: number | null; refused_why?: Readonly<Record<string, string>> } | null, jobId: string): { fits: boolean; eta: number | null; unmeasured: boolean; why?: string } | null {
  if (!answer) return null;
  if (answer.refused.includes(jobId)) {
    // why (when the server says it: refused_why): move_job's refusal code (truck_full, needs_truck, block_started…)
    const why = answer.refused_why?.[jobId];
    return { fits: false, eta: null, unmeasured: false, ...(why ? { why } : {}) };
  }
  if (!timesMeasured(answer)) return { fits: true, eta: null, unmeasured: (answer.unmeasured ?? 0) > 0 };
  return { fits: true, eta: answer.eta[jobId] ?? null, unmeasured: false };
}
