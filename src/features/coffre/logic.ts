/* « Coffre » (family and friends, Part 20): pure parts of the screen, tested in logic.test.ts.
   - the server's report read safely, and which entry the owner may take back out;
   - the report the accountant exports apart (Excel and CSV): one line per entry, the totals.
   Which jobs can go in the Coffre together is a garage rule: domain/money/coffre.ts. */
import type { Cents } from '../../lib/money';
import type { Day } from '../../lib/dates';
import { buildXlsx, type Cell, type SheetDef } from '../../shared/export/xlsx';
import { csvFile, type CsvValue } from '../../shared/export/exports';

export interface CoffreEntry {
  /** 'received': what family and friends gave; 'purchase': stock bought with Coffre money (customer = the item) */
  kind: 'received' | 'purchase';
  id: string; day: Day; customer: string; customer_id: string | null; amount_cents: Cents; value_cents: Cents;
  note: string | null; job_numbers: number[]; job_ids: string[]; work: string; by: string | null;
}
export interface CoffreReport { from: Day; to: Day; rows: CoffreEntry[]; count: number; amount_cents: Cents; value_cents: Cents;
  /** spent on stock in the period; what is in the Coffre now (all time) */
  spent_cents: Cents; balance_cents: Cents;
  /** what the Coffre's own stock is worth, at cost (no taxes) */
  stock_cents: Cents }

/** « Retirer » (owner only) is for money received. A purchase also put stock in the Coffre: coffre_remove would give
    the money back and leave the stock bought, so a purchase is never taken out from this screen. */
export function mayRemoveEntry(e: Pick<CoffreEntry, 'kind'>, owner: boolean): boolean {
  return owner && e.kind === 'received';
}

const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
/** reads the server's answer safely */
export function normalizeCoffre(raw: unknown, from: Day, to: Day): CoffreReport {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rows = (Array.isArray(a.rows) ? a.rows : []).map((r0) => {
    const r = r0 as Record<string, unknown>;
    return {
      kind: (r.kind === 'purchase' ? 'purchase' : 'received') as CoffreEntry['kind'],
      id: String(r.id ?? ''), day: String(r.day ?? ''), customer: String(r.customer ?? '—'), customer_id: r.customer_id ? String(r.customer_id) : null,
      amount_cents: num(r.amount_cents), value_cents: num(r.value_cents), note: r.note ? String(r.note) : null,
      job_numbers: Array.isArray(r.job_numbers) ? r.job_numbers.map(num) : [], job_ids: Array.isArray(r.job_ids) ? r.job_ids.map(String) : [],
      work: String(r.work ?? ''), by: r.by ? String(r.by) : null
    };
  });
  const received = rows.filter((r) => r.kind === 'received').reduce((n, r) => n + r.amount_cents, 0);
  const spent = rows.filter((r) => r.kind === 'purchase').reduce((n, r) => n + r.amount_cents, 0);
  return { from, to, rows, count: rows.length, amount_cents: received, value_cents: rows.reduce((n, r) => n + r.value_cents, 0),
    spent_cents: spent, balance_cents: a.balance_cents != null ? num(a.balance_cents) : received - spent, stock_cents: num(a.stock_cents) };
}

export interface CoffreLabels {
  sheet: string; title: string; period: string; day: string; customer: string; jobs: string; work: string; value: string; amount: string; note: string; by: string; total: string;
}
/** money in the Coffre is +, stock bought with it is − */
const signedOf = (x: Pick<CoffreEntry, 'kind' | 'amount_cents'>): Cents => (x.kind === 'purchase' ? -x.amount_cents : x.amount_cents);
const $ = (c: Cents) => ({ v: c / 100, s: 'money' as const });
const $$ = (c: Cents) => ({ v: c / 100, s: 'boldMoney' as const });
const b = (s: string) => ({ v: s, s: 'bold' as const });

export function coffreSheet(r: CoffreReport, L: CoffreLabels): SheetDef {
  const rows: Cell[][] = [
    [b(L.title)], [`${L.period} ${r.from} – ${r.to}`], [],
    [b(L.day), b(L.customer), b(L.jobs), b(L.work), b(L.value), b(L.amount), b(L.note), b(L.by)],
    ...r.rows.map((x): Cell[] => [{ v: x.day, s: 'date' }, x.customer, x.job_numbers.join(', '), x.work, $(x.value_cents), $(signedOf(x)), x.note || '', x.by || '']),
    [b(L.total), null, String(r.count), null, $$(r.value_cents), $$(r.amount_cents - r.spent_cents), null, null]
  ];
  return { name: L.sheet, rows, widths: [12, 26, 12, 40, 16, 16, 30, 14], freezeHeader: false };
}
export function coffreWorkbook(r: CoffreReport, L: CoffreLabels): Uint8Array { return buildXlsx([coffreSheet(r, L)], { title: L.title }); }
export function coffreCsv(r: CoffreReport, L: CoffreLabels, lang: string): string {
  const m = (cents: Cents) => ({ cents });
  return csvFile([
    [L.day, L.customer, L.jobs, L.work, L.value, L.amount, L.note, L.by],
    ...r.rows.map((x): CsvValue[] => [x.day, x.customer, x.job_numbers.join(' '), x.work, m(x.value_cents), m(signedOf(x)), x.note || '', x.by || '']),
    [L.total, '', String(r.count), '', m(r.value_cents), m(r.amount_cents - r.spent_cents), '', '']
  ], lang);
}
