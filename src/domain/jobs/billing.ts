/* A job's work and its invoice: which invoice counts, which work it bills, what is still missing from it, what a line is
   worth. Pure (tested in billing.test.ts): the red button, the work panel and the line sheet ask the same questions. */
import type { Invoice, JobItem, JobStatus } from '../../data/types';
import { lineCents as invoiceLineCents } from '../money/invoice';

/** the work that goes on the invoice */
export const BILLABLE = ['planned', 'done', 'approved'];
/** a job still coming or under way: its work and its appointment may still change */
const OPEN_STATUSES: readonly JobStatus[] = ['booked', 'en_route', 'on_site'];
export const isOpen = (s: JobStatus): boolean => OPEN_STATUSES.includes(s);

type ItemLike = Pick<JobItem, 'id' | 'status'> & { deleted_at?: string | null; created_at?: string; answered_at?: string | null };
type InvoiceLike = Pick<Invoice, 'status' | 'lines'> & { deleted_at?: string | null; issued_at?: string | null };

/** the invoice that counts: not cancelled, not deleted */
export function liveInvoice<T extends InvoiceLike>(v: T | null | undefined): T | null {
  return v && v.status !== 'void' && !v.deleted_at ? v : null;
}
/** finished: it has its number (issued or paid); its lines change only once it is opened again (« Modifier la facture ») */
export function isFinished(v: InvoiceLike | null | undefined): boolean {
  const live = liveInvoice(v);
  return !!live && (live.status === 'issued' || live.status === 'paid');
}
/** the work lines an invoice carries (lines typed by hand on the invoice have no work behind them) */
function itemIdsOn(v: InvoiceLike): Set<string> {
  return new Set((v.lines || []).map((l) => l.item_id).filter((x): x is string => !!x));
}
/** this line of work is on a FINISHED invoice: it may not be taken off or repriced until the invoice is opened again */
export function isBilled(v: InvoiceLike | null | undefined, itemId: string): boolean {
  return isFinished(v) && itemIdsOn(v!).has(itemId);
}
/** the work to bill: planned, done or accepted, not deleted */
export function billable<T extends ItemLike>(items: T[]): T[] {
  return items.filter((i) => !i.deleted_at && BILLABLE.includes(i.status));
}
/** the billable work on no line of the FINISHED invoice: nobody would pay for it. The server's own rule (job_unbilled,
    which refuses « Terminé » while it is not empty), whenever the work came: added or accepted after the invoice was
    finished, or already there and taken off the draft. Way out: « Modifier la facture » to add it, or mark it « Pas fait ».
    (An earlier rule let work older than the invoice through: the red button then said « Encaisser » and « Terminer »,
    and the server refused the end of the job once the customer had paid.) */
export function unbilledWork<T extends ItemLike>(items: T[], v: InvoiceLike | null | undefined): T[] {
  if (!isFinished(v)) return [];
  const on = itemIdsOn(v!);
  return billable(items).filter((i) => !on.has(i.id));
}
/** a draft made before the work changed: a billable line is missing from it, or a line's work is gone */
export function draftIsStale(v: InvoiceLike | null | undefined, items: ItemLike[]): boolean {
  if (!v || v.status !== 'draft') return false;
  const work = new Set(billable(items).map((i) => i.id));
  const on = itemIdsOn(v);
  for (const id of work) if (!on.has(id)) return true;
  for (const id of on) if (!work.has(id)) return true;
  return false;
}
/** what a line is worth before taxes: the invoice's own rule (domain/money/invoice.ts, the server's invoice_totals), so
    the job sheet says what the invoice will say. qty × price rounded to the cent; a discount always lowers the total
    (stored positive or negative); any other line keeps its sign (a service priced −15 $ counts −15 $, R46) */
export function lineCents(i: Pick<JobItem, 'qty' | 'unit_cents' | 'kind'>): number {
  return invoiceLineCents(i);
}

/** the estimate the customer signed online against what the customer owes now. The server keeps as the signed amount the
    draft invoice's total when there was one, else the work's: so the draft's total is compared when a draft exists (a
    price typed on it, taxes switched off, a line only on the invoice), else the work's total. Never « changed » once the
    job is over. */
export function estimateChanged(signedCents: number, workTotal: number, v: (InvoiceLike & { total_cents: number }) | null | undefined, status: JobStatus): boolean {
  if (!isOpen(status)) return false;
  const live = liveInvoice(v);
  const now = live && live.status === 'draft' ? live.total_cents : workTotal;
  return now !== signedCents;
}
