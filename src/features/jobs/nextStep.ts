/* The one next action of a job (the red button), decided from the job, its work, its invoice and what the person may
   do. Pure: the job sheet and « Ma journée » ask the same question and get the same answer.

   booked    → Je pars (not before the day; not while this truck has an unpaid job on site: the server refuses it)
   en_route  → Je suis arrivé
   on_site   → settled (paid, or the Coffre): « Terminer la job »; else the next missing piece, in order: the signed authorization, the customer's answer to proposed work,
               some work to bill, the invoice, the payment, then « Terminer la job »
   done      → nothing to press (the PAYÉ stamp; what is left to collect)
   cancelled, no_show → closed */
import type { Job, JobItem, Invoice } from '../../data/types';

export type StepKind =
  | 'leave' | 'arrive' | 'waiver' | 'answer' | 'work' | 'invoice' | 'pay' | 'finish'
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
}
export interface NextStep {
  kind: StepKind;
  /** answer: the proposed work waiting for the customer */
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
  /** done: the invoice is paid */
  paid?: boolean;
  /** pay / done: what is left to collect, in cents */
  due?: number;
}

/** the work that goes on the invoice */
export const BILLABLE = ['planned', 'done', 'approved'];

type JobLike = Pick<Job, 'id' | 'status' | 'day' | 'waiver_signed_at' | 'pay_later'> & { coffre_id?: string | null };
type ItemLike = Pick<JobItem, 'id' | 'status'> & { deleted_at?: string | null };
type InvoiceLike = Pick<Invoice, 'status' | 'total_cents' | 'paid_cents' | 'lines'> & { deleted_at?: string | null };

/** the invoice that counts: not cancelled, not deleted */
function liveInvoice(v: InvoiceLike | null | undefined): InvoiceLike | null {
  return v && v.status !== 'void' && !v.deleted_at ? v : null;
}
/** a draft made before the work changed: a billable line is missing from it, or a line's work is gone */
export function draftIsStale(v: InvoiceLike | null | undefined, items: ItemLike[]): boolean {
  if (!v || v.status !== 'draft') return false;
  const billable = new Set(items.filter((i) => !i.deleted_at && BILLABLE.includes(i.status)).map((i) => i.id));
  const onInvoice = new Set((v.lines || []).map((l) => l.item_id).filter((x): x is string => !!x));
  for (const id of billable) if (!onInvoice.has(id)) return true;
  for (const id of onInvoice) if (!billable.has(id)) return true;
  return false;
}

export function nextStep(job: JobLike, items: ItemLike[], invoice: InvoiceLike | null | undefined, rights: StepRights, ctx: StepContext): NextStep {
  const inv = liveInvoice(invoice);
  // paid by the « Coffre » (family and friends): no invoice, settled
  const paid = (!!inv && inv.status === 'paid') || !!job.coffre_id;
  const due = inv && inv.status === 'issued' ? Math.max(0, inv.total_cents - inv.paid_cents) : 0;
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
      // already settled (paid invoice, or the Coffre): « Terminer » straight away, signed or not (the server asks no
      // signature to finish; the authorization can still be signed from its panel)
      if (paid) return { kind: 'finish' };
      if (!job.waiver_signed_at) return { kind: 'waiver' };
      // « payer plus tard » was granted (the job came back from done): an issued invoice is enough
      if (job.pay_later && inv && inv.status === 'issued') return { kind: 'finish', later: true, due };
      if (inv && inv.status === 'issued') return rights.invoice ? { kind: 'pay', payLater: rights.payLater, due } : { kind: 'none' };
      // no invoice yet, or a draft: the customer answers proposed work first (it is not billed until accepted)
      const open = items.filter((i) => !i.deleted_at);
      const waiting = open.find((i) => i.status === 'proposed');
      if (waiting) return { kind: 'answer', itemId: waiting.id };
      if (!rights.invoice) return { kind: 'none' };
      if (!open.some((i) => BILLABLE.includes(i.status))) return { kind: 'work' };
      return inv ? { kind: 'invoice', draft: true, stale: draftIsStale(inv, open) } : { kind: 'invoice', draft: false };
    }
  }
  return { kind: 'none' };
}
