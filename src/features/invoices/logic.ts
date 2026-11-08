/* Invoices and estimates: the pure rules (no screen, no store), tested in logic.test.ts.
   - Totals mirror the server's trigger (supabase/migrations/…_jobs_money.sql, invoice_totals): a line is qty × price
     rounded to the cent, a discount line always lowers the total, TPS and TVQ are computed once on the taxable subtotal.
     So a draft shows on screen exactly what the finished invoice will say; a finished invoice shows the server's numbers.
   - Cash: Canada has no more pennies, a cash payment is rounded to the nearest 5 ¢; only the balance is recorded.
   - CSV for a spreadsheet in the person's language (French Excel: « ; » and decimal comma). */
import { totals as moneyTotals, roundCents, type TaxRates, type Totals } from '../../lib/money';
import { addDays, dayOf, daysBetween, type Day } from '../../lib/dates';
import type { Invoice, InvoiceLine, ItemKind, Lang } from '../../data/types';

export interface LineLike {
  description?: string | null; qty?: number | string | null; unit_cents?: number | string | null; taxable?: boolean | null; kind?: ItemKind | string | null;
}

function numberOf(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** a line's amount, the server's way: qty × price rounded to the cent; a discount always lowers the total */
export function lineCents(l: LineLike): number {
  const lt = roundCents(numberOf(l.qty, 1) * numberOf(l.unit_cents, 0));
  return l.kind === 'discount' && lt > 0 ? -lt : lt;
}

/** subtotal, taxes and total of lines (taxesOn: false for an exempted customer) */
export function linesTotals(lines: LineLike[], rates: Partial<TaxRates> | null | undefined, taxesOn = true): Totals {
  const r: TaxRates = { enabled: rates?.enabled !== false && taxesOn, tps: rates?.tps ?? 0.05, tvq: rates?.tvq ?? 0.09975 };
  return moneyTotals(lines.map((l) => ({ qty: 1, unitCents: lineCents(l), taxable: l.taxable !== false })), r);
}

/** over: paid more than the total (a prepayment then a rebate, a double card payment): money to give back */
export interface Amounts { subtotal: number; tps: number; tvq: number; total: number; paid: number; balance: number; over: number; showTaxes: boolean }
type InvoiceMoney = Pick<Invoice, 'status' | 'lines' | 'taxes_on' | 'subtotal_cents' | 'tps_cents' | 'tvq_cents' | 'total_cents' | 'paid_cents'>;
/** what an invoice says: a draft is computed from its lines (as the server will), a finished one is the server's */
export function invoiceAmounts(inv: InvoiceMoney, rates: Partial<TaxRates> | null | undefined): Amounts {
  const paid = Number(inv.paid_cents || 0);
  const ratesOn = rates?.enabled !== false;
  if (inv.status === 'draft') {
    const tt = linesTotals(inv.lines || [], rates, inv.taxes_on !== false);
    return { subtotal: tt.subtotal, tps: tt.tps, tvq: tt.tvq, total: tt.total, paid, balance: Math.max(0, tt.total - paid), over: Math.max(0, paid - tt.total), showTaxes: ratesOn && inv.taxes_on !== false };
  }
  const tps = Number(inv.tps_cents || 0), tvq = Number(inv.tvq_cents || 0), total = Number(inv.total_cents || 0);
  return {
    subtotal: Number(inv.subtotal_cents || 0), tps, tvq, total, paid,
    balance: inv.status === 'void' ? 0 : Math.max(0, total - paid),
    over: inv.status === 'void' ? Math.max(0, paid) : Math.max(0, paid - total),
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

/** the lines as they are saved: only the fields the server keeps (its trigger adds total_cents) */
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
/** cash received for an amount due: the change to give back, and what is recorded (never more than the amount due).
    A few cents under (10,00 $ handed for 10,03 $, the rounding) count as paid in full: no invoice stays open for 3 ¢. */
export function cashChange(due: number, received: number | null | undefined): Cash {
  const dueCash = cashRound(due);
  if (received == null) return { due, dueCash, received: null, record: due, change: 0, short: 0 };
  if (received >= dueCash || due - received < 5) return { due, dueCash, received, record: due, change: Math.max(0, received - dueCash), short: 0 };
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
export type PeriodKey = 'all' | '30d' | 'month' | 'last' | 'year';
export const PERIODS: PeriodKey[] = ['all', '30d', 'month', 'last', 'year'];
/** the days of a period (inclusive), or null for « Tout » */
export function periodRange(p: PeriodKey, today: Day): [Day, Day] | null {
  const ym = today.slice(0, 7);
  switch (p) {
    case '30d': return [addDays(today, -29), today];
    case 'month': return [`${ym}-01`, today];
    case 'last': { const end = addDays(`${ym}-01`, -1); return [`${end.slice(0, 7)}-01`, end]; }
    case 'year': return [`${today.slice(0, 4)}-01-01`, today];
    default: return null;
  }
}
export function inPeriod(iso: string | null | undefined, range: [Day, Day] | null): boolean {
  if (!range) return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = dayOf(d);
  return day >= range[0] && day <= range[1];
}

/* ---------- CSV (a spreadsheet) ---------- */
export type CsvValue = string | number | null | undefined | { cents: number };
/** French Excel reads « ; » and a decimal comma; English, « , » and a point */
export function csvSeparator(lang: Lang): ';' | ',' { return lang === 'en' ? ',' : ';'; }
export function centsText(c: number, lang: Lang): string {
  const s = (Math.abs(c) / 100).toFixed(2);
  return (c < 0 ? '-' : '') + (lang === 'en' ? s : s.replace('.', ','));
}
export function csvCell(v: CsvValue, lang: Lang): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'object') s = centsText(v.cents, lang);
  else if (typeof v === 'number') s = lang === 'en' ? String(v) : String(v).replace('.', ',');
  else {
    s = String(v);
    // a name typed as « =… » must stay text in a spreadsheet, never become a formula
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  const sep = csvSeparator(lang);
  return s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** the whole file: a BOM (accents read right by Excel), one line per row, Windows line ends */
export function toCsv(rows: CsvValue[][], lang: Lang): string {
  const sep = csvSeparator(lang);
  return '﻿' + rows.map((r) => r.map((c) => csvCell(c, lang)).join(sep)).join('\r\n') + '\r\n';
}

/** a file name a phone and a computer both accept */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
}
