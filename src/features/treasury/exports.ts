/* The accountant's files for a period: an Excel workbook (sheets Revenus, Dépenses, Taxes) and a CSV journal.
   Built from plain lines (the screen prepares them from the device's copy), in cents, summed here: the Taxes sheet
   always agrees with the two other sheets of the same file. */
import type { Cents } from '../../lib/money';
import type { Day } from '../../lib/dates';
import { buildXlsx, type Cell, type SheetDef } from './xlsx';

export interface RevenueLine { day: Day; number: string; customer: string; subtotal: Cents; tps: Cents; tvq: Cents; total: Cents; paid: Cents; status: string }
export interface ExpenseLine { day: Day; vendor: string; category: string; description: string; subtotal: Cents; tps: Cents; tvq: Cents; total: Cents; method: string; truck: string; receipt: boolean }
export interface ExportLabels {
  sheets: { revenue: string; expenses: string; taxes: string };
  revenue: { day: string; number: string; customer: string; subtotal: string; tps: string; tvq: string; total: string; paid: string; status: string };
  expenses: { day: string; vendor: string; category: string; description: string; subtotal: string; tps: string; tvq: string; total: string; method: string; truck: string; receipt: string };
  taxes: { title: string; period: string; from: string; to: string; company: string; tpsNo: string; tvqNo: string; tax: string; collected: string; paid: string; remit: string; tps: string; tvq: string; both: string; revenue: string; expenses: string; profit: string; note: string };
  totalRow: string; yes: string; no: string;
  csv: { day: string; type: string; number: string; name: string; category: string; description: string; subtotal: string; tps: string; tvq: string; total: string; method: string; revenue: string; expense: string };
}
export interface ExportInput {
  from: Day; to: Day; revenue: RevenueLine[]; expenses: ExpenseLine[];
  company?: { name?: string; tps_no?: string; tvq_no?: string };
  labels: ExportLabels;
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + (f(x) || 0), 0);
const $ = (c: Cents) => ({ v: c / 100, s: 'money' as const });
const $$ = (c: Cents) => ({ v: c / 100, s: 'boldMoney' as const });
const b = (s: string) => ({ v: s, s: 'bold' as const });
const d = (day: Day) => ({ v: day, s: 'date' as const });
const byDay = <T extends { day: Day }>(xs: T[]) => xs.slice().sort((x, y) => x.day.localeCompare(y.day));

export interface TaxSummary { revenue: { subtotal: Cents; tps: Cents; tvq: Cents; total: Cents }; expenses: { subtotal: Cents; tps: Cents; tvq: Cents; total: Cents }; tpsToRemit: Cents; tvqToRemit: Cents; profit: Cents }
export function taxSummary(revenue: RevenueLine[], expenses: ExpenseLine[]): TaxSummary {
  const parts = <T extends { subtotal: Cents; tps: Cents; tvq: Cents; total: Cents }>(xs: T[]) =>
    ({ subtotal: sum(xs, (x) => x.subtotal), tps: sum(xs, (x) => x.tps), tvq: sum(xs, (x) => x.tvq), total: sum(xs, (x) => x.total) });
  const r = parts(revenue), e = parts(expenses);
  return { revenue: r, expenses: e, tpsToRemit: r.tps - e.tps, tvqToRemit: r.tvq - e.tvq, profit: r.subtotal - e.subtotal };
}

