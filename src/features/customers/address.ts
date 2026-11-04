/* Addresses as people paste and read them: the unit kept apart (« 180-8255 av. Mountain Sights »), the postal code
   found inside, the city, a one-line display, the directions link for the mechanic. */
import { splitUnit, findPostal, postalCode } from '../../lib/text';

export interface Pasted { line: string; unit: string | null; postal: string | null }

/** « 4521-4523 rue Fabre » is one building with two door numbers (a duplex), not a unit and a door */
export function isCivicRange(s: string): boolean {
  const m = /^\s*(\d{3,6})\s*-\s*(\d{3,6})\b/.exec(s);
  return !!m && m[1].length === m[2].length && Math.abs(Number(m[2]) - Number(m[1])) <= 20;
}
/** the unit kept apart (« 3-1250 rue Graham », « …, app. 3 »), but never inside a civic range */
export function unitApart(s: string): { unit: string | null; line: string } {
  return isCivicRange(s) ? { unit: null, line: s.trim() } : splitUnit(s);
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

/** the city of « 1250 rue Graham, Mont-Royal, QC H3P 2C9 » → « Mont-Royal » */
export function cityOf(address: string | null | undefined): string | null {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].replace(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?-?\d[ABCEGHJ-NPRSTV-Z]\d\b/i, '').trim();
    if (!p || /^(QC|ON|NB|NS|PE|NL|MB|SK|AB|BC|YT|NT|NU|Québec|Quebec|Ontario|Canada)$/i.test(p)) continue;
    if (/^\d/.test(p) || /^(app|appt|apt|unité|unite|unit|suite|bureau|local|#)/i.test(p)) continue;
    return p;
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
