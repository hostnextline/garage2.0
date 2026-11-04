/* The garage's numbers for a month, as the server's dashboard(p_month) sends them, and what Hassan reads in them:
   revenue against the goal, per truck, the average ticket, the no-show rate, money per km driven, month to month. */
import type { Cents } from '../../lib/money';
import type { Day } from '../../lib/dates';
import { addMonths, daysInMonth, monthStart } from '../treasury/period';

export interface TruckRevenue { truck_id: string | null; revenue_cents: Cents; invoices: number }
export interface MonthRevenue { month: Day; revenue_cents: Cents }
export interface TopService { name: string; n: number }
export interface DashboardData {
  month: Day; revenue_cents: Cents; tps_cents: Cents; tvq_cents: Cents; invoices: number; avg_ticket_cents: Cents;
  collected_cents: Cents; receivable_cents: Cents; receivable_count: number; drafts: number;
  jobs_done: number; jobs_booked: number; jobs_cancelled: number; jobs_no_show: number; lost_cents: Cents; km: number; goal_cents: Cents | null;
  by_truck: TruckRevenue[]; months: MonthRevenue[]; top_services: TopService[];
}

const num = (x: unknown): number => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const int = (x: unknown): number => Math.round(num(x));
const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((r) => r && typeof r === 'object') as Record<string, unknown>[] : []);

/** the server's answer made safe to show: numbers are numbers, lists are lists, the six months are all there */
export function normalizeDashboard(raw: unknown, month: Day): DashboardData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const m = monthStart(month);
  const months = list(r.months).map((x) => ({ month: monthStart(String(x.month || '').slice(0, 10) || m), revenue_cents: int(x.revenue_cents) }));
  const full: MonthRevenue[] = [];
  for (let k = 5; k >= 0; k--) {
    const key = addMonths(m, -k);
    full.push({ month: key, revenue_cents: months.find((x) => x.month === key)?.revenue_cents ?? 0 });
  }
  const goal = r.goal_cents == null ? null : int(r.goal_cents);
  return {
    month: m,
    revenue_cents: int(r.revenue_cents), tps_cents: int(r.tps_cents), tvq_cents: int(r.tvq_cents), invoices: int(r.invoices), avg_ticket_cents: int(r.avg_ticket_cents),
    collected_cents: int(r.collected_cents), receivable_cents: int(r.receivable_cents), receivable_count: int(r.receivable_count), drafts: int(r.drafts),
    jobs_done: int(r.jobs_done), jobs_booked: int(r.jobs_booked), jobs_cancelled: int(r.jobs_cancelled), jobs_no_show: int(r.jobs_no_show),
    lost_cents: int(r.lost_cents), km: Math.max(0, num(r.km)), goal_cents: goal && goal > 0 ? goal : null,
    by_truck: list(r.by_truck).map((x) => ({ truck_id: x.truck_id == null ? null : String(x.truck_id), revenue_cents: int(x.revenue_cents), invoices: int(x.invoices) }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents),
    months: full,
    top_services: list(r.top_services).map((x) => ({ name: String(x.name ?? ''), n: int(x.n) })).filter((x) => x.name && x.n > 0)
  };
}

/** clients absent: no-shows out of the appointments that ended (done, no-show, cancelled); null when none ended */
export function noShowRate(d: Pick<DashboardData, 'jobs_done' | 'jobs_no_show' | 'jobs_cancelled'>): number | null {
  const n = d.jobs_done + d.jobs_no_show + d.jobs_cancelled;
  return n > 0 ? d.jobs_no_show / n : null;
}
/** money per km driven (cents per km) and km driven per 100 $ of revenue */
export function perKm(revenue: Cents, km: number): { centsPerKm: number | null; kmPer100: number | null } {
  return { centsPerKm: km > 0 ? revenue / km : null, kmPer100: km > 0 && revenue > 0 ? (km * 10000) / revenue : null };
}
/** 0.62 = 62 % of the goal; null without a goal */
export function goalShare(revenue: Cents, goal: Cents | null | undefined): number | null {
  return goal && goal > 0 ? revenue / goal : null;
}
/** the month in progress: what it would make at this pace (by calendar day); null for a closed month or too early */
export function projection(revenue: Cents, month: Day, today: Day): Cents | null {
  if (monthStart(month) !== monthStart(today)) return null;
  const day = Number(today.slice(8, 10));
  if (day < 3) return null;
  return Math.round((revenue / day) * daysInMonth(today));
}
/** the month before, and the change in percent (only for a closed month: a month in progress is not comparable) */
export function versusLastMonth(d: Pick<DashboardData, 'months' | 'month' | 'revenue_cents'>, today: Day): { prev: Cents | null; change: number | null } {
  const prevKey = addMonths(d.month, -1);
  const prev = d.months.find((m) => m.month === prevKey)?.revenue_cents ?? null;
  const closed = monthStart(d.month) < monthStart(today);
  return { prev, change: closed && prev && prev > 0 ? (d.revenue_cents - prev) / prev : null };
}
/** the share of each truck in the month's revenue */
export function truckShares(rows: TruckRevenue[]): (TruckRevenue & { share: number; avg: Cents })[] {
  const total = rows.reduce((n, r) => n + Math.max(0, r.revenue_cents), 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? Math.max(0, r.revenue_cents) / total : 0, avg: r.invoices > 0 ? Math.round(r.revenue_cents / r.invoices) : 0 }));
}
