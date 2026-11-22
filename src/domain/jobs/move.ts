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
