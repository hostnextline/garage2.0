/* The names of the weekdays in the window (« dim », « lundi »): one date formatter per language and style, made once,
   not once per pane at every pointer move while painting. Pure. */
import { parseDay } from '../../lib/dates';

// a Sunday, to name the weekdays
const SUNDAY = '2026-11-01';
const names = new Map<string, string[]>();

export function weekdayName(d: number, l: string, style: 'long' | 'short' = 'long'): string {
  const k = `${l === 'en' ? 'en' : 'fr'}|${style}`;
  let list = names.get(k);
  if (!list) {
    const f = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: style });
    list = Array.from({ length: 7 }, (_, i) => { const day = parseDay(SUNDAY); day.setDate(day.getDate() + i); return f.format(day).replace('.', ''); });
    names.set(k, list);
  }
  return list[((d % 7) + 7) % 7];
}
