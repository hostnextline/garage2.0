/* « Réserver en ligne »: the pure part (what is chosen, the total, the checks of the form, the answers of the server). */
import { phoneDigits } from '../../lib/text';
import { totals } from '../../lib/money';
import { ct, type CLang } from '../i18n';
import { slotText } from '../format';
import type { Suggestion } from '../../shared/places/photon';
import { wantedOf, sameStreet, sameTown, streetWords } from '../../shared/places/locate';

export interface WebService {
  id: string; name_fr: string; name_en: string; category: string; price_cents: number | null; taxable?: boolean; duration_min: number;
  promo: boolean; promo_until: string | null; includes: { fr?: string; en?: string }[] | null;
}
export interface WebBlock { key: string; start: number; end: number }
export interface WebInfo { ok: true; garage: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null }; on: boolean;
  services: WebService[]; blocks: WebBlock[]; taxes: boolean; horizon_days: number;
  /** « Plages d’arrivée »: the garage books 4-hour windows instead of blocks */
  windows?: boolean }
/** a moment offered: a block of a day, or (block 'day') a day with its 4-hour window; `flex`: the customer is free all day */
export interface WebSlot { day: string; block: string; near: boolean; win_start?: number | null; win_end?: number | null; flex?: boolean }
export interface Booked { ok: true; link: string | null; day: string; block: string; text: string; win_start?: number | null; win_end?: number | null; flex?: boolean }

/** the address chosen in the list: the position comes with it (the mechanic needs it, the moments are counted from it) */
export interface Place { address: string; unit: string; postal_code: string | null; city: string | null; lat: number; lng: number; exact: boolean }
/** a suggestion of the address search as a place to book (null without a position: it cannot be chosen) */
export function placeOf(s: Suggestion): Place | null {
  if (s.place.lat == null || s.place.lng == null) return null;
  return { address: [s.label, s.sub].filter(Boolean).join(', '), unit: s.place.unit || '', postal_code: s.place.postal_code, city: s.place.city ?? null,
    lat: s.place.lat, lng: s.place.lng, exact: s.exact };
}

export type Step = 'services' | 'address' | 'slots' | 'contact' | 'done';
export const STEPS: Step[] = ['services', 'address', 'slots', 'contact'];
export function stepNumber(s: Step): number { return Math.max(1, STEPS.indexOf(s) + 1); }

export function serviceName(s: WebService, l: CLang): string { return (l === 'en' ? s.name_en : s.name_fr) || s.name_fr; }

/** the expected total with taxes, and whether some work is priced by the hour (not in the total) */
export function chosenTotal(all: WebService[], ids: string[], taxes = true): { total: number; hourly: boolean; any: boolean } {
  const picked = all.filter((s) => ids.includes(s.id));
  const priced = picked.filter((s) => s.price_cents != null);
  const t = totals(priced.map((s) => ({ qty: 1, unitCents: s.price_cents!, taxable: s.taxable !== false })));
  return { total: taxes ? t.total : t.subtotal, hourly: picked.some((s) => s.price_cents == null), any: priced.length > 0 };
}
export function toggle(ids: string[], id: string): string[] { return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; }

export interface Contact { first: string; last: string; phone: string; email: string; year: string; make: string; model: string; problem: string }
export const EMPTY_CONTACT: Contact = { first: '', last: '', phone: '', email: '', year: '', make: '', model: '', problem: '' };
export type ContactErrors = Partial<Record<'first' | 'phone' | 'email' | 'make' | 'model', string>>;
/** the keys of the words to show under each field that is not right (empty: all good) */
export function contactErrors(c: Contact): ContactErrors {
  const e: ContactErrors = {};
  if (!c.first.trim()) e.first = 'errFirst';
  if (!phoneDigits(c.phone)) e.phone = 'errPhone';
  if (c.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) e.email = 'errEmail';
  if (!c.make.trim()) e.make = 'errMake';
  if (!c.model.trim()) e.model = 'errModel';
  return e;
}
/** the years offered: next year down to 1980 */
export function years(now: Date = new Date()): number[] {
  const y = now.getFullYear() + 1;
  return Array.from({ length: y - 1980 + 1 }, (_, i) => y - i);
}

/** where a refusal of the server sends the customer back */
export function stepOfError(code: string): Step | null {
  if (code === 'block_full' || code === 'bad_block' || code === 'window_full') return 'slots';
  if (code === 'far') return 'address';
  if (code === 'no_service') return 'services';
  if (['name', 'phone', 'email'].includes(code)) return 'contact';
  return null;
}
/** the words of a refusal (codes the page knows, else « a problem on our side ») */
export function errorKey(code: string): string {
  if (code === 'block_full' || code === 'bad_block') return 'book.slots.taken';
  // the window can no longer be kept: the step is shown again with the windows still open
  if (code === 'window_full') return 'book.slots.windowTaken';
  if (['far', 'too_many', 'busy', 'network'].includes(code)) return `book.errors.${code}`;
  if (code === 'phone') return 'book.contact.errPhone';
  if (code === 'name') return 'book.contact.errFirst';
  if (code === 'email') return 'book.contact.errEmail';
  if (code === 'no_service') return 'book.services.none';
  return 'book.errors.server';
}

