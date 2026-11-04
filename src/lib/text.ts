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

/** "180-8255 av. Mountain Sights" → { unit: '180', civic: '8255', rest } ; also "8255 Mountain Sights, app. 3" */
export function splitUnit(address: string): { unit: string | null; line: string } {
  const s = address.trim();
  let m = /^([0-9A-Za-z]{1,6})\s*-\s*(\d{1,6}[A-Za-z]?\b.*)$/.exec(s);
  if (m && /\d/.test(m[1])) return { unit: m[1], line: m[2].trim() };
  m = /^(.*?)[,\s]+(?:app\.?|appt\.?|apt\.?|appartement|unité|unite|unit|suite|bureau|bur\.?|local|logement|log\.?|#)\s*([0-9A-Za-z-]{1,8})\b(.*)$/i.exec(s);
  if (m) return { unit: m[2], line: (m[1] + ' ' + m[3]).replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim().replace(/,$/, '') };
  return { unit: null, line: s };
}
export function civicNumber(address: string): string | null {
  const m = /^\s*(\d{1,6}[A-Za-z]?)\b/.exec(splitUnit(address).line);
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
/** every word of the query is found in the haystack (accents and case ignored) */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(fields.filter(Boolean).join(' '));
  const qd = query.replace(/\D/g, '');
  if (qd.length >= 3) {
    const hd = fields.filter(Boolean).join(' ').replace(/\D/g, '');
    if (hd.includes(qd)) return true;
  }
  return words.every((w) => hay.includes(w));
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
