/* Cars in words: the engine line, the VIN read from a barcode, the odometer. */
import { cleanVin, vinCheck } from '../../lib/text';
import type { EngineRow } from './engineRef';

export interface EngineWords { turbo: string; hybrid: string; diesel: string }
const FR_WORDS: EngineWords = { turbo: 'turbo', hybrid: 'hybride', diesel: 'diesel' };
/** NHTSA sometimes sends the layout instead of the engine's name */
const LAYOUT = /^(in-?line|v-?shaped|w-?shaped|horizontally opposed.*|boxer|rotary|flat|straight)$/i;

/** "2.0 L 4 cyl. turbo (K20C2)" from what is known */
export function engineLine(e: { displacement?: number | null; cylinders?: number | null; turbo?: boolean | null; fuel?: string | null; code?: string | null }, words: EngineWords = FR_WORDS): string {
  const bits: string[] = [];
  if (e.displacement) bits.push(`${Number(e.displacement).toFixed(1)} L`);
  if (e.cylinders) bits.push(`${e.cylinders} cyl.`);
  if (e.turbo) bits.push(words.turbo);
  if (e.fuel === 'hybrid' || e.fuel === 'hybride') bits.push(words.hybrid);
  if (e.fuel === 'diesel') bits.push(words.diesel);
  const code = String(e.code || '').trim();
  if (code && /[A-Za-z]/.test(code) && code.length <= 16 && !LAYOUT.test(code) && !bits.join(' ').toLowerCase().includes(code.toLowerCase())) bits.push(`(${code})`);
  return bits.join(' ');
}
/** the engine's own name in a line of the list: « K20C2 », « LFX » (from « 3.6 V6 (LFX) »), « L2R / L3B » */
export function refCode(r: Pick<EngineRow, 'engine'>): string {
  const e = r.engine.trim();
  const m = /\(([^)]{2,14})\)/.exec(e);
  if (m) return m[1].trim();
  return /^[A-Z0-9-]{3,10}$/i.test(e) && /[A-Z]/i.test(e) && /\d/.test(e) ? e : '';
}
/** how a line of the engine list reads: "1.5 L 4 cyl. turbo (L15B7)" */
export function refLine(r: EngineRow, words: EngineWords = FR_WORDS): string {
  return engineLine({ displacement: r.displacement, cylinders: r.cylinders, turbo: r.turbo, fuel: r.fuel, code: refCode(r) }, words);
}

/** the VIN inside what a barcode reader saw: a door-jamb Code 39 often starts with an extra « I »; a QR code may hold more text */
export function vinFromCode(raw: string | null | undefined): { vin: string; ok: boolean } | null {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 17) return null;
  const tries: string[] = [];
  if (s.length === 18 && s[0] === 'I') tries.push(s.slice(1));
  for (let i = 0; i + 17 <= s.length; i++) tries.push(s.slice(i, i + 17));
  let fallback: string | null = null;
  for (const t of tries) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(t)) continue;
    if (vinCheck(t) === 'ok') return { vin: t, ok: true };
    fallback ??= t;
  }
  return fallback ? { vin: cleanVin(fallback), ok: false } : null;
}

/** "84 200 km" (fr) / "84,200 km" (en) */
export function km(n: number | null | undefined, lang: string): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return `${new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA').format(Number(n))} km`;
}
/** what was typed in a number field ("84 200", "84,200 km") → 84200 ; null when empty ; NaN when it is not a number */
export function parseKm(s: string): number | null {
  const d = String(s || '').replace(/km$/i, '').replace(/[\s.,  ]/g, '');
  if (!d) return null;
  if (!/^\d{1,7}$/.test(d)) return NaN;
  return Number(d);
}

/** an example number written the person's way: 2,0 (fr) / 2.0 (en) */
export function sampleNumber(n: number, digits: number, lang: string): string {
  return lang === 'en' ? n.toFixed(digits) : n.toFixed(digits).replace('.', ',');
}
