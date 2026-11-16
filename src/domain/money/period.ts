/* The periods money is looked at by. Days are local calendar days 'YYYY-MM-DD'.
   - The treasury report's periods: whole months, quarters, years, chosen dates (PeriodKey, periodRange), and the
     month arithmetic the dashboard shares. addMonths here gives the FIRST day of that month; lib/dates' addMonths
     keeps the same day of the month: the two are not interchangeable.
   - The filter of « Factures » (ListPeriod, listPeriodRange): « up to today », not whole periods. */
import { addDays, dayOf, isValidDay, shortDate, type Day } from '../../lib/dates';

export type PeriodKey = 'month' | 'last_month' | 'quarter' | 'year' | 'custom';
export const PERIODS: PeriodKey[] = ['month', 'last_month', 'quarter', 'year', 'custom'];
export interface DayRange { from: Day; to: Day }

const pad = (n: number) => String(n).padStart(2, '0');

/** '2026-11-17' → '2026-11-01' */
export function monthStart(day: Day): Day { return `${day.slice(0, 7)}-01`; }
/** the first day of the month `n` months after the month of `day` (n may be negative) */
export function addMonths(day: Day, n: number): Day {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}-01`;
}
/** '2024-02-10' → '2024-02-29' */
export function monthEnd(day: Day): Day { return addDays(addMonths(day, 1), -1); }
export function daysInMonth(day: Day): number { return Number(monthEnd(day).slice(8, 10)); }
/** '2026-11' from a day or a month key; null when it is not one */
export function monthKey(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(s || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}`;
}

export function isPeriod(x: unknown): x is PeriodKey { return PERIODS.includes(x as PeriodKey); }

/** the days a period covers, `ref` being today */
export function periodRange(key: PeriodKey, ref: Day, custom?: Partial<DayRange>): DayRange {
  switch (key) {
    case 'last_month': {
      const s = addMonths(ref, -1);
      return { from: s, to: monthEnd(s) };
    }
    case 'quarter': {
      const q = Math.floor((Number(ref.slice(5, 7)) - 1) / 3);
      const s = `${ref.slice(0, 4)}-${pad(q * 3 + 1)}-01`;
      return { from: s, to: monthEnd(addMonths(s, 2)) };
    }
    case 'year':
      return { from: `${ref.slice(0, 4)}-01-01`, to: `${ref.slice(0, 4)}-12-31` };
    case 'custom': {
      const a = isValidDay(custom?.from) ? custom!.from! : null;
      const b = isValidDay(custom?.to) ? custom!.to! : null;
      if (a && b) return a <= b ? { from: a, to: b } : { from: b, to: a };
      if (a) return { from: a, to: a > ref ? a : ref };
      if (b) return { from: monthStart(b), to: b };
      return { from: monthStart(ref), to: monthEnd(ref) };
    }
    default:
      return { from: monthStart(ref), to: monthEnd(ref) };
  }
}

export function inRange(day: string | null | undefined, r: DayRange): boolean {
  return !!day && day >= r.from && day <= r.to;
}

/** "1 nov. 2026 au 30 nov. 2026" / "Nov 1, 2026 to Nov 30, 2026" */
export function rangeLabel(r: DayRange, lang: string): string {
  if (r.from === r.to) return shortDate(r.from, lang);
  return lang === 'en' ? `${shortDate(r.from, 'en')} to ${shortDate(r.to, 'en')}` : `${shortDate(r.from, 'fr')} au ${shortDate(r.to, 'fr')}`;
}

/* ---------- the filter of « Factures »: up to today ---------- */
export type ListPeriod = 'all' | '30d' | 'month' | 'last' | 'year';
export const LIST_PERIODS: ListPeriod[] = ['all', '30d', 'month', 'last', 'year'];
/** the days of a period of the invoice list (inclusive), or null for « Toutes les dates » */
export function listPeriodRange(p: ListPeriod, today: Day): [Day, Day] | null {
  const ym = today.slice(0, 7);
  switch (p) {
    case '30d': return [addDays(today, -29), today];
    case 'month': return [`${ym}-01`, today];
    case 'last': { const end = addDays(`${ym}-01`, -1); return [`${end.slice(0, 7)}-01`, end]; }
    case 'year': return [`${today.slice(0, 4)}-01-01`, today];
    default: return null;
  }
}
/** is this moment (an ISO time) inside the list's period */
export function inListPeriod(iso: string | null | undefined, range: [Day, Day] | null): boolean {
  if (!range) return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = dayOf(d);
  return day >= range[0] && day <= range[1];
}
