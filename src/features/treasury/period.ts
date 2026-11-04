/* The periods of the treasury report (this month, last month, this quarter, this year, chosen dates) and the
   month arithmetic the dashboard shares. Days are local calendar days 'YYYY-MM-DD'. */
import { addDays, isValidDay, shortDate, type Day } from '../../lib/dates';

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
