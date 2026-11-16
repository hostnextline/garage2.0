/* Phone numbers, postal codes, VINs, names: reading what people type and writing it back cleanly. */

/** 10 digits of a North American number, or null. "+1 (514) 555-1234" → "5145551234" */
export function phoneDigits(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return d;
}
/** "514 555-1234" (the Québec way) */
export function formatPhone(input: string | null | undefined): string {
  const d = phoneDigits(input);
  if (!d) return input ? String(input).trim() : '';
  return `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}`;
}
export function e164(input: string | null | undefined): string | null {
  const d = phoneDigits(input);
  return d ? `+1${d}` : null;
}

/** Canadian postal code "H4P 2B5" or null */
export function postalCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).toUpperCase().replace(/[\s-]/g, '');
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(s)) return null;
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}
/** finds a postal code inside a full address */
export function findPostal(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?-?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i.exec(address);
  return m ? postalCode(m[1] + m[2]) : null;
}
const PROV: Record<string, string> = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', X: 'NT', Y: 'YT' };
export function provinceOfPostal(pc: string | null | undefined): string | null {
  const p = postalCode(pc);
  return p ? PROV[p[0]] ?? null : null;
}

/** « 4521-4523 rue Fabre », « 12-14 rue Fabre » are one building with two door numbers (a duplex), not a unit and a door:
    same length, at most 20 apart. « 3-5 rue X » stays a unit and a door (too short to tell). The same rule as
    shared/places/address.ts, so both can become this one. */
export function isCivicRange(s: string): boolean {
  const m = /^\s*(\d{2,6})\s*-\s*(\d{2,6})\b/.exec(s);
  return !!m && m[1].length === m[2].length && Math.abs(Number(m[2]) - Number(m[1])) <= 20;
}

/* The words that announce a unit. A word only counts when it stands alone: « Logan », « Appleton », « Burton », « Bureau »
   or « Localité » are street names, not « log. an », « app. leton »… (core-data-05). */
const UNIT_WORD = '(?:appartement|appart\\.?|appt\\.?|app\\.?|apt\\.?|unité|unite|unit|suite|bureau|bur\\.?|local|logement|log\\.?)';
/* What a unit looks like: it starts with a digit (« 3 », « 3B », « 400 »), or is 1-2 letters then a digit (« PH2 », « A-3 »),
   or is ONE letter that ends its part of the address (« , unité A »). The end is Unicode-aware: JavaScript's \b takes « é »
   for a gap, which is how « Localité » used to lose « it ». */
const UNIT_VALUE = '(\\d[0-9A-Za-z-]{0,7}|[A-Za-z]{1,2}-?\\d[0-9A-Za-z-]{0,5}|[A-Za-z](?=\\s*(?:,|$)))(?![\\p{L}\\p{N}])';
// the keyword is followed by a space (optionally « # ») or directly by the number (« app3 »); « # » alone may touch the number
const UNIT_AFTER = new RegExp(`^(.*?)(?:[,\\s]+${UNIT_WORD}(?:\\s+#?\\s*|(?=\\d))|[,\\s]*#\\s*)${UNIT_VALUE}(.*)$`, 'iu');
const UNIT_PART = new RegExp(`^(?:${UNIT_WORD}(?:\\s+#?\\s*|(?=\\d))|#\\s*)${UNIT_VALUE}\\s*$`, 'iu');

/** one part of an address between commas is only a unit (« app. 3 », « #12 », « unité A »), not a town or a street */
export function isUnitPart(part: string): boolean { return UNIT_PART.test(String(part || '').trim()); }

/** "180-8255 av. Mountain Sights" → { unit: '180', line: '8255 av. Mountain Sights' } ; also "8255 Mountain Sights, app. 3".
    A civic range (« 4521-4523 rue Fabre ») has no unit. */
