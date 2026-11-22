/* Moving a booked job from the agenda: dropped on another block (the week), on a time of the grid, or on a day and a
   window picked in the sheet (MoveWindowSheet). One flow for all three: « garde-route » (too much road that day),
   the question in words, move_job (the server checks the room and re-plans), then, when what the customer was told
   changed (moveRules.ts), the question « Texter … ? » (shared/jobs/textAsk: Hassan, 2026-11-22, nothing goes by itself).
   A move kept on the phone asks it once the server has it. A move that asks nothing (nothing new for the customer, no
   cell, « Rendez-vous changé » off) shows instead, when the day the customer was TOLD is today and the move changed it,
   the toast of that day's « Envoyer les heures aux clients » (Part 28: textAsk's toldDayAfter).
   « exact move » (Hassan, 2026-11-21: « move exactly where I point, the rest stays the same »; STATE.md A1–A5): a time
   pointed (a unit of the grid, a window row that showed its arrival) goes through the one flow of shared/jobs/exactMove
   (the preview, ONE question, « garde-route », the move to that very minute, never kept on the phone); the block dropped
   on the grid stays where it was let go meanwhile (`landings`, drawn by TimeGrid) and the server's rows then leave it
   there. A block of the week, « Flexible » and a window row without an arrival move as before. */
import { signal } from '@preact/signals';
import { moveJob, suggestBlocks, suggestWindows, errorMessage, type Suggestion } from '../../data/api';
import { PICK_TRUCK } from '../../data/exact';
import { customer as customerRow, job as jobRow, settings, windowOf, roadsOn, daySpan } from '../../data/select';
import { WARM_MS } from '../../data/roads';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { today, clock, type BlockKey, type Day } from '../../lib/dates';
import { ask, toast } from '../../ui';
import { farInfo, farLimits, farQuestion, momentsByKey } from '../../domain/moment/logic';
import { wantsText } from '../../shared/moment/notify';
import { askMovedText, toldDayAfter } from '../../shared/jobs/textAsk';
import { jobPerson } from '../../domain/jobs/words';
import { moveQuestion } from './layout';
import { moveOutcome, textAfterMove, toldChanged, dropTruck, dropTells, type MoveOutcome } from '../../domain/moment/moveRules';
import { movesWaiting, setWaiting as waiting, moveSettled } from '../../shared/jobs/moving';
import { moveAt, doneWords, type ExactDone } from '../../shared/jobs/exactMove';
import { windowRowAt } from '../../domain/moment/exactAt';

/* the moves kept on the phone and their end: shared with the lists of a truck's stops (shared/jobs/moving.ts), read
   from here by the agenda as before */
export { movesWaiting, moveSettled };
export type { Settled } from '../../shared/jobs/moving';

/** the job waiting for its new window (the sheet is open), or null. Only its id: the sheet reads the live row.
    `farDone`: the « garde-route » question was already asked for that day (a drop on the time grid that did not fit):
    the sheet does not ask it a second time. */
export const windowMove = signal<{ jobId: string; day: Day; farDone?: true } | null>(null);
/** the windows still possible for this job on that day, the best first (the job's own place left out of the count) */
export function windowsFor(j: Job, day: Day): Promise<Suggestion[]> {
  const c = customerRow(j.customer_id);
  const need = !!j.needs_machine;
  return suggestWindows(j.lat ?? c?.lat ?? null, j.lng ?? c?.lng ?? null, j.duration_min, day, j.id, need, need ? null : j.vehicle_kind ?? null);
}

/* ---------- « garde-route » ---------- */
const FAR_WAIT_MS = 3000;
export type FarAsk = ReturnType<typeof farQuestion>;
/** the « garde-route » question for a day of windows, asked of the server as soon as the sheet of windows opens (so a
    pick does not start the wait); never rejects (no answer: no warning, the same as an older server, which sends no
    score). The few seconds' wait starts at the pick (moveToWindow). */
