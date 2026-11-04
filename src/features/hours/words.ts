/* Hours in words: « 8 h à 12 h et 13 h à 20 h », « Fermé », « Mardi et samedi ». */
import { clock, clockRange, mergeRanges, parseDay, type Range } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';

const LF = new Map<string, Intl.ListFormat>();
/** « a, b et c » / « a, b, and c » */
export function listWords(items: string[], l: Lang): string {
  if (items.length < 2) return items[0] || '';
  const k = l;
  let f = LF.get(k);
  if (!f) { f = new Intl.ListFormat(l === 'en' ? 'en-CA' : 'fr-CA', { style: 'long', type: 'conjunction' }); LF.set(k, f); }
  return f.format(items);
}
/** the hours of a day; short: « 8 h–12 h, 13 h–20 h » for a narrow column */
export function rangesWords(rs: Range[], l: Lang, short = false): string {
  const m = mergeRanges(rs || []);
  if (!m.length) return t('hours.grid.closed', undefined, l);
  if (short) return m.map(([a, b]) => `${clock(a, l)}–${clock(b, l)}`).join(', ');
  return listWords(m.map(([a, b]) => clockRange(a, b, l)), l);
}
/** weekdays (0 = Sunday) in words, the first one capitalized: « Mardi et samedi » */
export function weekdaysWords(dows: number[], l: Lang): string {
  const sunday = parseDay('2026-11-01');
  const name = (d: number) => { const x = new Date(sunday); x.setDate(sunday.getDate() + d); return new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' }).format(x); };
  const s = listWords([...dows].sort((a, b) => a - b).map(name), l);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