export function workbookSheets(x: ExportInput): SheetDef[] {
  const L = x.labels;
  const rev = byDay(x.revenue), exp = byDay(x.expenses);
  const s = taxSummary(rev, exp);
  const revenue: SheetDef = {
    name: L.sheets.revenue, freezeHeader: true, widths: [12, 12, 30, 14, 12, 12, 14, 14, 14],
    rows: [
      [b(L.revenue.day), b(L.revenue.number), b(L.revenue.customer), b(L.revenue.subtotal), b(L.revenue.tps), b(L.revenue.tvq), b(L.revenue.total), b(L.revenue.paid), b(L.revenue.status)],
      ...rev.map((r): Cell[] => [d(r.day), r.number, r.customer, $(r.subtotal), $(r.tps), $(r.tvq), $(r.total), $(r.paid), r.status]),
      [b(L.totalRow), null, null, $$(s.revenue.subtotal), $$(s.revenue.tps), $$(s.revenue.tvq), $$(s.revenue.total), $$(sum(rev, (r) => r.paid)), null]
    ]
  };
  const expenses: SheetDef = {
    name: L.sheets.expenses, freezeHeader: true, widths: [12, 28, 22, 30, 14, 12, 12, 14, 16, 20, 8],
    rows: [
      [b(L.expenses.day), b(L.expenses.vendor), b(L.expenses.category), b(L.expenses.description), b(L.expenses.subtotal), b(L.expenses.tps), b(L.expenses.tvq), b(L.expenses.total), b(L.expenses.method), b(L.expenses.truck), b(L.expenses.receipt)],
      ...exp.map((e): Cell[] => [d(e.day), e.vendor, e.category, e.description, $(e.subtotal), $(e.tps), $(e.tvq), $(e.total), e.method, e.truck, e.receipt ? L.yes : L.no]),
      [b(L.totalRow), null, null, null, $$(s.expenses.subtotal), $$(s.expenses.tps), $$(s.expenses.tvq), $$(s.expenses.total), null, null, null]
    ]
  };
  const T = L.taxes;
  const taxes: SheetDef = {
    name: L.sheets.taxes, widths: [30, 18, 18, 18],
    rows: [
      [b(T.title)],
      [T.period, d(x.from), d(x.to)],
      ...(x.company?.name ? [[T.company, x.company.name] as Cell[]] : []),
      ...(x.company?.tps_no ? [[T.tpsNo, x.company.tps_no] as Cell[]] : []),
      ...(x.company?.tvq_no ? [[T.tvqNo, x.company.tvq_no] as Cell[]] : []),
      [],
      [b(T.tax), b(T.collected), b(T.paid), b(T.remit)],
      [T.tps, $(s.revenue.tps), $(s.expenses.tps), $$(s.tpsToRemit)],
      [T.tvq, $(s.revenue.tvq), $(s.expenses.tvq), $$(s.tvqToRemit)],
      [b(T.both), $$(s.revenue.tps + s.revenue.tvq), $$(s.expenses.tps + s.expenses.tvq), $$(s.tpsToRemit + s.tvqToRemit)],
      [],
      [T.revenue, $(s.revenue.subtotal)],
      [T.expenses, $(s.expenses.subtotal)],
      [b(T.profit), $$(s.profit)],
      [],
      [T.note]
    ]
  };
  return [revenue, expenses, taxes];
}

export function buildWorkbook(x: ExportInput): Uint8Array {
  return buildXlsx(workbookSheets(x), { title: `${x.labels.taxes.title} ${x.from} – ${x.to}`, author: x.company?.name });
}

/* ---------- CSV ---------- */
/** one CSV value: quoted when needed; text that a spreadsheet would run as a formula is kept as text */
export function csvCell(v: string | number | null | undefined, sep: string): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\n\r]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** cents as a CSV number: "1234.56" (en) or "1234,56" (fr, opened by Excel with « ; » as separator) */
export function csvMoney(c: Cents, lang: string): string {
  const s = (Math.abs(c) / 100).toFixed(2);
  return (c < 0 ? '-' : '') + (lang === 'en' ? s : s.replace('.', ','));
}
/** the period as one journal: revenue and expenses by date. French: « ; » and decimal comma (Excel in French). */
export function buildCsv(x: ExportInput, lang: string): string {
  const sep = lang === 'en' ? ',' : ';';
  const C = x.labels.csv;
  const lines: (string | number | null)[][] = [[C.day, C.type, C.number, C.name, C.category, C.description, C.subtotal, C.tps, C.tvq, C.total, C.method]];
  const all = [
    ...x.revenue.map((r) => ({ day: r.day, row: [r.day, C.revenue, r.number, r.customer, '', '', csvMoney(r.subtotal, lang), csvMoney(r.tps, lang), csvMoney(r.tvq, lang), csvMoney(r.total, lang), ''] })),
    ...x.expenses.map((e) => ({ day: e.day, row: [e.day, C.expense, '', e.vendor, e.category, e.description, csvMoney(e.subtotal, lang), csvMoney(e.tps, lang), csvMoney(e.tvq, lang), csvMoney(e.total, lang), e.method] }))
  ].sort((a, z) => a.day.localeCompare(z.day));
  for (const l of all) lines.push(l.row);
  // amounts are numbers for a spreadsheet: never prefixed, even when negative
  return '﻿' + lines.map((r, i) => r.map((v, j) => (i > 0 && j >= 6 && j <= 9 ? String(v) : csvCell(v, sep))).join(sep)).join('\r\n') + '\r\n';
}
