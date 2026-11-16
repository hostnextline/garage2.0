/* Small pieces the customer screens share: the flags in words, « Demain matin », the plate badge, car names. */
import type { ComponentChildren } from 'preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { today, daysBetween, type BlockKey } from '../../lib/dates';
import { windowWords } from '../../domain/moment/words';
import type { Customer } from '../../data/types';
import { Pill } from '../../ui';
import { dayWord, dayInline } from '../../domain/moment/dayWords';

/** the window told to the customer of a job booked by arrival window (block 'day'); none yet (« flexible »): null */
export type WinPart = { win_start?: number | null; win_end?: number | null; win_flex?: boolean };
const winOf = (w?: WinPart | null): [number, number] | null => (w && w.win_start != null && w.win_end != null ? [w.win_start, w.win_end] : null);
/** « Ce matin », « Demain après-midi », « ven. 7, soir », « 12 nov., matin »;
    a job booked by arrival window (`win`: the job): « Demain, entre 14 h et 18 h » */
export function whenText(day: string, block: BlockKey, win?: WinPart | null): string {
  const n = daysBetween(today(), day);
  if (block === 'day') return t('customers.when.day', { day: dayWord(day), window: windowWords(winOf(win), lang.value) });
  if (n === 0) return t(`customers.when.today.${block}`);
  if (n === 1) return t(`customers.when.tomorrow.${block}`);
  return t(`customers.when.other.${block}`, { day: dayWord(day) });
}
/** « Rendez-vous demain matin », « Rendez-vous le ven. 7, soir »; by arrival window: « Rendez-vous demain, entre 14 h et 18 h » */
export function nextLine(day: string, block: BlockKey, win?: WinPart | null): string {
  const n = daysBetween(today(), day);
  if (block === 'day') return t(n === 0 || n === 1 ? 'customers.whenLine.day.near' : 'customers.whenLine.day.other', { day: dayInline(day), window: windowWords(winOf(win), lang.value) });
  if (n === 0) return t(`customers.whenLine.today.${block}`);
  if (n === 1) return t(`customers.whenLine.tomorrow.${block}`);
  return t(`customers.whenLine.other.${block}`, { day: dayInline(day) });
}
/** « Dernière visite : 6 avr. » */
export function lastLine(day: string): string { return t('customers.whenLine.last', { day: dayInline(day) }); }

export function Flags(p: { c: Pick<Customer, 'no_shows' | 'card_on_file' | 'lang' | 'sms_ok'>; owed?: number; noSms?: boolean; class?: string }) {
  const out: ComponentChildren[] = [];
  if (p.c.no_shows > 0) out.push(<Pill key="ns" tone="bad" dot={false}>{t('customers.flags.noShow', { n: p.c.no_shows })}</Pill>);
  if (p.owed && p.owed > 0) out.push(<Pill key="ow" tone="unpaid" dot={false}>{t('customers.flags.owes', { amount: money(p.owed, lang.value) })}</Pill>);
  if (p.c.card_on_file) out.push(<Pill key="cd" tone="ok" dot={false}>{t('customers.flags.card')}</Pill>);
  if (p.c.lang === 'en') out.push(<Pill key="en" tone="muted" dot={false}>{t('customers.flags.english')}</Pill>);
  if (p.noSms && p.c.sms_ok === false) out.push(<Pill key="sm" tone="muted" dot={false}>{t('customers.flags.noSms')}</Pill>);
  if (!out.length) return null;
  return <span class={`customers-flags ${p.class || ''}`}>{out}</span>;
}

/** the plate as a small plate */
export function Plate(p: { plate: string | null | undefined }) {
  if (!p.plate) return null;
  return <span class="customers-plate" aria-label={`${t('vehicles.fields.plate')} ${p.plate}`}>{p.plate}</span>;
}

/** an icon and a short text side by side (instead of « A · B ») */
export function Bit(p: { icon?: ComponentChildren; children: ComponentChildren; class?: string; title?: string }) {
  return <span class={`customers-bit ${p.class || ''}`} title={p.title}>{p.icon}<span class="ellipsis">{p.children}</span></span>;
}
