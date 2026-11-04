/* Finding a customer the way people type it on the phone: part of a name (accents, case and order ignored), phone
   digits in any format, street, postal code, plate, VIN, car. Phone digits are compared with the phone alone, so the
   end of a number never matches digits glued across two fields (lib/text `matches` joins them). */
import { fold } from '../../lib/text';
import type { Customer, Vehicle } from '../../data/types';

type CustomerLike = Pick<Customer, 'first_name' | 'last_name' | 'company' | 'phone' | 'email' | 'address' | 'unit' | 'city' | 'postal_code'>;
type VehicleLike = Pick<Vehicle, 'year' | 'make' | 'model' | 'trim' | 'plate' | 'vin' | 'color'>;

/** folded text: no accents, lower case, no apostrophes (O’Neil = oneil) */
export const norm = (s: unknown): string => (s == null ? '' : fold(String(s)).replace(/['’`´]/g, ''));
/** letters and digits only (H3P 2C9 = h3p2c9, FLT-001 = flt001) */
export const squash = (s: unknown): string => norm(s).replace(/[^a-z0-9]/g, '');
const digitsOf = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

export interface SearchDoc {
  /** every searchable field, folded, separated by spaces */
  text: string;
  /** the phone's digits */
  phone: string;
  /** the words of the name and the company (for « starts with ») */
  names: string[];
}

export function searchDoc(c: CustomerLike, cars: VehicleLike[] = []): SearchDoc {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const bits: unknown[] = [name, squash(name), c.company, c.email, c.phone, c.address, c.unit, c.city, c.postal_code, squash(c.postal_code)];
  for (const v of cars) bits.push(v.year, v.make, v.model, squash(v.model), v.trim, v.plate, squash(v.plate), v.vin, v.color);
  return {
    text: bits.filter((x) => x != null && x !== '').map(norm).join(' '),
    phone: digitsOf(c.phone),
    names: norm(`${name} ${c.company || ''}`).split(/[\s-]+/).filter(Boolean)
  };
}

export function queryWords(q: string): string[] { return norm(q).split(/\s+/).filter(Boolean); }
/** only digits and the signs of a phone number: "514 555-0141", "(514) 555", "+1 514" */
export function isNumberQuery(q: string): boolean { return /\d/.test(q) && /^[\d\s().+-]+$/.test(q.trim()); }
function queryDigits(q: string): string {
  const d = digitsOf(q);
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}

export function docMatches(doc: SearchDoc, q: string): boolean {
  const words = queryWords(q);
  if (!words.length) return true;
  if (isNumberQuery(q)) {
    const qd = queryDigits(q);
    if (qd.length >= 3 && doc.phone.includes(qd)) return true;
  }
  return words.every((w) => {
    if (doc.text.includes(w)) return true;
    const wd = digitsOf(w);
    return wd.length >= 3 && /^[\d().+-]+$/.test(w) && doc.phone.includes(wd);
  });
}

/** 0: the phone, the name or the company starts with what was typed; 1: found somewhere else */
export function rank(doc: SearchDoc, q: string): number {
  const words = queryWords(q);
  if (!words.length) return 1;
  if (isNumberQuery(q)) {
    const qd = queryDigits(q);
    return qd.length >= 3 && doc.phone.includes(qd) ? 0 : 1;
  }
  const first = words[0];
  return doc.names.some((n) => n.startsWith(first)) || norm(doc.names.join(' ')).startsWith(norm(q)) ? 0 : 1;
}

export interface Ranked<T> { item: T; rank: number }
/** the items that match, best first. `items` come already in their order (recent, A–Z), which is kept between items
    of the same rank; `tie` may give another order. */
export function searchList<T>(items: T[], q: string, docOf: (x: T) => SearchDoc | undefined, tie?: (a: T, b: T) => number, byRank = true): T[] {
  const words = queryWords(q);
  if (!words.length) return tie ? items.slice().sort(tie) : items;
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const d = docOf(item);
    if (d && docMatches(d, q)) out.push({ item, rank: byRank ? rank(d, q) : 0 });
  }
  return out.sort((a, b) => a.rank - b.rank || (tie ? tie(a.item, b.item) : 0)).map((x) => x.item);
}

/** what was typed in a search, split for a new customer's form: a phone number, a first and a last name */
export function draftFromQuery(q: string): { first_name: string; last_name: string; phone: string } {
  const s = q.trim();
  const phoneMatch = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.exec(s);
  let phone = '';
  let rest = s;
  if (phoneMatch && digitsOf(phoneMatch[1]).length >= 10) { phone = phoneMatch[1].trim(); rest = s.replace(phoneMatch[1], ' '); }
  else if (isNumberQuery(s)) { phone = s; rest = ''; }
  const words = rest.replace(/[^\p{L}\s'’-]/gu, ' ').split(/\s+/).filter(Boolean).map(cap);
  return { first_name: words[0] || '', last_name: words.slice(1).join(' '), phone };
}
/** "julie" → "Julie", "marc-andré" → "Marc-André"; a name already written with capitals is kept */
export function cap(w: string): string {
  if (/[A-ZÀ-Ý]/.test(w)) return w;
  return w.replace(/(^|[-'’\s])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
