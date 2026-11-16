/* Invoices and estimates: the one rule for what lines are worth (no screen, no store), tested in invoice.test.ts.
   - Totals mirror the server's trigger (supabase/migrations/…_jobs_money.sql, invoice_totals): a line is qty × price
     rounded to the cent, a discount line always lowers the total, TPS and TVQ are computed once on the taxable subtotal.
     The draft on screen, the estimate, the PDF and the document all count with these functions, so they show exactly
     what the finished invoice will say; a finished invoice shows the server's numbers.
   - Cash: Canada has no more pennies, a cash payment is rounded to the nearest 5 ¢; only the balance is recorded
     (what counts as paid is the owner's decision: no « close enough » here). */
import { totals as moneyTotals, roundCents, type TaxRates, type Totals } from '../../lib/money';
import { dayOf, daysBetween } from '../../lib/dates';
import type { Invoice, InvoiceLine, ItemKind } from '../../data/types';

export interface LineLike {
  description?: string | null; qty?: number | string | null; unit_cents?: number | string | null; taxable?: boolean | null; kind?: ItemKind | string | null;
}

function numberOf(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** a line's amount, the server's way: qty × price rounded to the cent; a discount always lowers the total
    (an editor stores a discount positive, « Changer le prix » stores it negative: both count the same) */
export function lineCents(l: LineLike): number {
  const lt = roundCents(numberOf(l.qty, 1) * numberOf(l.unit_cents, 0));
  return l.kind === 'discount' && lt > 0 ? -lt : lt;
}
/** the unit price as the customer reads it: a discount is shown negative, whatever sign it was stored with */
export function unitCents(l: LineLike): number {
  const u = Math.round(numberOf(l.unit_cents, 0));
  return l.kind === 'discount' ? -Math.abs(u) : u;
}
/** the quantity of a line (« 1,5 » typed in French counts 1.5; nothing = 1, like the server) */
export function lineQty(l: LineLike): number { return numberOf(l.qty, 1); }

/** subtotal, taxes and total of lines (taxesOn: false for an exempted customer) */
export function linesTotals(lines: LineLike[], rates: Partial<TaxRates> | null | undefined, taxesOn = true): Totals {
  const r: TaxRates = { enabled: rates?.enabled !== false && taxesOn, tps: rates?.tps ?? 0.05, tvq: rates?.tvq ?? 0.09975 };
  return moneyTotals(lines.map((l) => ({ qty: 1, unitCents: lineCents(l), taxable: l.taxable !== false })), r);
}

/** over: paid more than the total (paid ahead then a rebate, the same payment taken twice): money to give back */
export interface Amounts { subtotal: number; tps: number; tvq: number; total: number; paid: number; balance: number; over: number; showTaxes: boolean }
export type InvoiceMoney = Pick<Invoice, 'status' | 'lines' | 'taxes_on' | 'subtotal_cents' | 'tps_cents' | 'tvq_cents' | 'total_cents' | 'paid_cents'>;
/** what an invoice says: a draft is computed from its lines (as the server will), a finished one is the server's.
    A cancelled invoice owes nothing, and anything paid on it is owed back. */
export function invoiceAmounts(inv: InvoiceMoney, rates: Partial<TaxRates> | null | undefined): Amounts {
  const paid = Number(inv.paid_cents || 0);
  const ratesOn = rates?.enabled !== false;
  if (inv.status === 'draft') {
    const tt = linesTotals(inv.lines || [], rates, inv.taxes_on !== false);
    return { subtotal: tt.subtotal, tps: tt.tps, tvq: tt.tvq, total: tt.total, paid, balance: Math.max(0, tt.total - paid), over: Math.max(0, paid - tt.total), showTaxes: ratesOn && inv.taxes_on !== false };
  }
  const tps = Number(inv.tps_cents || 0), tvq = Number(inv.tvq_cents || 0), total = Number(inv.total_cents || 0);
  const voided = inv.status === 'void';
  return {
    subtotal: Number(inv.subtotal_cents || 0), tps, tvq, total, paid,
    balance: voided ? 0 : Math.max(0, total - paid),
    over: voided ? Math.max(0, paid) : Math.max(0, paid - total),
    showTaxes: tps + tvq > 0 || (ratesOn && inv.taxes_on !== false)
  };
}

/* ---------- a draft before « Terminer la facture » (the server checks the same) ---------- */
export type DraftProblem = 'empty' | 'no_description' | 'negative';
export function draftProblems(lines: LineLike[], total: number): { problem: DraftProblem | null; lines: number[] } {
  if (!lines.length) return { problem: 'empty', lines: [] };
  const missing = lines.map((l, i) => (String(l.description ?? '').trim() ? -1 : i)).filter((i) => i >= 0);
  if (missing.length) return { problem: 'no_description', lines: missing };
  if (total < 0) return { problem: 'negative', lines: [] };
  return { problem: null, lines: [] };
}

/** the lines as they are saved: only the fields the server keeps (its trigger adds total_cents).
    item_id on an invoice line is the job line it bills (job_items.id), not an item of the inventory. */
export function cleanLine(l: LineLike & { item_id?: string | null }): InvoiceLine {
  const out: InvoiceLine = {
    description: String(l.description ?? '').trim(), qty: numberOf(l.qty, 1), unit_cents: Math.round(numberOf(l.unit_cents, 0)),
    taxable: l.taxable !== false, kind: (l.kind as ItemKind) || 'service'
  };
  if (l.item_id) out.item_id = l.item_id;
  return out;
}

/* ---------- cash ---------- */
/** the amount a customer can hand over in cash: rounded to the nearest 5 ¢ (no more pennies in Canada) */
export function cashRound(cents: number): number { return Math.round(cents / 5) * 5; }
export interface Cash { due: number; dueCash: number; received: number | null; record: number; change: number; short: number }
/** cash received for an amount due: the change to give back, and what is recorded (never more than the amount due) */
export function cashChange(due: number, received: number | null | undefined): Cash {
  const dueCash = cashRound(due);
  if (received == null) return { due, dueCash, received: null, record: due, change: 0, short: 0 };
  if (received >= dueCash) return { due, dueCash, received, record: due, change: received - dueCash, short: 0 };
  return { due, dueCash, received, record: Math.max(0, received), change: 0, short: dueCash - received };
}
/** the bills a customer is likely to hand over: the exact amount, then the next round amounts */
export function cashQuick(dueCash: number): number[] {
  const out = new Set<number>([dueCash]);
  for (const step of [500, 1000, 2000, 5000, 10000]) {
    const up = Math.ceil(dueCash / step) * step;
    if (up > dueCash) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

/* ---------- numbers, dates ---------- */
export function formatNumber(prefix: string | null | undefined, pad: number | null | undefined, n: number | null | undefined): string {
  if (n == null) return '';
  return `${prefix ?? ''}${String(n).padStart(Number(pad ?? 4), '0')}`;
}
/** whole days since a moment (0 = today) */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, daysBetween(dayOf(d), dayOf(now)));
}
