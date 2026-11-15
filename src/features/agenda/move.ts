/* Moving a booked job to another block (drag and drop on the week): the question in words, the move (the server
   checks the room and re-plans both blocks), then the customer's text when the garage sends one for a change.
   « Plages d'arrivée »: the job is dropped on a DAY; a sheet (MoveWindowSheet) then offers the windows still possible
   that day, the best first, and « Flexible »; the choice is the move. */
import { signal } from '@preact/signals';
import { moveJob, suggestWindows, type Suggestion } from '../../data/api';
import { customer as customerRow, customerName } from '../../data/select';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { today, type BlockKey, type Day } from '../../lib/dates';
import { ask, run } from '../../ui';
import { moveQuestion } from './layout';
import { notifyCustomer, wantsText } from '../booking/notify';
import { forgetRefusal, noLongWaitOffline } from '../booking/outbox';

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
