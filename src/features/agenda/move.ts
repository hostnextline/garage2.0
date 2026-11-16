/* Moving a booked job to another block (drag and drop on the week): the question in words, the move (the server
   checks the room and re-plans both blocks), then the customer's text when the garage sends one for a change.
   « Plages d'arrivée »: the job is dropped on a DAY; a sheet (MoveWindowSheet) then offers the windows still possible
   that day, the best first, and « Flexible »; the choice is the move. */
import { signal } from '@preact/signals';
import { moveJob, suggestWindows, errorMessage, type Suggestion } from '../../data/api';
import { customer as customerRow, customerName, windowOf } from '../../data/select';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { today, type BlockKey, type Day } from '../../lib/dates';
import { ask, run, toast } from '../../ui';
import { moveQuestion, winShort } from './layout';
import { windowPhrase } from '../../domain/moment/words';
import { notifyCustomer, wantsText } from '../booking/notify';
import { forgetRefusal, noLongWaitOffline } from '../../domain/moment/outbox';

export function jobPerson(j: Pick<Job, 'customer_id'>): string {
  const c = customerRow(j.customer_id);
  return c ? (c.first_name || c.company || customerName(c)) : '';
}

/** the job waiting for its new window (the sheet is open), or null */
export const windowMove = signal<{ job: Job; day: Day } | null>(null);
/** the windows still possible for this job on that day, the best first (the job's own place left out of the count) */
export function windowsFor(j: Job, day: Day): Promise<Suggestion[]> {
  const c = customerRow(j.customer_id);
  const need = !!j.needs_machine;
  return suggestWindows(j.lat ?? c?.lat ?? null, j.lng ?? c?.lng ?? null, j.duration_min, day, j.id, need, need ? null : j.vehicle_kind ?? null);
}
/** moves to a day with the window chosen (or flexible), texts; true when the job moved */
export async function moveToWindow(j: Job, day: Day, win: { start: number } | { flex: true }): Promise<boolean> {
  const sms = wantsText('moved', j.id);
  const r = await run(() => noLongWaitOffline(moveJob(j.id, day, 'day', null, win)), { ok: t('agenda.move.done') });
  if (!r) {
    void forgetRefusal('move_job', (a) => a.p_job === j.id);
    return false;
  }
  if (!r.queued && sms && (r.data as { changed?: boolean } | undefined)?.changed !== false) void notifyCustomer('moved', j.id);
  return true;
}

/** asks, moves, texts; true when the job moved (a day of windows: opens the sheet of windows, which does the move) */
export async function moveFlow(j: Job, to: { day: Day; block: BlockKey }): Promise<boolean> {
  if (to.block === 'day') { windowMove.value = { job: j, day: to.day }; return false; }
  const name = jobPerson(j);
  const sms = wantsText('moved', j.id);
  const ok = await ask({
    title: moveQuestion(name, { day: j.day, block: j.block }, to, today(), lang.value),
    text: [t('agenda.move.text'), sms ? t('agenda.move.textSms', { name: name || t('agenda.move.someone') }) : ''].filter(Boolean).join(' '),
    ok: t('agenda.move.ok')
  });
  if (!ok) return false;
  const r = await run(() => noLongWaitOffline(moveJob(j.id, to.day, to.block)), { ok: t('agenda.move.done') });
  if (!r) {
    // the refusal was just shown: no need to keep it in the frame's list too
    void forgetRefusal('move_job', (a) => a.p_job === j.id);
    return false;
  }
  if (!r.queued && sms && (r.data as { changed?: boolean } | undefined)?.changed !== false) void notifyCustomer('moved', j.id);
  return true;
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
    arrival time (on that truck when the column is a truck's; null: the app chooses), texts. When the server answers
    that it does not fit there, the sheet of the windows still possible that day opens. True when the job moved. */
export async function moveToTime(j: Job, day: Day, truckId: string | null, minute: number): Promise<boolean> {
  const l = lang.value;
  const win = windowOf(minute);
  const name = jobPerson(j);
  const who = name || t('agenda.move.someone');
  if (sameWindowPlace(j, { day, truck: truckId, start: win[0] })) {
    toast(t('agenda.move.sameWin', { name: who.charAt(0).toUpperCase() + who.slice(1), win: winShort(win, l) }));
    return false;
  }
  const sms = wantsText('moved', j.id);
  const when = windowPhrase(day, win, today(), l);
  const ok = await ask({
    title: t('agenda.move.timeQuestion', { name: who, when: l === 'en' && !/^(Today|Tomorrow|Yesterday)\b/.test(when) ? when : when.charAt(0).toLowerCase() + when.slice(1) }),
    text: [t('agenda.move.timeText'), sms ? t('agenda.move.textSms', { name: who }) : ''].filter(Boolean).join(' '),
    ok: t('agenda.move.ok')
  });
  if (!ok) return false;
  try {
    const r = await noLongWaitOffline(moveJob(j.id, day, 'day', truckId, { start: win[0] }));
    if (r.queued) toast(t('shell.queued'));
    else toast(t('agenda.move.done'), { kind: 'ok' });
    if (!r.queued && sms && (r.data as { changed?: boolean } | undefined)?.changed !== false) void notifyCustomer('moved', j.id);
    return true;
  } catch (e) {
    void forgetRefusal('move_job', (a) => a.p_job === j.id);
    if (FULL_CODES.includes(refusalCode(e))) {
      toast(t('agenda.move.timeFull'));
      windowMove.value = { job: j, day };
    } else toast(errorMessage(e), { kind: 'bad' });
    return false;
  }
}
