/* The lines of the accountant's files, from the phone's copy of the invoices and expenses, and the check that this
   copy holds what the server's report counted. Pure: the names (invoice number, customer, truck, status words) come in.
   The files are made on the phone so they work with no signal; the check below is what keeps a partial copy from
   going to the accountant without a word. */
import { TZ, type Day } from '../../lib/dates';
import type { Expense, Invoice } from '../../data/types';
import { inRange, type DayRange } from '../../domain/money/period';
import { taxSummary, type ExpenseLine, type RevenueLine } from '../../shared/export/exports';
import type { ReportPart, TreasuryReport } from './report';

let garageFmt: Intl.DateTimeFormat | null = null;
/** the day of an instant in Montréal, the way the server cuts the report (America/Toronto), whatever the phone's own
    time zone: an invoice finished at 22 h on 30 November is a November line for an accountant in Paris too */
export function garageDay(iso: string | null | undefined): Day | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  garageFmt ??= new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return garageFmt.format(d);
}

export interface LineNames {
  invoiceNumber: (v: Invoice) => string;
  customer: (id: string | null) => string;
  status: (s: 'draft' | 'issued' | 'partial' | 'paid' | 'void') => string;
  method: (m: string | null) => string;
  truck: (id: string | null) => string;
}

/** finished invoices (issued or paid) of the period, by their Montréal day */
export function revenueLines(invoices: Invoice[], r: DayRange, n: LineNames): RevenueLine[] {
  const out: RevenueLine[] = [];
  for (const v of invoices) {
    if (v.status !== 'issued' && v.status !== 'paid') continue;
    const day = garageDay(v.issued_at);
    if (!day || !inRange(day, r)) continue;
    out.push({
      day, number: n.invoiceNumber(v), customer: n.customer(v.customer_id),
      subtotal: v.subtotal_cents, tps: v.tps_cents, tvq: v.tvq_cents, total: v.total_cents, paid: v.paid_cents,
      status: n.status(v.status === 'issued' && v.paid_cents > 0 ? 'partial' : v.status)
    });
  }
  return out;
}
export function expenseLines(expenses: Expense[], r: DayRange, n: LineNames): ExpenseLine[] {
  return expenses.filter((e) => inRange(e.day, r)).map((e) => ({
    day: e.day, vendor: e.vendor || '', category: e.category || '', description: e.description || '',
    subtotal: e.subtotal_cents, tps: e.tps_cents, tvq: e.tvq_cents, total: e.total_cents,
    method: n.method(e.method), truck: n.truck(e.truck_id), receipt: !!e.receipt_id
  }));
}

/** the phone's lines differ from the server's report: a count, or an amount (an invoice changed on another phone
    keeps the count and changes the sums). The revenue only counts for someone who sees the invoices. */
export function exportMismatch(report: TreasuryReport, rev: RevenueLine[], exp: ExpenseLine[], seesInvoices: boolean): boolean {
  const s = taxSummary(rev, exp);
  const differs = (p: ReportPart, sum: { subtotal: number; tps: number; tvq: number }, count: number) =>
    p.count !== count || p.subtotal !== sum.subtotal || p.tps !== sum.tps || p.tvq !== sum.tvq;
  return (seesInvoices && differs(report.revenue, s.revenue, rev.length)) || differs(report.expenses, s.expenses, exp.length);
}
