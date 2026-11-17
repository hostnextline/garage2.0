/* When a text to the customer is due, and what the job sheet says about texts that did not go. Pure (tested in
   texts.test.ts). */
import type { Job, JobItem, JobStatus, Message } from '../../data/types';

/** what a text to the customer tells them, as far as the phone knows (jobs-r2-1): the day, the block and the arrival
    window, with the estimate's total, for the confirmation and « moved »; the work proposed for « extras »; the amount for
    « arrived ». A send kept for its retry after a lost answer is the same send only while this stays the same: moved to
    Tuesday then to Thursday, the customer is told Thursday, not given Tuesday's answer again. */
export function textSays(kind: string, j: Pick<Job, 'day' | 'block'> & { win_start?: number | null; win_end?: number | null; win_flex?: boolean | null },
  o: { items: Pick<JobItem, 'id' | 'status' | 'qty' | 'unit_cents'>[]; total: number }): string {
  if (kind === 'booking' || kind === 'moved') return [j.day, j.block, j.win_start ?? '', j.win_end ?? '', j.win_flex ? 'flex' : '', o.total].join('|');
  if (kind === 'extras') return o.items.filter((i) => i.status === 'proposed').map((i) => `${i.id}:${i.qty}:${i.unit_cents}`).sort().join(',');
  if (kind === 'arrived') return String(o.total);
  return '';
}

/** the invoice texted when the mechanic arrives: the switch is on, the customer takes texts, not the Coffre (no invoice),
    and some priced work (the server refuses an empty invoice, « La facture est vide », after making an empty draft) */
export function arrivalTextWanted(o: { on: boolean; coffre: boolean; phone: string | null | undefined; smsOk: boolean | null | undefined; total: number }): boolean {
  return o.on && !o.coffre && !!o.phone && o.smsOk !== false && o.total > 0;
}

export interface TextGapInput {
  status: JobStatus;
  /** may move this job forward */
  act: boolean;
  msgs: Pick<Message, 'kind'>[];
  /** a trip is live for this job */
  trip: boolean;
  /** the « en route » text went (or is going) from this phone */
  trackingSent: boolean;
  /** « Je pars » still waits on this phone: the job is not on the way for the server yet */
  leaveWaiting: boolean;
  /** the invoice is finished (issued or paid) */
  invoiceDone: boolean;
  /** the arrival text is due for this job (arrivalTextWanted, the customer's number aside: the banner says it) */
  arrivalOn: boolean;
}
/** the texts the customer has not received: the tracking link on the way, the invoice once there */
export function textGaps(o: TextGapInput): { noTracking: boolean; noInvoiceText: boolean } {
  const sent = (kind: string) => o.msgs.some((m) => m.kind === kind);
  return {
    // while « Je pars » waits, the server does not know the job left: a text now would make it leave a second time
    noTracking: o.act && o.status === 'en_route' && !o.trip && !o.trackingSent && !o.leaveWaiting && !sent('en_route'),
    noInvoiceText: o.act && o.status === 'on_site' && !o.invoiceDone && o.arrivalOn && !sent('arrived')
  };
}
