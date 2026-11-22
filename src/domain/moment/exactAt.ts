/* « exact move » (STATE.md A1): the minute a choice of « Déplacer » showed, the one the move sends. Pure (tested in
   domain/jobs/exact.test.ts).
   A quarter hour of the calendar (PickGrid, PickList) carries that very minute; a best moment carries the server's
   arrival, and the bar above the picker says it as the nearest quarter hour of that window (« Vers 13 h »): that is what
   the person saw, so that is what is sent. Flexible, the day alone, a block: no time was pointed (null: moved as before). */
import type { Range } from '../../lib/dates';
import type { BlockChoice } from './choice';
import { unitOfWindow, type WindowOf } from './units';

export function exactAtOf(c: Pick<BlockChoice, 'block' | 'win_start' | 'win_flex' | 'eta'> & Partial<BlockChoice>, span: Range, windowOf: WindowOf): number | null {
  if (c.block !== 'day' || c.win_flex || c.win_start == null || c.eta == null) return null;
  return unitOfWindow(span, c.win_start, c.eta, windowOf) ?? c.eta;
}

/** the minute a row of the agenda's window list prints (« Arrivée vers … ») and sends (review F1): the row is a WINDOW the
    server tried and its arrival is the planner's with that window held (eta = its start when the truck waits for it to
    open, near its end when it gets there late), while an exact move tells the customer the garage's window of the minute
    sent (S2). So: its own arrival when that minute gives the row's window, else the nearest quarter hour that does (the
    « Vers … » of the best moments). null: no arrival said, or no quarter hour of the day gives that window (moved by
    its window alone, as before) */
export function windowRowAt(start: number, eta: number | null | undefined, span: Range, windowOf: WindowOf): number | null {
  if (eta == null) return null;
  if (windowOf(eta)[0] === start) return eta;
  return unitOfWindow(span, start, eta, windowOf);
}