export function farCheckDay(j: Job, day: Day): Promise<FarAsk> { return farAsked(j, day, 'day'); }
/** when each question was asked of the server (« Vraies routes »: its wait also counts the address's measure) */
const askedAt = new WeakMap<Promise<FarAsk>, number>();
function farAsked(j: Job, day: Day, block: BlockKey): Promise<FarAsk> {
  const c = customerRow(j.customer_id);
  const lat = j.lat ?? c?.lat ?? null, lng = j.lng ?? c?.lng ?? null;
  if (lat == null || lng == null) return Promise.resolve(null);
  const need = !!j.needs_machine;
  const p = suggestBlocks(lat, lng, j.duration_min, day, 1, j.id, need, need ? null : j.vehicle_kind ?? null)
    .then((list) => farQuestion(farInfo(momentsByKey(list).get(`${day}|${block}`), farLimits(settings.value.booking), lang.value), { day, block }, 'move'))
    .catch(() => null);
  askedAt.set(p, Date.now());
  return p;
}
/** the answer, or null when it does not come within a few seconds. The wait starts NOW (after the person answered the
    first question, never before it: request-flows risk 2, review-moments H4). « Vraies routes » on: the address is
    measured before the planner is asked (up to WARM_MS from the ask), so the planner still gets its few seconds after
    that wait: the question never vanishes because the measure took most of them. */
function farWait(asked: Promise<FarAsk>): Promise<FarAsk> {
  const now = Date.now();
  const at = askedAt.get(asked);
  const until = Math.max(now + FAR_WAIT_MS, roadsOn.peek() && at != null ? at + WARM_MS + FAR_WAIT_MS : 0);
  let tm: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([asked, new Promise<null>((r) => { tm = setTimeout(() => r(null), until - now); })]).finally(() => clearTimeout(tm));
}
/** the question to ask when the place puts too much road in the truck's day (null: nothing to ask), asked now; with no
    answer in a few seconds (no signal, slow), the move goes on as before: the server refuses nothing on that ground. */
function farCheck(j: Job, day: Day, block: BlockKey): Promise<FarAsk> { return farWait(farAsked(j, day, block)); }

/* ---------- the move itself ---------- */
/* (« Settled » and moveSettled, the end of a move kept on the phone: shared/jobs/moving.ts, re-exported above) */
/** does the « moved » text go? move_job's own `tell` (« what the customer was told is no longer true »: day, block or
    window, read on the server's row) decides when the answer has it (R85); a server without it (the live one before
    the rebuild) leaves it to the rows, as before (textAfterMove) */
function textGoes(o: MoveOutcome, data: unknown, before: Job, after: Job | null | undefined, wanted: boolean): boolean {
  if (!wanted || o.kind !== 'moved') return false;
  const tell = data && typeof data === 'object' ? (data as { tell?: unknown }).tell : undefined;
  if (typeof tell === 'boolean') return tell;
  return textAfterMove(o, before, after, wanted);
}
/** the question « Texter … ? » once a move kept on the phone reaches the server (it may answer that nothing changed, or
    refuse: then nothing is asked, the frame lists the refusal) */
async function textWhenSent(before: Job) {
  try {
    const s = await moveSettled(before.id);
    if (s.kind === 'gone') {
      // already sent meanwhile: the phone's row is what the server wrote
      const after = jobRow(before.id);
      if (!(after && toldChanged(before, after) && askMovedText(before, { via: 'notify' }))) toldDayAfter(before);
    } else if (s.kind === 'done') {
      const o = moveOutcome({ queued: false, data: s.data }, before.id);
      const asked = textGoes(o, s.data, before, o.kind === 'moved' ? o.after ?? jobRow(before.id) : null, true)
        && askMovedText(before, { via: 'notify', after: o.kind === 'moved' ? o.after : null });
      if (!asked && o.kind === 'moved') toldDayAfter(before);
    }
    // refused: the frame's « refusé » list says so, and the customer has nothing new to hear
  } catch { /* nothing asked: the job sheet still offers the text */ } finally {
    waiting(before.id, false);
  }
}
type Sent = { ok: true } | { ok: false; error: unknown };
/** move_job, then what to say: kept on the phone (the question follows once sent), nothing to change, or moved (and the
    question « Texter … ? » when what the customer was told changed). A refusal is given back to the caller, which says it. */
async function send(j: Job, call: () => Promise<{ queued: boolean; data?: unknown }>): Promise<Sent> {
  const sms = wantsText('moved', j.id);
  let r: { queued: boolean; data?: unknown };
  try { r = await call(); } catch (error) { return { ok: false, error }; }
  const o = moveOutcome(r, j.id);
  if (o.kind === 'queued') {
    toast(sms ? `${t('shell.queued')} ${t('agenda.move.textLater')}` : t('shell.queued'));
    waiting(j.id, true);
    if (sms) void textWhenSent(j); else void waitOnly(j);
  } else if (o.kind === 'unchanged') {
    toast(t('agenda.move.unchanged'));
  } else {
    toast(t('agenda.move.done'), { kind: 'ok' });
    // nothing asked: the toast of the day he was told (when that day is today and the move changed it)
    if (!(textGoes(o, r.data, j, o.after ?? jobRow(j.id), sms) && askMovedText(j, { via: 'notify', after: o.after }))) toldDayAfter(j);
  }
  return { ok: true };
}
/** no text to ask about: only the « waiting » mark, cleared once the move leaves the phone; once it moved, the toast of
    the day he was told (when that day is today and the move changed it) */
