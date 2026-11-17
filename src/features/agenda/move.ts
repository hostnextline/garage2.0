/* Moving a booked job from the agenda: dropped on another block (the week), on a time of the grid, or on a day and a
   window picked in the sheet (MoveWindowSheet). One flow for all three: « garde-route » (too much road that day),
   the question in words, move_job (the server checks the room and re-plans), then the customer's text when what they
   were told changed (moveRules.ts). A move kept on the phone texts once the server has it. */
import { signal } from '@preact/signals';
import { moveJob, suggestBlocks, suggestWindows, errorMessage, type Suggestion } from '../../data/api';
import { customer as customerRow, job as jobRow, settings, windowOf } from '../../data/select';
import { outboxList, whenDone } from '../../data/sync';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { today, type BlockKey, type Day } from '../../lib/dates';
import { ask, toast } from '../../ui';
import { windowPhrase } from '../../domain/moment/words';
import { farInfo, farLimits, farQuestion, momentsByKey } from '../../domain/moment/logic';
import { notifyCustomer, wantsText } from '../../shared/moment/notify';
import { jobPerson } from '../../domain/jobs/words';
import { moveQuestion, winShort } from './layout';
import { moveOutcome, textAfterMove, toldChanged, dropTruck, dropTells, type MoveOutcome } from '../../domain/moment/moveRules';

/** the job waiting for its new window (the sheet is open), or null. Only its id: the sheet reads the live row.
    `farDone`: the « garde-route » question was already asked for that day (a drop on the time grid that did not fit):
    the sheet does not ask it a second time. */
export const windowMove = signal<{ jobId: string; day: Day; farDone?: true } | null>(null);
/** the jobs whose move waits on this phone for the network: not dragged again meanwhile (a second, a third move would
    be queued behind it) */
export const movesWaiting = signal<ReadonlySet<string>>(new Set());
function waiting(id: string, on: boolean) {
  const next = new Set(movesWaiting.value);
  if (on) next.add(id); else next.delete(id);
  movesWaiting.value = next;
}

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
function farAsked(j: Job, day: Day, block: BlockKey): Promise<FarAsk> {
  const c = customerRow(j.customer_id);
  const lat = j.lat ?? c?.lat ?? null, lng = j.lng ?? c?.lng ?? null;
  if (lat == null || lng == null) return Promise.resolve(null);
  const need = !!j.needs_machine;
  return suggestBlocks(lat, lng, j.duration_min, day, 1, j.id, need, need ? null : j.vehicle_kind ?? null)
    .then((list) => farQuestion(farInfo(momentsByKey(list).get(`${day}|${block}`), farLimits(settings.value.booking), lang.value), { day, block }, 'move'))
    .catch(() => null);
}
/** the answer, or null when it does not come within a few seconds */
const farWait = (asked: Promise<FarAsk>): Promise<FarAsk> => Promise.race([asked, new Promise<null>((r) => setTimeout(() => r(null), FAR_WAIT_MS))]);
/** the question to ask when the place puts too much road in the truck's day (null: nothing to ask). Asked of the
    server while the person reads the first question; with no answer in a few seconds (no signal, slow), the move goes
    on as before: the server refuses nothing on that ground. */
function farCheck(j: Job, day: Day, block: BlockKey): Promise<FarAsk> { return farWait(farAsked(j, day, block)); }

/* ---------- the move itself ---------- */
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
/** does the « moved » text go? move_job's own `tell` (« what the customer was told is no longer true »: day, block or
    window, read on the server's row) decides when the answer has it (R85); a server without it (the live one before
    the rebuild) leaves it to the rows, as before (textAfterMove) */
function textGoes(o: MoveOutcome, data: unknown, before: Job, after: Job | null | undefined, wanted: boolean): boolean {
  if (!wanted || o.kind !== 'moved') return false;
  const tell = data && typeof data === 'object' ? (data as { tell?: unknown }).tell : undefined;
  if (typeof tell === 'boolean') return tell;
  return textAfterMove(o, before, after, wanted);
}
/** the customer's text once a move kept on the phone reaches the server (it may answer that nothing changed, or refuse:
    then nothing goes, the frame lists the refusal) */
async function textWhenSent(before: Job) {
  try {
    const s = await moveSettled(before.id);
    if (s.kind === 'gone') {
      // already sent meanwhile: the phone's row is what the server wrote
      const after = jobRow(before.id);
      if (after && toldChanged(before, after)) void notifyCustomer('moved', before.id);
    } else if (s.kind === 'done') {
      const o = moveOutcome({ queued: false, data: s.data }, before.id);
      if (textGoes(o, s.data, before, o.kind === 'moved' ? o.after ?? jobRow(before.id) : null, true)) void notifyCustomer('moved', before.id);
    }
    // refused: the frame's « refusé » list says so, and the customer has nothing new to hear
  } catch { /* the text could not be sent: the job sheet still offers it */ } finally {
    waiting(before.id, false);
  }
}
type Sent = { ok: true } | { ok: false; error: unknown };
/** move_job, then what to say: kept on the phone (the text follows once sent), nothing to change, or moved (and the
    text when what the customer was told changed). A refusal is given back to the caller, which says it. */
