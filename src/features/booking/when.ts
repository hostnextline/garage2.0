/* Days and blocks in words, the way people say them on the phone: « Demain matin », « Ce soir », « Jeudi après-midi ».
   Shared by the block picker, the booking summary and the agenda (pure: the language and today are passed in). */
import { daysBetween, longDay, clockRange, parseDay, type BlockKey, type Day } from '../../lib/dates';
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
/** « Aujourd'hui », « Demain », « Hier », or '' */
export function relativeDay(day: Day, todayDay: Day, l: Lang): string {
  const diff = daysBetween(todayDay, day);
  if (diff === 0) return t('common.today', undefined, l);
  if (diff === 1) return t('common.tomorrow', undefined, l);
  if (diff === -1) return t('common.yesterday', undefined, l);
  return '';
}
