/* « Réserver en ligne »: the pure part (what is chosen, the total, the checks of the form, the answers of the server). */
import { phoneDigits } from '../lib/text';
import { totals } from '../lib/money';
import type { CLang } from './i18n';
import type { Suggestion } from '../features/customers/photon';
import { wantedOf, sameStreet, sameTown, streetWords } from '../features/customers/locate';

export interface WebService {
  id: string; name_fr: string; name_en: string; category: string; price_cents: number | null; taxable?: boolean; duration_min: number;
  promo: boolean; promo_until: string | null; includes: { fr?: string; en?: string }[] | null;
}
export interface WebBlock { key: string; start: number; end: number }
export interface WebInfo { ok: true; garage: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null }; on: boolean;
  services: WebService[]; blocks: WebBlock[]; taxes: boolean; horizon_days: number }
export interface WebSlot { day: string; block: string; near: boolean }
export interface Booked { ok: true; link: string | null; day: string; block: string; text: string }

export type Step = 'services' | 'address' | 'slots' | 'contact' | 'done';
export const STEPS: Step[] = ['services', 'address', 'slots', 'contact'];
export function stepNumber(s: Step): number { return Math.max(1, STEPS.indexOf(s) + 1); }
export interface Place { address: string; unit: string; postal_code: string | null; city: string | null; lat: number; lng: number; exact: boolean }

/* ---------- the steps in the phone's history (back gesture = previous step, never out of the page) ---------- */
export interface Progress { ids: string[]; place: boolean; slot: boolean }
/** the furthest step the customer may stand on, given what is chosen (a reload or « back » never skips a step) */
export function reachable(step: Step, p: Progress): Step {
  if (step === 'done') return 'services';
  let max = 0;
  if (p.ids.length) max = 1;
  if (p.ids.length && p.place) max = 2;
  if (p.ids.length && p.place && p.slot) max = 3;
  return STEPS[Math.max(0, Math.min(STEPS.indexOf(step), max))];
}
/** client.html#reserver[&l=en][&etape=N] */
export function stepHash(step: Step, l: CLang | null): string {
  const parts = ['reserver'];
  if (l === 'en') parts.push('l=en');
  if (step !== 'services' && step !== 'done') parts.push(`etape=${stepNumber(step)}`);
  return '#' + parts.join('&');
}

/* ---------- what was typed, kept on this phone for the tab (a switch to Messages and back does not start over) ---------- */
export interface Draft { ids: string[]; place: Place | null; contact: Contact }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const DRAFT = 'his.book.draft';
const DRAFT_KEEP = 2 * 3600 * 1000;
const store = (): Store | null => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } };
export function saveDraft(d: Draft, s: Store | null = store(), now = Date.now()) {
  try {
    if (!d.ids.length && !d.place) s?.removeItem(DRAFT);
    else s?.setItem(DRAFT, JSON.stringify({ ...d, at: now }));
  } catch { /* private mode, full storage: the page still works */ }
}
export function loadDraft(s: Store | null = store(), now = Date.now()): Draft | null {
  try {
    const v = JSON.parse(s?.getItem(DRAFT) || 'null') as (Partial<Draft> & { at?: number }) | null;
    if (!v || typeof v.at !== 'number' || now - v.at > DRAFT_KEEP) return null;
    const place = v.place && typeof v.place === 'object' && typeof v.place.lat === 'number' && typeof v.place.lng === 'number' && typeof v.place.address === 'string' ? v.place : null;
    const ids = Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
    const contact = { ...EMPTY_CONTACT, ...Object.fromEntries(Object.entries(v.contact || {}).filter(([k, x]) => k in EMPTY_CONTACT && typeof x === 'string')) } as Contact;
    return { ids, place, contact };
  } catch { return null; }
}
export function clearDraft(s: Store | null = store()) { try { s?.removeItem(DRAFT); } catch { /* ignore */ } }

export function serviceName(s: WebService, l: CLang): string { return (l === 'en' ? s.name_en : s.name_fr) || s.name_fr; }

/** the minutes of the work chosen (as the server counts them: 15 min to 8 h) */
export function chosenMinutes(all: WebService[], ids: string[]): number {
  const m = all.filter((s) => ids.includes(s.id)).reduce((t, s) => t + (s.duration_min || 0), 0);
  return Math.max(15, Math.min(480, m || 60));
}
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
  if (code === 'block_full' || code === 'bad_block') return 'slots';
  if (code === 'far') return 'address';
  if (code === 'no_service') return 'services';
  if (['name', 'phone', 'email'].includes(code)) return 'contact';
  return null;
}
/** the words of a refusal (codes the page knows, else « a problem on our side ») */
export function errorKey(code: string): string {
  if (code === 'block_full' || code === 'bad_block') return 'book.slots.taken';
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
/** the slots of a new page added to the list, without twice the same */
export function mergeSlots(a: WebSlot[], b: WebSlot[]): WebSlot[] {
  const seen = new Set(a.map((s) => `${s.day}|${s.block}`));
  return [...a, ...b.filter((s) => !seen.has(`${s.day}|${s.block}`))];
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
