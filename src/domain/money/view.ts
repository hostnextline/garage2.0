/* An invoice as this phone sees it: the server's row, plus what this phone did and has not sent yet.
   - « Terminer la facture » waiting for the network: the invoice is shown finished (its number comes with the
     network), read-only, and « Encaisser » can be used: the payment waits behind the finish (the outbox keeps
     the order). Its totals are the draft's lines counted with the one rule (invoice.ts), the prepayments that wait
     on the job count in what is paid, as the server will do at the finish.
   - Payments taken on this phone and not yet answered by the server count in what is paid: what is left to collect
     is the rest, so the same payment is never offered twice. A refund waiting is a negative payment. A payment
     waiting never counts as money to give back, and a refund waiting never as money to collect: the server says it
     once it has them (so the moment its answer arrives never shows « Trop-perçu » or « Encaisser » by mistake).
   projectInvoice is pure (tested in view.test.ts); viewOf reads the device's copy and the outbox (reactive). */
import type { Invoice, Payment } from '../../data/types';
import type { TaxRates } from '../../lib/money';
import { settings } from '../../data/select';
import { rowsOf } from '../../data/store';
import { invoiceAmounts, linesTotals, type Amounts } from './invoice';
import { waitingEntries, unsentPayments, waitingSplit, finishWaiting } from './waiting';

export interface InvoiceView {
  /** the row as shown: a waiting finish makes the draft issued (or paid), with the totals of its lines */
  inv: Invoice;
  /** « Terminer la facture » waits on this phone: no number yet */
  finishing: boolean;
  /** the server's numbers (or the lines' for a draft / a waiting finish); `paid` is what the server has */
  amounts: Amounts;
  /** cents taken on this phone and not yet confirmed, refunds counted (negative: money given back) */
  waiting: number;
  /** of those, the payments (> 0) and the refunds (< 0) */
  waitingIn: number;
  waitingOut: number;
  /** left to collect, once the payments waiting are counted */
  due: number;
  /** to give back to the customer, once the refunds waiting are counted */
  over: number;
}

export function projectInvoice(inv: Invoice, rates: Partial<TaxRates> | null | undefined, o: { finishing: boolean; waiting: { in: number; out: number }; ahead: number }): InvoiceView {
  let row = inv;
  const finishing = inv.status === 'draft' && o.finishing;
  if (finishing) {
    const tt = linesTotals(inv.lines || [], rates, inv.taxes_on !== false);
    const paid = Number(inv.paid_cents || 0) + o.ahead;
    row = { ...inv, status: paid >= tt.total ? 'paid' : 'issued', subtotal_cents: tt.subtotal, tps_cents: tt.tps, tvq_cents: tt.tvq, total_cents: tt.total, paid_cents: paid };
  }
  const amounts = invoiceAmounts(row, rates);
  const wIn = Math.max(0, o.waiting.in), wOut = Math.min(0, o.waiting.out);
  const voided = row.status === 'void';
  return {
    inv: row, finishing, amounts, waiting: wIn + wOut, waitingIn: wIn, waitingOut: wOut,
    due: voided ? 0 : Math.max(0, amounts.total - amounts.paid - wIn),
    over: voided ? Math.max(0, amounts.paid + wOut) : Math.max(0, amounts.paid + wOut - amounts.total)
  };
}

/** the prepayments of a job (paid online before the invoice was finished): they join the invoice at its finish */
export function aheadOf(jobId: string | null | undefined): number {
  if (!jobId) return 0;
  return rowsOf<Payment>('payments').filter((x) => x.job_id === jobId && !x.invoice_id && !x.deleted_at).reduce((n, x) => n + x.amount_cents, 0);
}

/** the invoice as this phone sees it (reactive: the device's copy and what waits in the outbox) */
export function viewOf(inv: Invoice): InvoiceView {
  const list = waitingEntries();
  const finishing = finishWaiting(list, inv.id);
  const waiting = waitingSplit(unsentPayments({ invoiceId: inv.id, jobId: inv.job_id }));
  return projectInvoice(inv, settings.value.taxes, { finishing, waiting, ahead: finishing ? aheadOf(inv.job_id) : 0 });
}
