/* The one next action of a job (the red button), decided from the job, its work, its invoice and what the person may
   do. Pure: the job sheet and « Ma journée » ask the same question and get the same answer.

   booked    → Je pars (not before the day; not while this truck has an unpaid job on site: the server refuses it)
   en_route  → Je suis arrivé
   on_site   → the next missing piece, in order: the car's VIN (scanned, typed, or a car of the customer that has one), the
               signed authorization, the customer's answer to proposed work, some work to bill, the invoice, work on no line
               of the finished invoice (it must go on it, or be marked « Pas fait », first), the payment, then « Terminer la job »
   done      → nothing to press (the PAYÉ stamp; what is left to collect)
   cancelled, no_show → closed */
import type { Job, JobItem, Invoice } from '../../data/types';
import { BILLABLE, liveInvoice, draftIsStale, unbilledWork, billable } from './billing';

export { BILLABLE, draftIsStale };

export type StepKind =
  | 'leave' | 'arrive' | 'vin' | 'waiver' | 'answer' | 'work' | 'invoice' | 'unbilled' | 'pay' | 'finish'
  | 'blocked' | 'later' | 'done' | 'closed' | 'none';

export interface StepRights {
  /** may move this job forward: the owner, the booking right, or the job's own truck */
  act: boolean;
  /** may make this job's invoice and take its payment */
  invoice: boolean;
  /** may let the customer leave without paying (the owner, or the right to edit invoices) */
  payLater: boolean;
}
export interface StepContext {
  /** today, 'YYYY-MM-DD' */
  today: string;
  /** another job of this truck that is on site and not paid: leaving is refused until it is */
  blockedBy?: string | null;
  /** on site, and the job's car is not known by a VIN yet (vinStep.ts) */
  needVin?: boolean;
  /** payments of this job still waiting on this phone (no signal), in cents: they count against what is left to collect */
  paidWaiting?: number;
}
export interface NextStep {
  kind: StepKind;
  /** answer: the proposed work waiting for the customer; unbilled: the first line missing from the invoice */
  itemId?: string;
  /** blocked: the job to get paid first */
  jobId?: string;
  /** invoice: a draft exists already (finish it) */
  draft?: boolean;
  /** invoice: the work changed since the draft was made */
  stale?: boolean;
  /** pay: this person may also let the customer leave without paying */
  payLater?: boolean;
  /** finish: the customer will pay later (not paid yet) */
  later?: boolean;
  /** done: the invoice is paid; unbilled: the invoice missing the work is already paid */
  paid?: boolean;
  /** pay / done / finish (later): what is left to collect, in cents */
  due?: number;
  /** pay: part of it waits on this phone; finish: the payment that covers it waits on this phone (it leaves first) */
  waiting?: boolean;
  /** unbilled: how many lines of work are on no line of the finished invoice */
  count?: number;
}

type JobLike = Pick<Job, 'id' | 'status' | 'day' | 'waiver_signed_at' | 'pay_later'> & { coffre_id?: string | null };
type ItemLike = Pick<JobItem, 'id' | 'status'> & { deleted_at?: string | null; created_at?: string; answered_at?: string | null };
type InvoiceLike = Pick<Invoice, 'status' | 'total_cents' | 'paid_cents' | 'lines'> & { deleted_at?: string | null; issued_at?: string | null };

export function nextStep(job: JobLike, items: ItemLike[], invoice: InvoiceLike | null | undefined, rights: StepRights, ctx: StepContext): NextStep {
  const inv = liveInvoice(invoice);
  const waitingCents = Math.max(0, ctx.paidWaiting ?? 0);
  const issued = !!inv && inv.status === 'issued';
  const left = issued ? Math.max(0, inv!.total_cents - inv!.paid_cents) : 0;
  const due = Math.max(0, left - waitingCents);
  // a payment waiting on this phone covers the whole balance: it leaves before anything pressed after it
  const covered = issued && waitingCents > 0 && due === 0;
  // paid by the « Coffre » (family and friends): no invoice, settled
  const paid = (!!inv && inv.status === 'paid') || !!job.coffre_id || covered;
  switch (job.status) {
    case 'cancelled':
    case 'no_show':
      return { kind: 'closed' };
    case 'done':
      return { kind: 'done', paid, due };
    case 'booked':
      if (!rights.act) return { kind: 'none' };
      if (job.day > ctx.today) return { kind: 'later' };
      if (ctx.blockedBy && ctx.blockedBy !== job.id) return { kind: 'blocked', jobId: ctx.blockedBy };
      return { kind: 'leave' };
    case 'en_route':
      return rights.act ? { kind: 'arrive' } : { kind: 'none' };
    case 'on_site': {
      if (!rights.act) return { kind: 'none' };
      if (ctx.needVin) return { kind: 'vin' };
      if (!job.waiver_signed_at) return { kind: 'waiver' };
      if (job.coffre_id) return { kind: 'finish' };
      const open = items.filter((i) => !i.deleted_at);
      // the customer answers proposed work first, whatever the invoice: accepted, it is billed; refused, it is not
      const waiting = open.find((i) => i.status === 'proposed');
      if (waiting) return { kind: 'answer', itemId: waiting.id };
      // billable work on no line of the finished invoice (added after it, or taken off the draft): it goes on the invoice
      // (or is marked « Pas fait ») before the payment and the end, never « Encaisser » the old amount nor « Terminer »
      // with work nobody pays for (the server refuses « Terminé » then: job_unbilled)
      const missing = unbilledWork(open, inv);
      if (missing.length) return { kind: 'unbilled', itemId: missing[0].id, count: missing.length, paid: inv!.status === 'paid' };
      if (paid) return covered ? { kind: 'finish', waiting: true } : { kind: 'finish' };
      if (issued) {
        // « payer plus tard » already granted (the job came back from done): the server lets only those who may grant it
        // finish without the payment; for the others, the payment is the next step
        if (job.pay_later && rights.payLater) return { kind: 'finish', later: true, due };
        if (!rights.invoice) return { kind: 'none' };
        return waitingCents > 0 ? { kind: 'pay', payLater: rights.payLater, due, waiting: true } : { kind: 'pay', payLater: rights.payLater, due };
      }
      if (!rights.invoice) return { kind: 'none' };
      // nothing to bill yet: add work (a draft whose lines were typed on the invoice itself is ready to finish)
      if (!billable(open).length && !(inv && (inv.lines || []).length)) return { kind: 'work' };
      return inv ? { kind: 'invoice', draft: true, stale: draftIsStale(inv, open) } : { kind: 'invoice', draft: false };
    }
  }
  return { kind: 'none' };
}
