/* « Réserver à l'heure choisie » (Part 30, Hassan 2026-11-22: « if i forcefully book someone at a specific time, i want the
   system to show a warning if there is no place but still let me book it, then show me the new map »; STATE.md K1, K2).
   What the app sends to book an appointment AT the minute pointed, and how it reads the server's answers. Every name the
   server chose is HERE and only here (20261122000300_reserver_heure.sql):
   - the booking: book_job's p_job gains `arrive_at` (the minute) and `late_ok` (the appointments the person accepted late
     after the warning; the new appointment's own id accepts the truck past its hours); `truck_id` as before;
   - the preview: book_preview(p_job, p_items), nothing written, no job number spent;
   - the answer of both: the exact move's (exact, stops [...], over_hours, earliest, earliest_keep: src/data/exact.ts) +
     truck_id (the vehicle that takes it), forced (somebody late, or past the hours), may_force (the preview: owner or
     office), win_start / win_end (the window of that minute), at;
   - the refusals: the exact move's (arrive_late with the earliest minutes, late_changed), pick_truck, not_allowed.
   Tested in bookAt.test.ts (the server pretended). */
import { callRpc } from './sync';
import { exactAnswer, type ExactAnswer } from './exact';
import type { BookInput, ItemInput } from './api';

/** what book_job / book_preview answer for a booking at a minute */
export interface BookAtAnswer extends ExactAnswer {
  /** the vehicle that takes it (the one asked, else the one the server chose: nobody late first, the car first) */
  truckId: string | null;
  /** somebody would be late (or the truck past its hours): booking it is « Réserver quand même » */
  forced: boolean;
  /** the person may force it (owner, office); null: the server did not say (the booking's own answer) */
  mayForce: boolean | null;
  /** the window of that minute, told to the customer */
  winStart: number | null; winEnd: number | null;
  at: number | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** the answer, every key with its type. null: not an answer of a booking at a minute (an older server, blocks mode) */
export function bookAtAnswer(raw: unknown): BookAtAnswer | null {
  const a = exactAnswer(raw);
  // « { ok, exact: false } »: blocks mode, or no minute: nothing to say (the booking of before)
  if (!a || (!a.exact && !a.refused)) return null;
  const r = raw as Record<string, unknown>;
  const late = a.stops.some((s) => s.late) || a.overHours > 0;
  return {
    ...a,
    truckId: typeof r.truck_id === 'string' && r.truck_id ? r.truck_id : null,
    forced: typeof r.forced === 'boolean' ? r.forced : late,
    mayForce: typeof r.may_force === 'boolean' ? r.may_force : null,
    winStart: num(r.win_start), winEnd: num(r.win_end), at: num(r.at)
  };
}

/** p_job of a booking at that minute: the minute, the vehicle, the ones accepted late (never `force`, never a window to
    keep: the minute decides) */
export function bookAtJob(job: BookInput, at: number, truckId: string | null, lateOk: readonly string[] = []): BookInput {
  const { force: _f, win_flex: _x, ...rest } = job;
  return { ...rest, truck_id: truckId, arrive_at: at, late_ok: [...lateOk] };
}

/** what that booking would do, nothing written. null: the server gave no such preview (an older one, blocks mode). Throws
    the booking's refusal (exactRefusal reads it), or no signal. Its rows are never applied (there are none) */
export async function bookPreview(job: BookInput, items: ItemInput[]): Promise<BookAtAnswer | null> {
  const d = (await callRpc<unknown>('book_preview', { p_job: job, p_items: items }, { noOp: true, apply: false })).data;
  return bookAtAnswer(d);
}