async function waitOnly(j: Job) {
  try {
    const s = await moveSettled(j.id);
    if (s.kind === 'gone' || (s.kind === 'done' && moveOutcome({ queued: false, data: s.data }, j.id).kind === 'moved')) toldDayAfter(j);
  } catch { /* refused or lost: the frame says it, nothing more to show */ } finally { waiting(j.id, false); }
}

/** what an exact move gave, said: the message (the late customers named: A5), the question « Texter … ? » when what the
    customer was told changed (the server's `tell`), or the refusal (null: it is the caller's to say). True when it moved. */
function exactSaid(j: Job, day: Day, d: ExactDone, refused?: (e: unknown) => boolean): boolean {
  if (d.kind === 'stopped') return false;
  if (d.kind === 'refused') {
    if (!refused?.(d.error)) toast(errorMessage(d.error), { kind: 'bad' });
    return false;
  }
  const o = moveOutcome(d.r, j.id);
  if (o.kind === 'unchanged') { toast(t('agenda.move.unchanged')); return true; }
  toast(doneWords(d, day), { kind: 'ok', ...(d.late.length || d.real != null ? { ms: 8000 } : {}) });
  if (o.kind === 'moved' && !(textGoes(o, d.r.data, j, o.after ?? jobRow(j.id), wantsText('moved', j.id)) && askMovedText(j, { via: 'notify', after: o.after }))) toldDayAfter(j);
  return true;
}

/** moves to a day with the window chosen (or flexible), then asks « Texter … ? »; true when the sheet can close (moved, nothing to
    change, or kept on the phone). A row that showed its arrival (`at`, A1) goes there exactly, through the one flow
    (its own truck; `truck`: the vehicle the server offered for that window, taken only when its own does not work) */
export async function moveToWindow(j: Job, day: Day, win: { start: number; at?: number | null; truck?: string | null } | { flex: true }, farAsk?: Promise<FarAsk> | null): Promise<boolean> {
  // `farAsk`: the « garde-route » question asked when the sheet opened (null: already asked before the sheet opened);
  // not given: asked now
  // the minute sent gives the row's window (review F1: never another window told than the row tapped)
  const at = 'start' in win ? windowRowAt(win.start, win.at, daySpan.peek(), windowOf) : null;
  if ('start' in win && at != null) {
    const sms = wantsText('moved', j.id) && dropTells(j, day, windowOf(at)[0]);
    const d = await moveAt({ job: j, day, truck: null, at, confirm: false, sms, offered: win.truck ?? null,
      far: () => (farAsk === undefined ? farCheck(j, day, 'day') : farAsk ? farWait(farAsk) : Promise.resolve(null)) });
    return exactSaid(j, day, d);
  }
  const far = farAsk === undefined ? await farCheck(j, day, 'day') : farAsk && await farWait(farAsk);
  if (far && !(await ask(far))) return false;
  const r = await send(j, () => moveJob(j.id, day, 'day', null, 'flex' in win ? win : { start: win.start }));
  if (!r.ok) toast(errorMessage(r.error), { kind: 'bad' });
  return r.ok;
}

/** asks, moves, asks « Texter … ? »; true when the job moved (a day of windows: opens the sheet of windows, which does the move) */
export async function moveFlow(j: Job, to: { day: Day; block: BlockKey }): Promise<boolean> {
  if (to.block === 'day') { windowMove.value = { jobId: j.id, day: to.day }; return false; }
  const name = jobPerson(j);
  const sms = wantsText('moved', j.id);
  // asked of the server while the person reads the first question; its few seconds' wait starts after the answer
  const far = farAsked(j, to.day, to.block);
  const ok = await ask({
    title: moveQuestion(name, { day: j.day, block: j.block }, to, today(), lang.value),
    text: [t('agenda.move.text'), sms ? t('agenda.move.textSms', { name: name || t('agenda.move.someone') }) : ''].filter(Boolean).join(' '),
    ok: t('agenda.move.ok')
  });
  if (!ok) return false;
  const farAsk = await farWait(far);
  if (farAsk && !(await ask(farAsk))) return false;
  const r = await send(j, () => moveJob(j.id, to.day, to.block));
  if (!r.ok) toast(errorMessage(r.error), { kind: 'bad' });
  return r.ok;
}

