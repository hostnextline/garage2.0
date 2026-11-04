/* Invoices: small lookups for this section's screens (they read the device's copy; a screen that calls them redraws
   when the data changes) and who may do what (the server checks again). */
import { computed } from '@preact/signals';
import { getRow, rowsOf } from '../../data/store';
import { settings, invoicesList, customer, customerName, job as jobRow, vehicle, vehicleLabel, invoiceNumber, messagesOf } from '../../data/select';
import { can, hasRole, isOwner, myTrucks, me } from '../../data/auth';
import type { Invoice, Job, Payment, PayMethod, Quote, Customer, Lang } from '../../data/types';
import { t, tl } from '../../lib/i18n';
import { invoiceAmounts, formatNumber, type Amounts } from './logic';

export function invoiceById(id: string | null | undefined): Invoice | undefined {
  const v = getRow<Invoice>('invoices', id);
  return v && !v.deleted_at ? v : undefined;
}
/** the last cancelled invoice of a job (shown above « Faire la facture ») */
export function voidedOf(jobId: string): Invoice | undefined {
  return rowsOf<Invoice>('invoices').filter((v) => v.job_id === jobId && v.status === 'void' && !v.deleted_at)
    .sort((a, b) => String(b.voided_at || b.updated_at).localeCompare(String(a.voided_at || a.updated_at)))[0];
}
/** the payments of an invoice, oldest first */
export function paymentsOfInvoice(invoiceId: string): Payment[] {
  return rowsOf<Payment>('payments').filter((p) => p.invoice_id === invoiceId && !p.deleted_at)
    .sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)));
}
export function amountsOf(inv: Invoice): Amounts { return invoiceAmounts(inv, settings.value.taxes); }

/** who the invoice is for: « Julie Tremblay », a company, or the job's customer */
export function invoiceCustomer(inv: Pick<Invoice, 'customer_id' | 'job_id'>): Customer | undefined {
  return customer(inv.customer_id) || customer(jobRow(inv.job_id)?.customer_id);
}
export function invoiceWho(inv: Pick<Invoice, 'customer_id' | 'job_id'>): string {
  return customerName(invoiceCustomer(inv)) || t('invoices.noCustomer');
}
export function invoiceVehicleText(inv: Pick<Invoice, 'job_id'>): string {
  return vehicleLabel(vehicle(jobRow(inv.job_id)?.vehicle_id));
}
/** « F-0043 », or « Brouillon » for a draft */
export function invoiceLabel(inv: Pick<Invoice, 'number' | 'status'>, l: Lang | string = 'fr'): string {
  return inv.number != null ? invoiceNumber(inv) : tl(l === 'en' ? 'en' : 'fr', 'invoices.draftWord');
}

/* ---------- estimates ---------- */
export function quoteNumber(q: Pick<Quote, 'number'> | null | undefined): string {
  if (!q || q.number == null) return '';
  const b = settings.value.billing as { quote_prefix?: string; pad?: number };
  return formatNumber(b.quote_prefix ?? 'E-', b.pad ?? 4, q.number);
}

/* ---------- who may do what (mirrors the server's rules) ---------- */
/** may change this job's invoice and take its payment (invoice_editable): the right, the mechanic of the job, or the bookers */
export function canEditInvoiceOf(job: Pick<Job, 'truck_id' | 'created_by'> | null | undefined): boolean {
  if (can('edit_invoices')) return true;
  if (!job) return false;
  const mine = (!!job.truck_id && myTrucks().includes(job.truck_id)) || (!!job.created_by && job.created_by === me.value?.id);
  if (mine && hasRole('mechanic')) return true;
  return can('book');   // the job is on this device, so it is visible to this person
}
/** cancel an invoice, remove a payment: the owner and the office (edit_invoices) */
export function canManageInvoices(): boolean { return isOwner() || can('edit_invoices'); }

/* ---------- words ---------- */
export const METHODS: Exclude<PayMethod, 'card_online'>[] = ['cash', 'debit', 'credit', 'interac', 'cheque', 'other'];
export function methodWord(m: PayMethod | string, l: Lang | string = 'fr'): string {
  const k = `invoices.methods.${m}`;
  const w = tl(l === 'en' ? 'en' : 'fr', k);
  return w === k ? String(m) : w;
}

/* ---------- the money still to collect (all the invoices this person sees) ---------- */
export const owing = computed(() => {
  let cents = 0, n = 0, oldest: string | null = null;
  for (const v of invoicesList.value) {
    if (v.status !== 'issued') continue;
    const due = Math.max(0, Number(v.total_cents) - Number(v.paid_cents || 0));
    if (due <= 0) continue;
    cents += due; n++;
    if (v.issued_at && (!oldest || v.issued_at < oldest)) oldest = v.issued_at;
  }
  return { cents, n, oldest };
});
/** the texts of an invoice already sent (invoice, reminders), newest first */
export function invoiceTexts(jobId: string | null | undefined) {
  return jobId ? messagesOf(jobId).filter((m) => m.kind === 'invoice' || m.kind === 'payment_reminder') : [];
}
