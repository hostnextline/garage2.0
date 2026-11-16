/* The words of a work line: its status, how the customer answered, its quantity. */
import type { JobItem } from '../../../data/types';
import { t, lang } from '../../../lib/i18n';
import { money } from '../../../lib/money';

/** « Accepté (par signature) »; an answer kept on the phone says so */
export function itemStatusText(i: Pick<JobItem, 'status' | 'answered_via'>, waiting = false): string {
  const status = t(`jobs.work.status.${i.status}`);
  const said = (i.status === 'approved' || i.status === 'declined') && i.answered_via ? t('jobs.work.statusVia', { status, via: t(`jobs.work.via.${i.answered_via}`) }) : status;
  return waiting ? t('jobs.work.answerWaiting', { status: said }) : said;
}
/** « 2 × 45,00 $ » when the quantity is not one ('' otherwise) */
export function qtyText(i: Pick<JobItem, 'qty' | 'unit_cents'>): string {
  const l = lang.value;
  return Number(i.qty) !== 1 ? t('jobs.work.qty', { qty: Number(i.qty).toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA'), price: money(Math.abs(i.unit_cents), l) }) : '';
}