/** the day after the last day asked: « Voir d'autres dates » asks the next days */
export function nextFrom(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return dt.toISOString().slice(0, 10);
}
/** the days asked at a time (« Voir d'autres dates »: the next ones) */
export const PAGE_DAYS = 14;
/** a page that starts after the garage's horizon (`info.horizon_days`, 120 days) has nothing to offer */
export function pastHorizon(from: string, today: string, horizonDays: number | null | undefined): boolean {
  return from > nextFrom(today, Math.max(PAGE_DAYS, Number(horizonDays) || 120));
}
/** where the next page starts, and whether to look further by itself: a later fortnight with nothing free (holidays,
    two full weeks) is not the end of the calendar, so the page skips it, a few at a time (the server counts each ask) */
export function afterPage(asked: string | null, got: number, today: string, horizonDays: number | null | undefined, skipped: number, maxSkips: number):
  { next: string; again: boolean; end: boolean } {
  const next = nextFrom(asked || today, PAGE_DAYS);
  const over = pastHorizon(next, today, horizonDays);
  const again = !!asked && got === 0 && !over && skipped < maxSkips;
  return { next, again, end: !!asked && got === 0 && over };
}
/** the slots of a new page added to the list, without twice the same */
export function mergeSlots(a: WebSlot[], b: WebSlot[]): WebSlot[] {
  const seen = new Set(a.map(slotKey));
  return [...a, ...b.filter((s) => !seen.has(slotKey(s)))];
}

/* ---------- « Plages d’arrivée » ---------- */
/** what tells two moments apart: the day and the block, and the window's start for a 'day' moment */
export function slotKey(s: WebSlot): string { return `${s.day}|${s.block}${s.block === 'day' && s.win_start != null ? `|${s.win_start}` : ''}`; }
/** does the page offer windows? (the garage's switch, or the moments themselves) */
export function windowMode(info: Pick<WebInfo, 'windows'> | null | undefined, slots: WebSlot[] | null | undefined): boolean {
  return info?.windows === true || (slots || []).some((s) => s.block === 'day');
}
export interface DayOffer { day: string; near: boolean; best: WebSlot; others: WebSlot[] }
/** the windows by day, in the order received (the first of a day is its best; the others are « Voir d’autres heures ») */
export function dayOffers(slots: WebSlot[]): DayOffer[] {
  const out: DayOffer[] = [];
  for (const s of slots) {
    const d = out.find((x) => x.day === s.day);
    if (!d) out.push({ day: s.day, near: s.near, best: s, others: [] });
    else if (slotKey(s) !== slotKey(d.best) && !d.others.some((o) => slotKey(o) === slotKey(s))) d.others.push(s);
  }
  return out;
}
/** the same day, the customer free all day (no window: it is confirmed the day before) */
export function flexSlot(s: WebSlot): WebSlot { return { day: s.day, block: 'day', near: s.near, flex: true }; }
/** the window of a moment, null for a block and for a flexible one */
export function slotWindow(s: { block: string; win_start?: number | null; win_end?: number | null; flex?: boolean }): [number, number] | null {
  return s.block === 'day' && !s.flex && s.win_start != null && s.win_end != null ? [s.win_start, s.win_end] : null;
}
/** what « book » is sent for the moment chosen: a block as always; a window (the server sets its end); or flexible */
export function bookWhen(s: WebSlot): { day: string; block: string; win_start?: number; win_flex?: true } {
  if (s.block !== 'day') return { day: s.day, block: s.block };
  const w = slotWindow(s);
  return w ? { day: s.day, block: 'day', win_start: w[0] } : { day: s.day, block: 'day', win_flex: true };
}

/** only the places on the street typed, with a position (Photon may answer another street with the same number:
    « 1250 rue Graham » → « 1250 rue Jean-Talon »; the mechanic must never go there) */
export function onTypedStreet(list: Suggestion[], typed: string): Suggestion[] {
  const w = wantedOf(typed);
  let out = list.filter((s) => s.place.lat != null && s.place.lng != null && (!w.street || sameStreet(w.street, s.street || s.label)));
  // a town or a postal code typed: one of them must agree
  if (w.city || w.fsa) out = out.filter((s) => (!!w.city && s.areas.some((a) => sameTown(a, w.city))) || (!!w.fsa && (s.place.postal_code || '').toUpperCase().startsWith(w.fsa)));
  // the street exactly as typed wins over a longer name (« Graham » before « Graham-Bell »)
  const key = streetWords(w.street).join(' ');
  const exact = out.filter((s) => streetWords(s.street || s.label).join(' ') === key);
  return exact.length ? exact : out;
}

/** the hours of a moment: « Entre 12 h et 16 h » (a block's hours or a window), « Dans la journée » (flexible) */
export function whenWords(x: { block: string; win_start?: number | null; win_end?: number | null; flex?: boolean }, blocks: WebBlock[], l: CLang): string {
  if (x.block === 'day') {
    const w = slotWindow(x);
    return (w && slotText(w[0], w[1], l)) || ct(l, 'flex');
  }
  const b = blocks.find((k) => k.key === x.block);
  return (b && slotText(b.start, b.end, l)) || ct(l, `blocks.${x.block}`);
}
/** the moment the server kept for a booking: its window; the moment chosen when an older server does not say; none
    (flexible) */
export function bookedWhen(done: Booked, chosen: WebSlot | null): { block: string; win_start?: number | null; win_end?: number | null; flex?: boolean } {
  if (done.block !== 'day') return done;
  if (done.win_start != null && done.win_end != null) return { block: 'day', win_start: done.win_start, win_end: done.win_end };
  if (done.flex === undefined && chosen && slotWindow(chosen)) return chosen;
  return { block: 'day', flex: true };
}
