/* The dashboard's words for months and estimates. */
import { money } from '../../lib/money';
import { parseDay } from '../../lib/dates';

const mf = new Map<string, Intl.DateTimeFormat>();
/** « novembre 2026 », « nov. » : the month of a first day, long or short, with the year when asked */
export function monthWord(first: string, l: string, style: 'long' | 'short', withYear = false): string {
  const k = `${l}${style}${withYear}`;
  let f = mf.get(k);
  if (!f) { f = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', withYear ? { month: style, year: 'numeric' } : { month: style }); mf.set(k, f); }
  return f.format(parseDay(first));
}
/** an estimate or a goal reads in whole dollars */
export const dollars = (c: number, l: string) => money(Math.round(c / 100) * 100, l, { whole: true });
