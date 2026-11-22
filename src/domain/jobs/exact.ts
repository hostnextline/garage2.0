/* « exact move » (STATE.md A2): what the server's preview of a move to a minute pointed means for the person, as ONE of
   four cases, and which time « Changer de camion » keeps. Pure (exact.test.ts); the words are the flow's
   (shared/jobs/exactMove.ts).
   - ok: nobody would be late (`pushed`: stops that would arrive later than now, still inside their window: said, so
     « les autres arrêts gardent leur heure » is never said when it is not true);
   - late: somebody would be late (after the window told to them), or the truck would end past its hours;
   - early: the truck cannot be there at that minute (the earliest it can; the earliest that changes nobody's time);
   - unsure: a trip of that day is not measured (« Vraies routes » on: never « late » from a guess, S8) or the server
     could not answer for that move (an older one, an error);
   - refused: the move would be refused for another reason (its words: errors.<code>). */
import type { ExactAnswer, ExactStop } from '../../data/exact';
import { ARRIVE_LATE } from '../../data/exact';
import type { Job } from '../../data/types';

export type ExactCase =
  | { kind: 'ok'; pushed: ExactStop[] }
  | { kind: 'late'; late: ExactStop[]; pushed: ExactStop[]; overHours: number }
  | { kind: 'early'; earliest: number | null; keep: number | null }
  | { kind: 'unsure'; why: 'unmeasured' | 'unchecked' }
  | { kind: 'refused'; code: string };

/** the case of a preview's answer for the job moved (null: no answer of the exact move) */
export function exactCase(a: ExactAnswer | null, jobId: string): ExactCase {
  if (!a) return { kind: 'unsure', why: 'unchecked' };
  if (a.refused === ARRIVE_LATE) return { kind: 'early', earliest: a.earliest, keep: a.earliestKeep };
  if (a.refused) return { kind: 'refused', code: a.refused };
  if (!a.exact) return { kind: 'unsure', why: 'unchecked' };
  const others = a.stops.filter((s) => s.id !== jobId);
  // the server says late only from measured trips (S8): a late it says stands, a guessed time never makes one
  const late = others.filter((s) => s.late && s.measured !== false);
  const pushed = others.filter((s) => !s.late && s.delay > 0 && s.measured !== false);
  if (late.length || a.overHours > 0) return { kind: 'late', late, pushed, overHours: a.overHours };
  if (a.stops.some((s) => s.measured === false)) return { kind: 'unsure', why: 'unmeasured' };
  return { kind: 'ok', pushed };
}

/** what « Déplacer quand même » accepts (late_ok): the stops shown late, and the moved one itself when the truck would end
    past its hours (that lateness is the move's own) */
export function lateOkOf(c: ExactCase, jobId: string): string[] {
  if (c.kind !== 'late') return [];
  return [...c.late.map((s) => s.id), ...(c.overHours > 0 ? [jobId] : [])];
}

type Kept = Pick<Job, 'block' | 'eta_min'> & { win_start?: number | null; win_end?: number | null; win_flex?: boolean; arrive_at?: number | null };
/** « Changer de camion »: the time the appointment keeps on the other truck. Its minute pointed by hand, else its arrival
    when the window that arrival gives (the garage's rule) is the very window the customer has: then nothing changes for
    them. null: no time to keep (blocks, flexible, no arrival), or keeping it would cut the customer a new window (13 h 40
    in 12 h – 16 h would say 13 h – 17 h): the move then goes as before (the planner's time inside the window told). */
export function keptTimeOf(j: Kept, windowOf: (eta: number) => readonly [number, number]): number | null {
  if (j.block !== 'day' || j.win_start == null) return null;
  // still « flexible » (its window maybe fixed by the evening lock, the customer not told yet): the 5-argument move of live
  // keeps the window AND « flexible »; the exact move would make it a fixed window nobody texts (main 7118fb07, review F4)
  if (j.win_flex) return null;
  if (j.arrive_at != null) return j.arrive_at;
  if (j.eta_min == null) return null;
  const w = windowOf(j.eta_min);
  return w[0] === j.win_start && (j.win_end == null || w[1] === j.win_end) ? j.eta_min : null;
}

/** « Changer de camion » with the real roads on and the time kept (A1): what the exact preview says of one truck, in the
    shape of the sheet's other answers: it keeps that time (`eta` = it), or somebody would then be late (`late`: how many),
    or it cannot be there then (`why` arrive_late, `earliest`), or another refusal (`why`), or not measured (`unmeasured`:
    no time said, S8). null: no exact answer (an older server): nothing said. */
export interface ExactFit { fits: boolean; eta: number | null; unmeasured: boolean; why?: string; earliest?: number | null; late?: number }
export function exactFitOf(a: ExactAnswer | null, jobId: string, at: number): ExactFit | null {
  const c = exactCase(a, jobId);
  if (!a && c.kind === 'unsure') return null;
  if (c.kind === 'early') return { fits: false, eta: null, unmeasured: false, why: ARRIVE_LATE, earliest: c.earliest };
  if (c.kind === 'refused') return { fits: false, eta: null, unmeasured: false, why: c.code };
  if (c.kind === 'unsure') return c.why === 'unmeasured' ? { fits: true, eta: null, unmeasured: true } : null;
  if (c.kind === 'late') return { fits: true, eta: at, unmeasured: false, late: c.late.length + (c.overHours > 0 ? 1 : 0) };
  return { fits: true, eta: at, unmeasured: false };
}
