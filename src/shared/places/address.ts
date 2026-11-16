/* Addresses as people paste and read them: the unit kept apart (« 180-8255 av. Mountain Sights »), the postal code
   found inside, the door number, the city, a one-line display, the directions link for the mechanic.
   No drawing and no network here: the customer page uses it too. */
import { findPostal, postalCode } from '../../lib/text';

export interface Pasted { line: string; unit: string | null; postal: string | null }

/** « 4521-4523 rue Fabre », « 12-14 rue Fabre » are one building with two door numbers (a duplex), not a unit and a door.
    The two numbers have the same length and are close; « 3-5 rue X » stays a unit and a door (too short to tell). */
export function isCivicRange(s: string): boolean {
  const m = /^\s*(\d{2,6})\s*-\s*(\d{2,6})\b/.exec(s);
  return !!m && m[1].length === m[2].length && Math.abs(Number(m[2]) - Number(m[1])) <= 20;
}

/* The words that announce a unit. Each must be a whole word (never the start of « Logan », « Appleton », « Bureau »,
   « Burnside »…), followed by a space or directly by the number (« app3 »). « # » alone may touch the number. */
const UNIT_WORD = '(?:appartement|appart\\.?|appt\\.?|app\\.?|apt\\.?|unité|unite|unit|suite|bureau|bur\\.?|local|logement|log\\.?)';
/* The unit itself: starts with a digit (« 3 », « 3B », « 400 »), or one or two letters then a digit (« PH2 », « A-3 »),
   or a single letter that ends its part (« , unité A »). The end is checked with Unicode letters: JavaScript's \b takes
   « é » for a non-letter, which is how « rue Localité » used to lose its end. */
const UNIT_AFTER = new RegExp(
  `^(.*?)(?:[,\\s]+${UNIT_WORD}(?:\\s+#?\\s*|(?=\\d))|[,\\s]*#\\s*)(\\d[0-9A-Za-z-]{0,7}|[A-Za-z]{1,2}-?\\d[0-9A-Za-z-]{0,5}|[A-Za-z](?=\\s*(?:,|$)))(?![\\p{L}\\p{N}])(.*)$`,
  'iu'
);
/** « 3-1250 rue Graham »: the unit written before the door number (Canada Post) */
const UNIT_BEFORE = /^([0-9A-Za-z]{1,6})\s*-\s*(\d{1,6}[A-Za-z]?\b.*)$/;

/** the unit kept apart (« 3-1250 rue Graham », « …, app. 3 », « bureau 400 », « #12 »), never inside a duplex, never out
    of a street name */
export function unitApart(address: string): { unit: string | null; line: string } {
  const s = String(address || '').trim();
  if (isCivicRange(s)) return { unit: null, line: s };
  const before = UNIT_BEFORE.exec(s);
  if (before && /\d/.test(before[1])) return { unit: before[1], line: before[2].trim() };
  const after = UNIT_AFTER.exec(s);
  if (after) {
    const line = `${after[1]} ${after[3]}`.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim().replace(/,$/, '');
    return { unit: after[2], line };
  }
  return { unit: null, line: s };
}

/** an ordinal street name (« 58e Avenue », « 1re rue », « 3rd Street ») is not a door number */
const ORDINAL = /^\d{1,4}(?:e|er|re|ère|ème|eme|ieme|th|st|nd|rd)\b/i;
/** the door number of « 3-1250 rue Graham » → « 1250 »; of « 4521-4523 rue Fabre » → « 4521 »; none for « 58e Avenue » */
export function civicOf(address: string | null | undefined): string | null {
  const line = unitApart(String(address || '')).line;
  if (ORDINAL.test(line)) return null;
  const m = /^\s*(\d{1,6}[A-Za-z]?)\b/.exec(line);
  return m ? m[1] : null;
}

/** a pasted address (often from a text or an e-mail, on two lines) → the street line, the unit, the postal code */
export function splitPasted(input: string): Pasted {
  const one = String(input || '')
    .replace(/\r?\n+/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  const postal = findPostal(one);
  const { unit, line } = unitApart(one);
  return { line, unit, postal };
}

/** the provinces as they end an address part (« Montréal QC », « Laval, Québec ») */
const PROVINCE_WORDS = '(?:QC|ON|NB|NS|PE|NL|MB|SK|AB|BC|YT|NT|NU|Québec|Quebec|Ontario|Canada)';
const ONLY_PROVINCE = new RegExp(`^${PROVINCE_WORDS}$`, 'i');
const TRAILING_PROVINCE = new RegExp(`[\\s,]+${PROVINCE_WORDS}$`, 'i');
const POSTAL_INSIDE = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?-?\d[ABCEGHJ-NPRSTV-Z]\d\b/i;
/** the city of « 1250 rue Graham, Mont-Royal, QC H3P 2C9 » → « Mont-Royal »; of « …, Montréal QC H2L 3C1 » → « Montréal » */
export function cityOf(address: string | null | undefined): string | null {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].replace(POSTAL_INSIDE, '').trim();
    if (!p || ONLY_PROVINCE.test(p)) continue;
    if (/^\d/.test(p) || /^(app|appt|apt|unité|unite|unit|suite|bureau|local|#)/i.test(p)) continue;
    return p.replace(TRAILING_PROVINCE, '').trim() || null;
  }
  return null;
}

/** « 3-1250 rue Graham, Mont-Royal, QC H3P 2C9 »: the unit before the door number (Canada Post), the postal code once */
export function oneLine(a: { address?: string | null; unit?: string | null; postal_code?: string | null }, unitWord = 'app.'): string {
  let line = String(a.address || '').trim();
  if (!line) return '';
  const unit = String(a.unit || '').trim();
  if (unit) line = /^\d/.test(line) ? `${unit}-${line}` : `${line}, ${unitWord} ${unit}`;
  const pc = postalCode(a.postal_code);
  if (pc && !findPostal(line)) line = `${line} ${pc}`;
  return line;
}

/** Google Maps directions to the door: the position when known, else the address */
export function directionsUrl(a: { lat?: number | null; lng?: number | null; address?: string | null; unit?: string | null; postal_code?: string | null }): string | null {
  if (a.lat != null && a.lng != null && Number.isFinite(a.lat) && Number.isFinite(a.lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`;
  }
  const text = oneLine({ address: a.address, postal_code: a.postal_code });
  return text ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}` : null;
}
