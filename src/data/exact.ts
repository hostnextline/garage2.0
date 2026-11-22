/* « Un déplacement tombe exactement où on pointe » (Hassan, 2026-11-21; STATE.md « exact move », S2 to S5): what the app
   sends to move an appointment to the very minute pointed, and how it reads the server's answers. Every name the server
   chose is HERE and only here (a key renamed on the server is one line below):
   - the move: move_job's 8th argument `p_exact` = { at, late_ok } (src/data/api.ts moveJob builds it with exactArgs);
   - the preview: move_preview(p_job, p_day, p_truck, p_at), nothing written, « Vraies routes » on or off;
   - the answer of both (S3): exact, stops [{ id, day, truck_id, order_before, order_after, eta_before, eta_after,
     win_start, win_end, delay_min, late, late_min, measured }], over_hours, earliest, earliest_keep;
   - the refusals (S4): arrive_late (the truck cannot be there at that minute: the earliest it can), late_changed
     (somebody not accepted would now be late), pick_truck (its truck does not work that day).
   The preview may refuse by throwing (public.fail) or by answering the code: both are read (exactRefusal, exactAnswer).
   Tested in exact.test.ts (the server pretended). */
import { callRpc } from './sync';
import { classify } from '../lib/errors';

/* ---------- the names (S2, S5) ---------- */
/** move_job's 8th argument: the minute pointed and the appointments the person accepted late after the warning */
export function exactArgs(at: number, lateOk: readonly string[] = []): Record<string, unknown> {
  return { p_exact: { at, late_ok: [...lateOk] } };
}
/** move_preview's new form: this appointment to that day, on that truck (null: its own), arriving at that minute */
function previewArgs(jobId: string, day: string, truckId: string | null, at: number): Record<string, unknown> {
  return { p_job: jobId, p_day: day, p_truck: truckId, p_at: at };
}
/** the refusals of an exact move (S4), with their words in src/i18n errors */
export const ARRIVE_LATE = 'arrive_late';
export const LATE_CHANGED = 'late_changed';
export const PICK_TRUCK = 'pick_truck';

/* ---------- the answer (S3) ---------- */
/** one stop of a truck's day the move touches (the moved one included), before and after the move */
export interface ExactStop {
  id: string; day: string | null; truckId: string | null;
  orderBefore: number | null; orderAfter: number | null;
  etaBefore: number | null; etaAfter: number | null;
  winStart: number | null; winEnd: number | null;
  /** minutes later than before (0: unchanged) */
  delay: number;
  /** after the window told to the customer, and by how much */
  late: boolean; lateMin: number;
  /** « Vraies routes » on: every trip up to it is measured (false: its time counts a guess; null: the switch is off or
      the server did not say) */
  measured: boolean | null;
}
export interface ExactAnswer {
  /** the server placed it at the minute asked (false: blocks mode, the minute was not kept) */
  exact: boolean;
  stops: ExactStop[];
  /** minutes past the truck's hours (0: inside) */
  overHours: number;
  /** the earliest the truck can be there; the earliest without changing anybody's time */
  earliest: number | null; earliestKeep: number | null;
  /** a refusal the preview answered instead of throwing it (arrive_late, pick_truck…) */
  refused: string | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const CODE = /^[a-z][a-z0-9_]{1,39}$/;
const codeOf = (x: unknown): string | null => (typeof x === 'string' && CODE.test(x) ? x : null);

function stopOf(raw: unknown): ExactStop | null {
  const s = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!s || typeof s.id !== 'string') return null;
  const before = num(s.eta_before), after = num(s.eta_after);
  const delay = num(s.delay_min) ?? (before != null && after != null ? Math.max(0, after - before) : 0);
  const winEnd = num(s.win_end);
  const lateMin = num(s.late_min) ?? (after != null && winEnd != null ? Math.max(0, after - winEnd) : 0);
  return {
    id: s.id, day: str(s.day), truckId: str(s.truck_id),
    orderBefore: num(s.order_before), orderAfter: num(s.order_after),
    etaBefore: before, etaAfter: after, winStart: num(s.win_start), winEnd,
    delay: Math.max(0, delay), late: s.late === true, lateMin: Math.max(0, lateMin),
    measured: typeof s.measured === 'boolean' ? s.measured : null
  };
}

/** the answer of an exact move or of its preview, every key with its type (an older or a pretend server may leave some
    out). null: not an answer of the exact move at all (an older server, the demo without it) */
export function exactAnswer(raw: unknown): ExactAnswer | null {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!r) return null;
  // a refusal answered rather than thrown: { ok: false, code } or { refused: 'arrive_late' }
  const refused = codeOf(r.refused) ?? (r.ok === false ? codeOf(r.code) ?? codeOf(r.hint) ?? codeOf(r.error) : null);
  const hasStops = Array.isArray(r.stops);
  if (!hasStops && !refused && typeof r.exact !== 'boolean') return null;
  return {
    exact: r.exact === true,
    stops: (hasStops ? (r.stops as unknown[]) : []).map(stopOf).filter((x): x is ExactStop => !!x),
    overHours: Math.max(0, num(r.over_hours) ?? 0),
    earliest: num(r.earliest), earliestKeep: num(r.earliest_keep),
    refused
  };
}

/** a refusal thrown by move_job or move_preview: its code and, when the server put them in the refusal's details (JSON),
    the earliest minutes. Not a refusal (no signal…): null */
export function exactRefusal(e: unknown): { code: string; earliest: number | null; earliestKeep: number | null } | null {
  const c = classify(e);
  if (c.kind === 'network' || c.kind === 'auth') return null;
  const err = (e || {}) as { hint?: unknown; code?: unknown; details?: unknown };
  const code = codeOf(err.hint) ?? codeOf(err.code);
  if (!code) return null;
  let d: Record<string, unknown> = {};
  const raw = err.details;
  if (raw && typeof raw === 'object') d = raw as Record<string, unknown>;
  else if (typeof raw === 'string' && raw.trim().startsWith('{')) { try { d = JSON.parse(raw) as Record<string, unknown>; } catch { d = {}; } }
  return { code, earliest: num(d.earliest), earliestKeep: num(d.earliest_keep) };
}

/** what this exact move would do, nothing written (S5). null: the server gave no such preview (an older one). Throws the
    move's refusal (exactRefusal reads it), or no signal. The answer is « what move_job answers » (S3), its `rows` too:
    those are the TRIAL's rows (newer updated_at than the real ones), so they are never applied to the phone (review F0:
    a preview moved the appointment on the phone and kept it moved) */
export async function exactPreview(jobId: string, day: string, truckId: string | null, at: number): Promise<ExactAnswer | null> {
  const d = (await callRpc<unknown>('move_preview', previewArgs(jobId, day, truckId, at), { noOp: true, apply: false })).data;
  return exactAnswer(d);
}
