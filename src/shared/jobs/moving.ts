/* « Déplacer »: who may move an appointment now, and the moves kept on this phone for the network. One rule for every
   place that offers it (the agenda, the Carte, Vue d'ensemble, Aujourd'hui): booked, the « Réserver » right (move_job's
   own), and no move of it still waiting on the phone (a second one would be queued behind it: agenda-14). Moved here from
   the agenda (features/agenda/move.ts re-exports it) so that the lists of a truck's stops use the very same. */
import { signal } from '@preact/signals';
import { outboxList, whenDone, pendingOps } from '../../data/sync';
import type { Job } from '../../data/types';
import { jobRights } from '../../domain/jobs/rights';

/** the jobs whose move waits on this phone for the network: not moved again meanwhile (a second, a third move would
    be queued behind it) */
export const movesWaiting = signal<ReadonlySet<string>>(new Set());
export function setWaiting(id: string, on: boolean) {
  const next = new Set(movesWaiting.value);
  if (on) next.add(id); else next.delete(id);
  movesWaiting.value = next;
}

/** a move of this appointment still waits on this phone: marked by the screen that kept it, or still in the outbox
    (the appointment's own « Déplacer », which marks nothing, or a move kept before the app was closed and opened again).
    Reactive: a screen that reads it redraws when the outbox changes. */
export function moveWaiting(id: string): boolean {
  return movesWaiting.value.has(id) || pendingOps((e) => e.kind === 'rpc' && e.rpc === 'move_job' && e.args?.p_job === id).length > 0;
}

/** may this person move this appointment now (the agenda's rule: its menu, its drag) */
export function mayMove(j: Job | null | undefined): boolean {
  return !!j && j.status === 'booked' && jobRights(j).move && !moveWaiting(j.id);
}

/** the appointments moved from a list of stops on this phone a moment ago (id → when): the server's map of the day, up
    to 30 s old, does not keep them on the day they left (Vue d'ensemble). Only these: a stop the phone holds on another
    day for any other reason (its copy behind the server's) stays where the server says. */
const movedAt = new Map<string, number>();
export const MOVED_FRESH_MS = 60_000;
export function noteMoved(id: string, now = Date.now()) { movedAt.set(id, now); }
export function movedLately(id: string, now = Date.now()): boolean {
  const at = movedAt.get(id);
  if (at == null) return false;
  if (now - at < MOVED_FRESH_MS) return true;
  movedAt.delete(id);
  return false;
}

/** how a move kept on the phone ended: answered by the server (`done`, its answer), refused, or already gone from the
    outbox before anyone could wait for it (`gone`: the phone's row is then what the server wrote) */
export type Settled = { kind: 'done'; data: unknown } | { kind: 'refused' } | { kind: 'gone' };
const pendingMove = (list: { op: string; kind: string; rpc?: string; state?: string; args?: Record<string, unknown> }[], id: string) =>
  list.filter((e) => e.kind === 'rpc' && e.rpc === 'move_job' && e.state === 'pending' && e.args?.p_job === id).pop();
/** waits for the move of this job kept on the phone to leave it. The send may finish between reading the outbox and
    starting to wait (then the wait would never be answered): the outbox is read again once the wait is set, and an
    entry gone (sent) or refused meanwhile ends it at once. Never rejects: an unreadable outbox counts as « gone ». */
export async function moveSettled(id: string): Promise<Settled> {
  try {
    const entry = pendingMove(await outboxList(), id);
    if (!entry) return { kind: 'gone' };
    const answer = whenDone(entry.op).then((data): Settled => ({ kind: 'done', data }), (): Settled => ({ kind: 'refused' }));
    const again = (await outboxList()).find((e) => e.op === entry.op);
    if (!again) return { kind: 'gone' };
    if (again.state === 'failed') return { kind: 'refused' };
    return await answer;
  } catch {
    return { kind: 'gone' };
  }
}
/** a move kept on the phone: marked « waiting » until it leaves it (sent or refused) */
export async function waitForMove(id: string): Promise<void> {
  setWaiting(id, true);
  try { await moveSettled(id); } finally { setWaiting(id, false); }
}
