/* Moving an appointment: what the customer was told, whether a move changes it (and so whether the « moved » text goes),
   how to read move_job's answer, which truck a drop on the time grid asks for. Pure (moveRules.test.ts).
   move_job's `changed` only means « another day or block »: with arrival windows a new window the same day answers
   changed: false, and `unchanged: true` comes without `changed` at all. The text follows what the customer was told. */
import type { Job } from '../../data/types';

type Told = Pick<Job, 'day' | 'block'> & { win_start?: number | null; win_end?: number | null; win_flex?: boolean };

/** what the customer was told of a job: its day, its block, and with arrival windows its window or « flexible » */
export function toldOf(j: Told): string {
  if (j.block !== 'day') return `${j.day}|${j.block}`;
  const win = j.win_start != null ? `${j.win_start}-${j.win_end ?? ''}` : j.win_flex ? 'flex' : '';
  return `${j.day}|day|${win}`;
}
/** does the customer have something new to hear? (another day, block, window, or fixed ↔ flexible) */
export function toldChanged(before: Told, after: Told): boolean { return toldOf(before) !== toldOf(after); }

export type MoveOutcome = { kind: 'queued' } | { kind: 'unchanged' } | { kind: 'moved'; after: Job | null; changed?: boolean };
/** reads move_job's answer: kept on the phone, nothing to change, or moved (with the job as the server wrote it, and
    its own « another day or block ») */
export function moveOutcome(r: { queued: boolean; data?: unknown }, jobId: string): MoveOutcome {
  if (r.queued) return { kind: 'queued' };
  const d = (r.data || {}) as { unchanged?: boolean; changed?: boolean; rows?: { jobs?: Job[] } };
  if (d.unchanged) return { kind: 'unchanged' };
  return { kind: 'moved', after: d.rows?.jobs?.find((x) => x.id === jobId) ?? null, changed: d.changed };
}
/** the « moved » text goes when the garage texts moves to this customer and what they were told changed. `after`: the
    job as written now (the answer's row, else the device's row). An answer without the job's row and a device row
    still as before cannot say: then the server's « another day or block » decides, as it always did. */
export function textAfterMove(o: MoveOutcome, before: Told, after: Told | null | undefined, wanted: boolean): boolean {
  if (!wanted || o.kind !== 'moved') return false;
  if (after && toldChanged(before, after)) return true;
  return !o.after && o.changed === true;
}

/** the truck a drop on the time grid asks for. A truck passed to move_job is kept for good (truck_pinned), and none
    passed lets the app choose again: a job dropped in its own truck's column only changes its time, so its truck is
    asked only when it was already kept there by hand. A column of the week is a day, not a truck: the app chooses. */
export function dropTruck(j: Pick<Job, 'truck_id' | 'truck_pinned'>, column: string | null): string | null {
  if (column == null) return null;
  if (column !== j.truck_id) return column;
  return j.truck_pinned ? column : null;
}
/** a drop on the time grid tells the customer something new: another day, another window, or a flexible job given one
    (another truck at the same window changes nothing for them, so no text is promised) */
export function dropTells(j: Told, day: string, winStart: number): boolean {
  return j.day !== day || j.block !== 'day' || j.win_start !== winStart;
}
