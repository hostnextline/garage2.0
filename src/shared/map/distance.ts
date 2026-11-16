/* The road in words: « 23,5 » km, « 1 h 05 », as each language writes numbers. Pure; one formatter per language. */
import { lang, type Lang } from '../../lib/i18n';

/** « 23,5 » km (one decimal under 10 km) */
export const kmText = (km: number, l: Lang = lang.value) => { const x = km.toFixed(km < 10 ? 1 : 0); return l === 'en' ? x : x.replace('.', ','); };
/** « 36 min », « 1 h 05 » */
export const durText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
const KM = new Map<string, Intl.NumberFormat>();
/** the km of a trip, as the person's language writes numbers */
export function fmtKm(km: number, l: Lang = lang.value): string {
  let f = KM.get(l);
  if (!f) { f = new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }); KM.set(l, f); }
  return f.format(km);
}