/* ---------- the time grid: a job let go on a unit (a time of a day, maybe on a truck) ---------- */
/** the server's « it does not fit there » answers: the sheet of windows then offers what is still possible */
export const FULL_CODES = ['window_full', 'block_full', 'truck_full'];
/** the short code of a refusal (database: hint; server functions: code) */
export function refusalCode(e: unknown): string {
  const err = (e || {}) as { hint?: string; code?: string };
  return String(err.hint || err.code || '');
}
/** is the job already there? The same day, the same planned arrival (a new quarter hour inside the same window IS a
    move now: « exact move », A3) and no other truck asked */
export function samePlace(j: Pick<Job, 'day' | 'block' | 'eta_min' | 'truck_id'>, to: { day: Day; truck: string | null; at: number }): boolean {
  return j.block === 'day' && j.day === to.day && j.eta_min === to.at && (to.truck == null || to.truck === j.truck_id);
}
/** A3: the job let go on the grid, held where it was dropped through the question, the preview and the send (the grid
    draws it there and dims the job at its old place); gone once the server's rows are in (they put it at that very
    minute) or the move stopped. `column`: the column's truck (the day view), null (the week). One per job (review F2: a
    second job let go while the first one's move is still asked or sent, with no question on screen, must not let the
    first one go, nor make it draggable again): each held until ITS flow ends. */
export interface Landing { jobId: string; day: Day; column: string | null; minute: number; duration: number }
export const landings = signal<ReadonlyMap<string, Landing>>(new Map());
/** the job held where it was let go (null: not held) */
export const landingOf = (jobId: string): Landing | null => landings.value.get(jobId) ?? null;
function hold(h: Landing) { const m = new Map(landings.peek()); m.set(h.jobId, h); landings.value = m; }
/** lets the job go, only when it is still held by this flow (`h`: the very landing it put there) */
function letGo(h: Landing) {
  if (landings.peek().get(h.jobId) !== h) return;
  const m = new Map(landings.peek()); m.delete(h.jobId); landings.value = m;
}
/** a booked job let go on a unit of the grid: moved to arrive at THAT minute (« exact move »), on the column's truck
    (the day view; the week: its own), with ONE question (shared/jobs/exactMove: the preview first; somebody late, the
    truck cannot be there, not measured…), « garde-route », the move, the message (the late customers named) and the
    question « Texter … ? » when the window or the day changed. When the server answers that it does not fit there (or its
    truck does not work that day), the sheet of the windows still possible that day opens. True when the job moved. */
export async function moveToTime(j: Job, day: Day, column: string | null, minute: number): Promise<boolean> {
  const l = lang.value;
  const name = jobPerson(j);
  const who = name || t('agenda.move.someone');
  if (samePlace(j, { day, truck: column, at: minute })) {
    toast(t('agenda.move.sameTime', { name: who.charAt(0).toUpperCase() + who.slice(1), time: clock(minute, l) }));
    return false;
  }
  const sms = wantsText('moved', j.id) && dropTells(j, day, windowOf(minute)[0]);
  // asked of the server while the person reads the first question; its few seconds' wait starts after the answer
  const far = farAsked(j, day, 'day');
  let held: Landing = { jobId: j.id, day, column, minute, duration: j.duration_min };
  hold(held);
  try {
    const d = await moveAt({ job: j, day, truck: dropTruck(j, column), at: minute, confirm: true, sms, far: () => farWait(far),
      // « Mettre à … »: the held block goes to the minute the truck can keep
      onAt: (m) => { if (landings.peek().get(j.id) === held) { held = { ...held, minute: m }; hold(held); } } });
    return exactSaid(j, day, d, (e) => {
      const code = refusalCode(e);
      if (!FULL_CODES.includes(code) && code !== PICK_TRUCK) return false;
      toast(code === PICK_TRUCK ? errorMessage(e) : t('agenda.move.timeFull'));
      windowMove.value = { jobId: j.id, day, farDone: true };
      return true;
    });
  } finally {
    // the server's rows are in (or nothing moved): the block is drawn where it really is
    letGo(held);
  }
}
