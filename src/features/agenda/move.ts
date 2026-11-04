/* Moving a booked job to another block (drag and drop on the week): the question in words, the move (the server
   checks the room and re-plans both blocks), then the customer's text when the garage sends one for a change. */
import { moveJob } from '../../data/api';
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

/** asks, moves, texts; true when the job moved */
export async function moveFlow(j: Job, to: { day: Day; block: BlockKey }): Promise<boolean> {
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
