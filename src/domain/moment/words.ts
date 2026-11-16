/* Days and blocks in words, the way people say them on the phone: « Demain matin », « Ce soir », « Jeudi après-midi ».
   Shared by the block picker, the booking summary and the agenda (pure: the language and today are passed in). */
import { daysBetween, longDay, clock, clockRange, parseDay, type BlockKey, type Day, type Range, mergeRanges, duration } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const low = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** « Ce matin », « Demain soir », « Jeudi après-midi », « Jeudi 19 novembre, matin » (capitalized, for a title) */
export function blockPhrase(day: Day, block: BlockKey, todayDay: Day, l: Lang): string {
  const diff = daysBetween(todayDay, day);
  if (diff === 0) return t(`booking.when.today.${block}`, undefined, l);
  if (diff === 1) return t(`booking.when.tomorrow.${block}`, undefined, l);
  if (diff === -1) return t(`booking.when.yesterday.${block}`, undefined, l);
  const part = t(`booking.when.block.${block}`, undefined, l);
  if (diff >= 2 && diff <= 6) {
    const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' }).format(parseDay(day));
    return cap(t('booking.when.weekday', { day: wd, block: part }, l));
  }
  return cap(t('booking.when.date', { day: longDay(day, l), block: part }, l));
}
/** the same inside a sentence: « de mardi matin à ce soir » */
export function blockPhraseLower(day: Day, block: BlockKey, todayDay: Day, l: Lang): string {
  const s = blockPhrase(day, block, todayDay, l);
  // English weekdays and months keep their capital
  return l === 'en' && !/^(This|Tomorrow|Yesterday)\b/.test(s) ? s : low(s);
}
/** « Demain matin, 8 h à 12 h » */
export function blockPhraseWithHours(day: Day, block: BlockKey, start: number, end: number, todayDay: Day, l: Lang): string {
  return `${blockPhrase(day, block, todayDay, l)}, ${clockRange(start, end, l)}`;
}
/** « 29 novembre » / « November 29 » (the year when it is not this year's) */
export function dayMonth(day: Day, l: Lang, todayDay?: Day): string {
  const d = parseDay(day);
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (todayDay && day.slice(0, 4) !== todayDay.slice(0, 4)) o.year = 'numeric';
  const s = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', o).format(d);
  return l === 'fr' ? s.replace(/^1 /, '1er ') : s;
}
/** the two ends of a span of days, the month said once when it is the same: { from: '4', to: '17 novembre' } (fr), { from: 'November 4', to: '17' } (en) */
export function spanEnds(a: Day, z: Day, l: Lang, todayDay?: Day): { from: string; to: string } {
  const same = a.slice(0, 7) === z.slice(0, 7);
  const num = (x: Day) => { const n = parseDay(x).getDate(); return l === 'fr' && n === 1 ? '1er' : String(n); };
  if (!same) return { from: dayMonth(a, l, todayDay), to: dayMonth(z, l, todayDay) };
  return l === 'en' ? { from: dayMonth(a, l, todayDay), to: num(z) } : { from: num(a), to: dayMonth(z, l, todayDay) };
}
/** « Aujourd'hui », « Demain », « Hier », or '' */
export function relativeDay(day: Day, todayDay: Day, l: Lang): string {
  const diff = daysBetween(todayDay, day);
  if (diff === 0) return t('common.today', undefined, l);
  if (diff === 1) return t('common.tomorrow', undefined, l);
  if (diff === -1) return t('common.yesterday', undefined, l);
  return '';
}

/** « Plages d'arrivée »: « Demain, entre 14 h et 18 h » / « Jeudi 19 novembre, entre 9 h et 13 h » (capitalized, for a title).
    `win` null: a flexible booking, « Demain, dans la journée (plage confirmée la veille) ». */
export function windowPhrase(day: Day, win: [number, number] | null, todayDay: Day, l: Lang): string {
  const diff = daysBetween(todayDay, day);
  const d = diff >= 2 && diff <= 6 ? new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' }).format(parseDay(day)) : (relativeDay(day, todayDay, l) || longDay(day, l));
  return `${cap(d)}, ${windowWords(win, l)}`;
}
/** « entre 14 h et 18 h » (null: « dans la journée (plage confirmée la veille) ») */
export function windowWords(win: [number, number] | null, l: Lang): string {
  return win ? t('common.window.between', { from: clock(win[0], l), to: clock(win[1], l) }, l) : t('common.window.flex', undefined, l);
}

/* Hours in words: « 8 h à 12 h et 13 h à 20 h », « Fermé », « Mardi et samedi ». */
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

/** « 2 h 08 », « 45 min » — short enough for a small cell, in both languages */
export function shortDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
/** « 1 h 20 de libre », « Complet », « Complet, 20 min de trop », « Ne travaille plus dans ce bloc » */
export function freeWords(used: number, cap: number, l: Lang, short = false, wholeDay = false): string {
  if (cap <= 0) return used > 0 ? t(wholeDay ? 'agenda.lane.offShiftDay' : 'agenda.lane.offShift', undefined, l) : t('agenda.lane.closed', undefined, l);
  const left = cap - used;
  const d = (x: number) => (short ? shortDuration(x) : duration(x, l));
  if (left > 0) return t('agenda.lane.free', { d: d(left) }, l);
  if (left === 0 || short) return t('agenda.lane.full', undefined, l);
  return t('agenda.lane.over', { d: d(-left) }, l);
}
