/* The server's treasury_report(p_from, p_to), made safe to show. Money in cents. */
import type { Cents } from '../../lib/money';
import type { Day } from '../../lib/dates';

export interface ReportPart { subtotal: Cents; tps: Cents; tvq: Cents; total: Cents; count: number }
export interface TreasuryReport {
  from: Day; to: Day; revenue: ReportPart; expenses: ReportPart;
  by_category: { category: string; total: Cents; subtotal: Cents; n: number }[];
  collected: { method: string; total: Cents; n: number }[];
  profit: Cents; tps_to_remit: Cents; tvq_to_remit: Cents;
}
const int = (x: unknown) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? n : 0; };
const obj = (x: unknown) => (x && typeof x === 'object' ? x as Record<string, unknown> : {});
const list = (x: unknown) => (Array.isArray(x) ? x.map(obj) : []);
function part(x: unknown): ReportPart {
  const o = obj(x);
  return { subtotal: int(o.subtotal), tps: int(o.tps), tvq: int(o.tvq), total: int(o.total), count: int(o.count) };
}
export function normalizeReport(raw: unknown, from: Day, to: Day): TreasuryReport {
  const r = obj(raw);
  const revenue = part(r.revenue), expenses = part(r.expenses);
  return {
    from: String(r.from || from).slice(0, 10), to: String(r.to || to).slice(0, 10), revenue, expenses,
    by_category: list(r.by_category).map((c) => ({ category: String(c.category ?? ''), total: int(c.total), subtotal: int(c.subtotal), n: int(c.n) }))
      .sort((a, b) => b.subtotal - a.subtotal || a.category.localeCompare(b.category)),
    collected: list(r.collected).map((c) => ({ method: String(c.method ?? 'other'), total: int(c.total), n: int(c.n) })).sort((a, b) => b.total - a.total),
    // recomputed from the parts when missing, so the three numbers always agree with the lines shown
    profit: r.profit == null ? revenue.subtotal - expenses.subtotal : int(r.profit),
    tps_to_remit: r.tps_to_remit == null ? revenue.tps - expenses.tps : int(r.tps_to_remit),
    tvq_to_remit: r.tvq_to_remit == null ? revenue.tvq - expenses.tvq : int(r.tvq_to_remit)
  };
}
