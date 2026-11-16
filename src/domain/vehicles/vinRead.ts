/* Finding a VIN in what a machine read: a barcode (door-jamb sticker) or the text of a photo (windshield, registration).
   A VIN carries a check digit (9th character) that a random reading passes 1 time in 11. So a reading is « sure »
   only when it is a whole word of exactly 17 characters that passes as read, and nothing else in the reading does;
   anything found by sliding over glued words, or by changing letters until the check digit fits, is only « doubtful »:
   the person compares it with the plate and taps « Garder ce NIV ». The old reader returned such guesses as sure, and
   they were saved without a word (customers-b-01: a different, valid-looking VIN on 1 misread in 4). */
import { vinCheck } from '../../lib/text';

/** why a reading is doubtful: its check digit does not match (a car from outside North America, or a misread);
    it was repaired by changing one look-alike character; several readings fit */
export type VinDoubt = 'check' | 'repaired' | 'several';
export interface VinRead { vin: string; ok: boolean; why?: VinDoubt }

const LEGAL = /^[A-HJ-NPR-Z0-9]{17}$/;
/** letters a VIN never has, and what OCR meant by them: O and Q are 0, I is 1 */
const FIX: Record<string, string> = { O: '0', Q: '0', I: '1' };
const fixed = (s: string) => s.toUpperCase().split('').map((c) => FIX[c] || c).join('');
/** look-alikes OCR swaps: tried, one at a time, when the check digit says the reading is wrong */
const SWAP: Record<string, string[]> = {
  '0': ['D', '8'], D: ['0'], '1': ['L', 'T', '7'], L: ['1'], T: ['1', '7'], '7': ['T', '1'], '5': ['S'], S: ['5'], '8': ['B', '0'], B: ['8'],
  '2': ['Z'], Z: ['2'], '6': ['G'], G: ['6'], U: ['V'], V: ['U'], '4': ['A'], A: ['4'], '3': ['8'], M: ['N'], N: ['M'], K: ['X'], X: ['K']
};
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/** how much a 17-character reading looks like a real VIN (the check digit counts most) */
export function vinScore(v: string): number {
  let s = 0;
  if (vinCheck(v) === 'ok') s += 10;
  if (YEAR_CODES.includes(v[9])) s += 2;
  if (/^\d{4}$/.test(v.slice(13))) s += 2;
  if (/[1-5JKLSVWYZ39]/.test(v[0])) s += 1;
  if (/[A-Z]/.test(v.slice(0, 3)) || /^\d[A-Z]/.test(v)) s += 1;
  return s;
}
/** a reading that fails its check digit is offered only when it still looks like a VIN (year code, serial digits…):
    a line of a receipt is not shown as « NIV lu » */
const WEAK = 3;

/** every reading with exactly one look-alike character changed that passes the check digit */
function repairs(w: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i < 17; i++) for (const a of SWAP[w[i]] || []) {
    const one = w.slice(0, i) + a + w.slice(i + 1);
    if (vinCheck(one) === 'ok') out.add(one);
  }
  return [...out];
}

/** decides on the candidates found: sure, doubtful, or nothing */
function judge(cands: string[]): VinRead | null {
  const list = [...new Set(cands.filter((c) => LEGAL.test(c)))];
  if (!list.length) return null;
  const passing = list.filter((c) => vinCheck(c) === 'ok');
  if (passing.length === 1) return { vin: passing[0], ok: true };
  if (passing.length > 1) return { vin: passing.sort((a, b) => vinScore(b) - vinScore(a))[0], ok: false, why: 'several' };
  const repaired = [...new Set(list.flatMap(repairs))];
  if (repaired.length === 1) return { vin: repaired[0], ok: false, why: 'repaired' };
  const best = list.sort((a, b) => vinScore(b) - vinScore(a))[0];
  return vinScore(best) >= WEAK ? { vin: best, ok: false, why: 'check' } : null;
}

/** the label words that may come before a VIN on its line (« VIN: », « NIV », « No de série ») */
const LABEL = /^(?:V\.?I\.?N\.?|N\.?I\.?V\.?|NO|N°|SERIAL|SERIE|SÉRIE|DE|NUMBER|NUMÉRO|NUMERO)$/i;

/** the VIN in the text read from a photo. Candidates: each word of exactly 17 characters, and a line whose letters and
    digits make exactly 17 once its label is left out (a VIN cut by a space: « 1HGCM826 33A004352 »). Never a window
    slid over glued words or glued lines. */
export function findVin(text: string): VinRead | null {
  const cands: string[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const words = line.split(/[^A-Za-z0-9]+/).filter(Boolean);
    for (const w of words) if (w.length === 17) cands.push(fixed(w));
    let start = 0;
    while (start < words.length && LABEL.test(words[start])) start++;
    const joined = words.slice(start).join('');
    if (joined.length === 17 && words.length - start > 1) cands.push(fixed(joined));
  }
  return judge(cands);
}

/** the VIN in what a barcode reader saw. A door-jamb Code 39 often starts with an extra « I »; a QR code or a long
    Code 128 may hold other fields: only a field of exactly 17 characters (or 18 with that « I ») can be sure. A VIN
    inside a longer run of characters is at most doubtful. */
export function vinFromCode(raw: string | null | undefined): { vin: string; ok: boolean } | null {
  const fields = String(raw || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const whole: string[] = [];
  for (const f of fields) {
    if (f.length === 17) whole.push(f);
    else if (f.length === 18 && f[0] === 'I') whole.push(f.slice(1));
  }
  const legal = whole.filter((w) => LEGAL.test(w));
  const passing = [...new Set(legal.filter((w) => vinCheck(w) === 'ok'))];
  if (passing.length === 1) return { vin: passing[0], ok: true };
  if (passing.length > 1) return { vin: passing[0], ok: false };
  if (legal.length) return { vin: legal[0], ok: false };
  // no field of the right length: a VIN glued to other characters, offered only when exactly one window passes
  const windows = new Set<string>();
  for (const f of fields) for (let i = 0; i + 17 <= f.length; i++) {
    const w = f.slice(i, i + 17);
    if (LEGAL.test(w) && vinCheck(w) === 'ok') windows.add(w);
  }
  return windows.size === 1 ? { vin: [...windows][0], ok: false } : null;
}
