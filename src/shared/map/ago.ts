/* « il y a 2 min », « hier », « le 2 nov. 2026 »: how long ago something was seen (a position, a sign-in). */
import { t, lang } from '../../lib/i18n';
import { addDays, dayOf, shortDate, today } from '../../lib/dates';

export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const min = Math.floor((now - at) / 60000);
  if (min < 1) return t('map.ago.now');
  if (min < 60) return t('map.ago.min', { n: min });
  const day = dayOf(new Date(at));
  if (day === today(new Date(now))) return t('map.ago.hours', { n: Math.floor(min / 60) });
  if (day === addDays(today(new Date(now)), -1)) return t('map.ago.yesterday');
  return t('map.ago.on', { date: shortDate(day, lang.value) });
}
/** minutes since a moment (null when unknown) */
export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60000)) : null;
}
