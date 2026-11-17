/* What the appointment page shows, worked out from the server's answer. Pure: tested in view-state.test.ts and
   client.test.ts. */
import type { JobView, InvoiceV, ExtraV, JobItemV, InvoiceLineV } from '../api';

export function invoicePaid(inv: InvoiceV | null | undefined): boolean {
  return !!inv && (inv.status === 'paid' || (inv.total_cents > 0 && inv.paid_cents >= inv.total_cents));
}
export function invoiceBalance(inv: InvoiceV): number { return Math.max(0, inv.total_cents - inv.paid_cents); }

/** nothing left to pay: the invoice is paid, or the expected total was paid ahead */
export function nothingLeft(v: JobView): boolean {
  if (v.invoice) return invoicePaid(v.invoice);
  return v.prepaid_cents > 0 && v.expected.total > 0 && v.prepaid_cents >= v.expected.total;
}

/** all the money the file has received (paid ahead, and paid on the invoice) */
export function moneyIn(v: JobView): number {
  return Math.max(0, v.prepaid_cents || 0) + Math.max(0, v.invoice?.paid_cents || 0);
}

/** does the garage charge taxes on this file? (unknown: yes, the usual case in Québec) */
export function chargesTaxes(v: JobView): boolean {
  if (v.invoice && v.invoice.subtotal_cents > 0) return v.invoice.tps_cents + v.invoice.tvq_cents > 0;
  if (v.expected.subtotal > 0) return v.expected.tps + v.expected.tvq > 0;
  return true;
}

export interface Sections { proposed: ExtraV[]; declined: ExtraV[]; planned: JobItemV[] }
/** the extra work still to answer, the extra work refused, and the planned work (with the extra work accepted) */
export function sections(v: JobView): Sections {
  return {
    proposed: (v.extras || []).filter((x) => x.status === 'proposed'),
    declined: (v.extras || []).filter((x) => x.status === 'declined'),
    planned: (v.items || []).filter((x) => ['planned', 'done', 'approved'].includes(x.status))
  };
}

const OPEN = ['booked', 'en_route', 'on_site'];
/** the extra work can still be answered: the visit is coming or under way and its invoice is not finished.
    A proposal nobody answered before the job was finished is not offered a week later above the paid invoice. */
function extrasAnswerable(v: JobView): boolean {
  return OPEN.includes(v.job.status) && !v.invoice;
}
/** the extra work to show for an answer (none once the visit is over) */
export function extrasToAnswer(v: JobView): ExtraV[] {
  return extrasAnswerable(v) ? sections(v).proposed : [];
}

/** the mechanic is there and the invoice is being made: it comes first, with its own words */
export function isOnSiteBill(v: JobView): boolean {
  return !v.invoice && !!v.bill && v.job.status === 'on_site';
}
/** the lines of the work panel and where they come from. As soon as a draft invoice exists the server's total is the
    draft's (rebates, lines added): its lines are listed, whatever the status, so the lines always add up to the total. */
export function workLines(v: JobView): { kind: 'bill'; lines: InvoiceLineV[] } | { kind: 'planned'; lines: JobItemV[] } {
  if (!v.invoice && v.bill) return { kind: 'bill', lines: v.bill.lines || [] };
  return { kind: 'planned', lines: sections(v).planned };
}

/** the sentence under the appointment's day. A booked « Plages d’arrivée » appointment speaks of its window, or of the
    window still to come (flexible), never of « ce bloc » */
export function explainKey(job: JobView['job'], tracked: boolean): string {
  if (job.status === 'en_route' && !tracked) return 'job.explain.en_routeNoLink';
  if (job.status === 'booked' && job.block === 'day') return job.start != null && job.end != null ? 'job.explain.bookedWindow' : 'job.explain.bookedFlex';
  return `job.explain.${job.status}`;
}

/** the estimate is signed now (after a sign whose answer was lost: the page reads the file again before saying it failed) */
export function estimateSigned(v: JobView): boolean {
  return !!v.estimate?.signed_at && !v.estimate.can_sign;
}

/** the status of an extra work in an answer (to tell « thank you » from « another phone answered first ») */
export function extraStatus(v: JobView, id: string): string | null {
  return (v.extras || []).find((x) => x.id === id)?.status ?? null;
}

/** the « check » answer says Stripe holds the card page as paid (« session », or « checked » under its first name) */
export function cardPaid(v: JobView): boolean {
  return v.session === 'paid' || v.checked === 'paid';
}

export type PayCheck = 'idle' | 'checking' | 'paid' | 'late';
/** after a card payment (back from Stripe): paid when nothing is left to pay, or when money came in since this tab left
    for Stripe (`receivedBefore`: a balance may remain when the total rose meanwhile, or the payment was a part);
    else keep checking a few times */
export function afterCheck(v: JobView, tries: number, maxTries: number, receivedBefore: number | null = null): PayCheck {
  if (cardPaid(v)) return 'paid';
  if (nothingLeft(v) || (v.pay.amount_cents <= 0 && (v.prepaid_cents > 0 || !!v.invoice))) return 'paid';
  if (receivedBefore != null && moneyIn(v) > receivedBefore) return 'paid';
  return tries >= maxTries ? 'late' : 'checking';
}

/** the words of a refused sign or answer (codes only: the server's French sentence is never shown) */
export function refusalKey(action: 'sign' | 'answer', code: string): string {
  if (code === 'amount_changed') return action === 'sign' ? 'sign.changedNow' : 'extras.changedNow';
  if (action === 'sign' && code === 'signed') return 'sign.already';
  if (action === 'answer' && code === 'closed') return 'extras.closed';
  return action === 'sign' ? 'sign.fail' : 'errors.answer';
}
