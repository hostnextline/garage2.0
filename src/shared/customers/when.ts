/* When a customer's appointment is, in words: « Demain matin », « ven. 7, soir », « Rendez-vous demain, entre 14 h et
   18 h », « Dernière visite : 6 avr. ». Pure words (no drawing), tested in when.test.ts. */
import { t, lang } from '../../lib/i18n';
import { today, daysBetween, type BlockKey } from '../../lib/dates';
import { windowWords } from '../../domain/moment/words';
import { dayWord, dayInline } from '../../domain/moment/dayWords';

/** the window told to the customer of a job booked by arrival window (block 'day'); none yet (« flexible »): null */
type WinPart = { win_start?: number | null; win_end?: number | null; win_flex?: boolean };
const winOf = (w?: WinPart | null): [number, number] | null => (w && w.win_start != null && w.win_end != null ? [w.win_start, w.win_end] : null);

/** « Ce matin », « Demain après-midi », « ven. 7, soir », « 12 nov., matin »;
    a job booked by arrival window (`win`: the job): « Demain, entre 14 h et 18 h » */
export function whenText(day: string, block: BlockKey, win?: WinPart | null, now = today()): string {
  const n = daysBetween(now, day);
  if (block === 'day') return t('customers.when.day', { day: dayWord(day), window: windowWords(winOf(win), lang.value) });
  if (n === 0) return t(`customers.when.today.${block}`);
  if (n === 1) return t(`customers.when.tomorrow.${block}`);
  return t(`customers.when.other.${block}`, { day: dayWord(day) });
}
/** « Rendez-vous demain matin », « Rendez-vous le ven. 7, soir »; by arrival window: « Rendez-vous demain, entre 14 h et 18 h » */
export function nextLine(day: string, block: BlockKey, win?: WinPart | null, now = today()): string {
  const n = daysBetween(now, day);
  if (block === 'day') return t(n === 0 || n === 1 ? 'customers.whenLine.day.near' : 'customers.whenLine.day.other', { day: dayInline(day), window: windowWords(winOf(win), lang.value) });
  if (n === 0) return t(`customers.whenLine.today.${block}`);
  if (n === 1) return t(`customers.whenLine.tomorrow.${block}`);
  return t(`customers.whenLine.other.${block}`, { day: dayInline(day) });
}
/** « Dernière visite : 6 avr. » */
export function lastLine(day: string): string { return t('customers.whenLine.last', { day: dayInline(day) }); }
