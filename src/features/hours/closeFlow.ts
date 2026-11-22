/* « Déplacer vers … » of « La voiture ferme »: the appointments are moved one by one while their vehicle is still open,
   and the hours close only once EVERY move is confirmed by the server. The first refusal (no right, no room, a moment
   started) or a move only kept on the phone (no answer in time) stops everything before the hours are touched: the
   person sees why and chooses again (the sheet stays open), instead of finding the appointments in « À placer ».
   Pure: the mover is passed in (closeFlow.test.ts). The server's own transaction for « move and close » is asked of the
   server package (requests/map-hours.md); until then this order is what keeps the appointments safe. */
import type { Move } from '../../shared/map/closing';

export type Mover = (m: Move & { target: string }) => Promise<{ queued: boolean }>;
export type MoveOutcome =
  | { kind: 'done'; moved: string[] }
  | { kind: 'refused'; moved: string[]; job: string; error: unknown }
  | { kind: 'waiting'; moved: string[]; job: string };

export async function moveAll(moves: Move[], move: Mover): Promise<MoveOutcome> {
  const moved: string[] = [];
  for (const m of moves) {
    if (!m.target) continue;
    try {
      const r = await move({ ...m, target: m.target });
      // kept on the phone: it will be sent later, but nobody knows yet whether the server takes it
      if (r.queued) return { kind: 'waiting', moved, job: m.job.id };
    } catch (error) {
      return { kind: 'refused', moved, job: m.job.id, error };
    }
    moved.push(m.job.id);
  }
  return { kind: 'done', moved };
}
