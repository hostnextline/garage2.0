/* Small pure helpers of the customer's page: the time slot, the day, money lines, phone links, local clock times. */
import { clock, longDay, today, addDays, TZ, type Day } from '../lib/dates';
import { money } from '../lib/money';
import { e164, formatPhone } from '../lib/text';
import { ct, type CLang } from './i18n';

/** a clock time that never breaks across two lines (« 12 h 40 », « 4 p.m. ») */
export function nbClock(min: number, l: CLang): string { return clock(min, l).replace(/ /g, '\u00a0'); }

/** « Entre 12 h et 16 h » / « Between 12 p.m. and 4 p.m. » (null when the slot is unknown) */
export function slotText(start: number | null | undefined, end: number | null | undefined, l: CLang): string | null {
  if (start == null || end == null) return null;
  return ct(l, 'between', { from: nbClock(start, l), to: nbClock(end, l) });
}

/** « Jeudi 5 novembre » (the year is added when it is not this year) */
export function dayTitle(day: Day, l: CLang, now: Date = new Date()): string {
  const s = longDay(day, l, now);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 'today' | 'tomorrow' | null */
export function relDay(day: Day, now: Date = new Date()): 'today' | 'tomorrow' | null {
  const t = today(now);
  if (day === t) return 'today';
  if (day === addDays(t, 1)) return 'tomorrow';
  return null;
}

export function cad(cents: number | null | undefined, l: CLang): string { return money(cents ?? 0, l); }

export interface LineLike { qty?: number | string | null; unit_cents?: number | null; total_cents?: number | null; kind?: string | null }
/** what a line is worth before taxes (a discount counts down) */
export function lineCents(x: LineLike): number {
  if (typeof x.total_cents === 'number' && Number.isFinite(x.total_cents)) return x.total_cents;
  const unit = Number(x.unit_cents || 0);
  const v = Math.round(Number(x.qty ?? 1) * Math.abs(unit));
  return x.kind === 'discount' || unit < 0 ? -v : v;
}
/** « 2 × 45,00 $ » when there is more than one, else null */
export function qtyText(x: LineLike, l: CLang): string | null {
  const q = Number(x.qty ?? 1);
  if (!Number.isFinite(q) || q === 1) return null;
  const qs = Number.isInteger(q) ? String(q) : (l === 'en' ? String(q) : String(q).replace('.', ','));
  return ct(l, 'work.qty', { qty: qs, price: money(Math.abs(Number(x.unit_cents || 0)), l) });
}

/** tel: link of a North American number (null when it is not one) */
export function telHref(phone: string | null | undefined): string | null {
  const n = e164(phone);
  return n ? `tel:${n}` : null;
}
export function phoneText(phone: string | null | undefined): string { return formatPhone(phone); }

/** minutes after midnight, Montréal time, of a moment (the garage's clock, whatever the phone's time zone) */
export function localMinuteOf(iso: string | number | Date, tz: string = TZ): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
    const h = Number(p.find((x) => x.type === 'hour')?.value || 0), m = Number(p.find((x) => x.type === 'minute')?.value || 0);
    return (h % 24) * 60 + m;
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
}
/** the calendar day, Montréal time, of a moment ('YYYY-MM-DD') */
export function localDayOf(iso: string | number | Date, tz: string = TZ): Day | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return null;
  }
}
/** « 12 h 40 » / « 12:40 p.m. » of a moment */
export function clockOf(iso: string | number | Date | null | undefined, l: CLang): string | null {
  if (iso == null) return null;
  const m = localMinuteOf(iso);
  return m == null ? null : nbClock(m, l);
}
