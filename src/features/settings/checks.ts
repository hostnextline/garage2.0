/* The checks and number formats the settings forms share (pure, checks.test.ts). */
import { t } from '../../lib/i18n';

/** « Entre 10 et 120. » when a number is missing or out of range; null when fine */
export function rangeError(v: number | null | undefined, min: number, max: number): string | null {
  if (v == null || !Number.isFinite(v)) return t('settings.needNumber');
  if (v < min || v > max) return t('settings.between', { min, max });
  return null;
}
/** a limit that 0 switches off (the garde-route): 0, or a number in the range */
export function limitError(v: number | null | undefined, min: number, max: number): string | null {
  if (v === 0) return null;
  if (v == null || !Number.isFinite(v) || v < min || v > max) return t('settings.zeroOrBetween', { min, max });
  return null;
}

/** a number as the person reads it (« 1,5 » in French); empty for nothing */
export const fmtNum = (v: number | null | undefined, l: string) => (v == null || !Number.isFinite(v) ? '' : l === 'en' ? String(v) : String(v).replace('.', ','));
/** what was typed: null when empty, NaN when it is not a number (comma or point, spaces ignored) */
export function parseNum(s: string): number | null {
  const x = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!x) return null;
  return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : Number.NaN;
}