export function splitUnit(address: string): { unit: string | null; line: string } {
  const s = address.trim();
  if (isCivicRange(s)) return { unit: null, line: s };
  let m = /^([0-9A-Za-z]{1,6})\s*-\s*(\d{1,6}[A-Za-z]?\b.*)$/.exec(s);
  if (m && /\d/.test(m[1])) return { unit: m[1], line: m[2].trim() };
  m = UNIT_AFTER.exec(s);
  if (m) return { unit: m[2], line: (m[1] + ' ' + m[3]).replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim().replace(/,$/, '') };
  return { unit: null, line: s };
}
// an ordinal street name (« 58e Avenue », « 1re rue », « 3rd Street ») starts with digits but is not a door number
const ORDINAL = /^\s*\d{1,4}(?:e|er|re|ère|ème|eme|ieme|th|st|nd|rd)(?![\p{L}\p{N}])/iu;
/** the door number (« 3-1250 rue Graham » → 1250); for a civic range, the first one; none for « 58e Avenue » */
export function civicNumber(address: string): string | null {
  const line = splitUnit(address).line;
  if (ORDINAL.test(line)) return null;
  const m = /^\s*(\d{1,6}[A-Za-z]?)\b/.exec(line);
  return m ? m[1] : null;
}

/* ---------- VIN ---------- */
const TR: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9
};
const W = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** cleans a scanned or typed VIN: upper case, no spaces; O→0 and I/Q→1 are common misreads */
export function cleanVin(input: string | null | undefined): string {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IQ]/g, '1');
}
export function vinCheck(vin: string): 'ok' | 'bad' | 'invalid' {
  const v = cleanVin(vin);
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return 'invalid';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = v[i];
    const n = /\d/.test(c) ? Number(c) : TR[c];
    sum += n * W[i];
  }
  const r = sum % 11;
  const want = r === 10 ? 'X' : String(r);
  return v[8] === want ? 'ok' : 'bad';
}
/** model year from the 10th character (1980–2039 cycle; the 7th character tells which half) */
export function vinYear(vin: string): number | null {
  const v = cleanVin(vin);
  if (v.length !== 17) return null;
  const codes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const i = codes.indexOf(v[9]);
  if (i < 0) return null;
  const base = /[A-Z]/.test(v[6]) ? 2010 : 1980;
  return base + i;
}

/* ---------- words ---------- */
export function fold(s: string | null | undefined): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// a piece of the query made of digits and phone punctuation only: « 4243 », « 514-771 », « (514) »
const DIGITS_ONLY = /^[\d().+-]+$/;
/** every piece of the query is found (accents and case ignored, all of them). A piece of 3 digits or more is also found
    inside the digits of ONE field (« 5551 » in « 514 555-1234 »), never across two fields joined together; the words of
    the query still count (« tremblay 4243 » is not Bob Gagnon whose phone ends in 4243). */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const pieces = fold(query).split(/\s+/).filter(Boolean);
  if (!pieces.length) return true;
  const hay = fold(fields.filter(Boolean).join(' '));
  const fieldDigits = fields.map((f) => String(f || '').replace(/\D/g, '')).filter(Boolean);
  return pieces.every((p) => {
    if (hay.includes(p)) return true;
    const d = p.replace(/\D/g, '');
    return DIGITS_ONLY.test(p) && d.length >= 3 && fieldDigits.some((f) => f.includes(d));
  });
}
export function initials(name: string | null | undefined): string {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}
export function firstName(name: string | null | undefined): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}
export function fullName(first?: string | null, last?: string | null): string {
  return [first, last].map((x) => (x || '').trim()).filter(Boolean).join(' ');
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** folded text: no accents, lower case, no apostrophes (O’Neil = oneil) */
export const norm = (s: unknown): string => (s == null ? '' : fold(String(s)).replace(/['’`´]/g, ''));
/** letters and digits only (H3P 2C9 = h3p2c9, FLT-001 = flt001) */
export const squash = (s: unknown): string => norm(s).replace(/[^a-z0-9]/g, '');
