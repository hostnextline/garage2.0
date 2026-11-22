/* A day or a timestamp in a word or two, in the person's language: « Aujourd’hui », « Hier », « mer. 4 », « 4 nov. ». */
import { lang, t } from '../../lib/i18n';
import { parseDay, daysBetween, today, tinyDay, dayOf } from '../../lib/dates';

const fmt = new Map<string, Intl.DateTimeFormat>();
function df(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = lang.value + JSON.stringify(o);
  let f = fmt.get(k);
  if (!f) { f = new Intl.DateTimeFormat(lang.value === 'en' ? 'en-CA' : 'fr-CA', o); fmt.set(k, f); }
  return f;
}
/** « 4 nov. » this year, « 4 nov. 2025 » another year (the garage's year, Montréal: never the phone's zone, R169) */
export function dateShort(day: string): string {
  const d = parseDay(day);
  return df(day.slice(0, 4) === today().slice(0, 4) ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}
/** « Aujourd’hui », « Hier », « Demain », « mer. 4 » this week, else « 4 nov. » */
export function dayWord(day: string): string {
  const n = daysBetween(today(), day);
  if (n === 0) return t('common.today');
  if (n === -1) return t('common.yesterday');
  if (n === 1) return t('common.tomorrow');
  if (Math.abs(n) <= 6) return tinyDay(day, lang.value);
  return dateShort(day);
}
/** the garage's day (Montréal) of a timestamp ('YYYY-MM-DD'), or null: the same day on every phone, whatever its zone (R169) */
export function dayOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return dayOf(d) || null;
}
/** inside a sentence: « hier », « demain », « ven. 7 », « 4 nov. » */
export function dayInline(day: string): string {
  const n = daysBetween(today(), day);
  const w = dayWord(day);
  return Math.abs(n) <= 1 ? w.toLowerCase() : w;
}
/** a timestamp as a day: « Aujourd’hui », « Hier », else « 4 nov. »; `inline`: inside a sentence (« aujourd’hui ») */
export function stampDay(iso: string | null | undefined, inline = false): string {
  const day = dayOfIso(iso);
  if (!day) return '';
  if (Math.abs(daysBetween(today(), day)) > 1) return dateShort(day);
  return inline ? dayWord(day).toLowerCase() : dayWord(day);
}