async function send(j: Job, call: () => Promise<{ queued: boolean; data?: unknown }>): Promise<Sent> {
  const sms = wantsText('moved', j.id);
  let r: { queued: boolean; data?: unknown };
  try { r = await call(); } catch (error) { return { ok: false, error }; }
  const o = moveOutcome(r, j.id);
  if (o.kind === 'queued') {
    toast(sms ? `${t('shell.queued')} ${t('agenda.move.textLater')}` : t('shell.queued'));
    waiting(j.id, true);
    if (sms) void textWhenSent(j); else void waitOnly(j.id);
  } else if (o.kind === 'unchanged') {
    toast(t('agenda.move.unchanged'));
  } else {
    toast(t('agenda.move.done'), { kind: 'ok' });
    if (textGoes(o, r.data, j, o.after ?? jobRow(j.id), sms)) void notifyCustomer('moved', j.id);
  }
  return { ok: true };
}
/** no text to send: only the « waiting » mark, cleared once the move leaves the phone */
async function waitOnly(id: string) {
  try { await moveSettled(id); } finally { waiting(id, false); }
}

/** moves to a day with the window chosen (or flexible), texts; true when the sheet can close (moved, nothing to
    change, or kept on the phone) */
export async function moveToWindow(j: Job, day: Day, win: { start: number } | { flex: true }, farAsk?: Promise<FarAsk> | null): Promise<boolean> {
  // `farAsk`: the « garde-route » question asked when the sheet opened (null: already asked before the sheet opened);
  // not given: asked now
  const far = farAsk === undefined ? await farCheck(j, day, 'day') : farAsk && await farWait(farAsk);
  if (far && !(await ask(far))) return false;
  const r = await send(j, () => moveJob(j.id, day, 'day', null, win));
  if (!r.ok) toast(errorMessage(r.error), { kind: 'bad' });
  return r.ok;
}

/** asks, moves, texts; true when the job moved (a day of windows: opens the sheet of windows, which does the move) */
export async function moveFlow(j: Job, to: { day: Day; block: BlockKey }): Promise<boolean> {
  if (to.block === 'day') { windowMove.value = { jobId: j.id, day: to.day }; return false; }
  const name = jobPerson(j);
  const sms = wantsText('moved', j.id);
  const far = farCheck(j, to.day, to.block);
  const ok = await ask({
    title: moveQuestion(name, { day: j.day, block: j.block }, to, today(), lang.value),
    text: [t('agenda.move.text'), sms ? t('agenda.move.textSms', { name: name || t('agenda.move.someone') }) : ''].filter(Boolean).join(' '),
    ok: t('agenda.move.ok')
  });
  if (!ok) return false;
  const farAsk = await far;
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
/** is the job already there? (the same day, the same window, and no other truck asked: nothing to move, the exact
    arrival is the planner's) */
export function sameWindowPlace(j: Pick<Job, 'day' | 'block' | 'win_start' | 'truck_id'>, to: { day: Day; truck: string | null; start: number }): boolean {
  return j.block === 'day' && j.day === to.day && j.win_start === to.start && (to.truck == null || to.truck === j.truck_id);
}
/** a booked job let go on a unit of the grid: asks, then moves it to that day with the window that goes with that
    arrival time (on the column's truck when it is another one: dropTruck), texts when the customer has something new
    to hear. When the server answers that it does not fit there, the sheet of the windows still possible that day
    opens. True when the job moved. */
export async function moveToTime(j: Job, day: Day, column: string | null, minute: number): Promise<boolean> {
  const l = lang.value;
  const win = windowOf(minute);
  const name = jobPerson(j);
  const who = name || t('agenda.move.someone');
  if (sameWindowPlace(j, { day, truck: column, start: win[0] })) {
    toast(t('agenda.move.sameWin', { name: who.charAt(0).toUpperCase() + who.slice(1), win: winShort(win, l) }));
    return false;
  }
  const sms = wantsText('moved', j.id) && dropTells(j, day, win[0]);
  const when = windowPhrase(day, win, today(), l);
  const far = farCheck(j, day, 'day');
  const ok = await ask({
    title: t('agenda.move.timeQuestion', { name: who, when: l === 'en' && !/^(Today|Tomorrow|Yesterday)\b/.test(when) ? when : when.charAt(0).toLowerCase() + when.slice(1) }),
    text: [t('agenda.move.timeText'), sms ? t('agenda.move.textSms', { name: who }) : ''].filter(Boolean).join(' '),
    ok: t('agenda.move.ok')
  });
  if (!ok) return false;
  const farAsk = await far;
  if (farAsk && !(await ask(farAsk))) return false;
  const r = await send(j, () => moveJob(j.id, day, 'day', dropTruck(j, column), { start: win[0] }));
  if (r.ok) return true;
  if (FULL_CODES.includes(refusalCode(r.error))) {
    toast(t('agenda.move.timeFull'));
    windowMove.value = { jobId: j.id, day, farDone: true };
  } else toast(errorMessage(r.error), { kind: 'bad' });
  return false;
}
