/* What the appointment page shows, worked out from the server's answer. Pure: tested in client.test.ts. */
import type { JobView, InvoiceV, ExtraV, JobItemV } from './api';

export function invoicePaid(inv: InvoiceV | null | undefined): boolean {
  return !!inv && (inv.status === 'paid' || (inv.total_cents > 0 && inv.paid_cents >= inv.total_cents));
}
export function invoiceBalance(inv: InvoiceV): number { return Math.max(0, inv.total_cents - inv.paid_cents); }

/** nothing left to pay: the invoice is paid, or the expected total was paid ahead */
export function nothingLeft(v: JobView): boolean {
  if (v.invoice) return invoicePaid(v.invoice);
  return v.prepaid_cents > 0 && v.expected.total > 0 && v.prepaid_cents >= v.expected.total;
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

export type PayCheck = 'idle' | 'checking' | 'paid' | 'late';
/** after a card payment (back from Stripe): paid when nothing is left to pay, else keep checking a few times */
export function afterCheck(v: JobView, tries: number, maxTries: number): PayCheck {
  if (nothingLeft(v) || (v.pay.amount_cents <= 0 && (v.prepaid_cents > 0 || !!v.invoice))) return 'paid';
  return tries >= maxTries ? 'late' : 'checking';
}
