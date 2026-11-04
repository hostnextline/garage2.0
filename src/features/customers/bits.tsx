/* Small pieces the customer screens share: the flags in words, « Demain matin », the plate badge, car names. */
import type { ComponentChildren } from 'preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { today, daysBetween, parseDay, tinyDay, type BlockKey } from '../../lib/dates';
import { vehicleLabel } from '../../data/select';
import type { Customer, Vehicle } from '../../data/types';
import { Pill } from '../../ui';

const fmt = new Map<string, Intl.DateTimeFormat>();
function df(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = lang.value + JSON.stringify(o);
  let f = fmt.get(k);
  if (!f) { f = new Intl.DateTimeFormat(lang.value === 'en' ? 'en-CA' : 'fr-CA', o); fmt.set(k, f); }
  return f;
}
/** « 4 nov. » this year, « 4 nov. 2025 » another year */
export function dateShort(day: string): string {
  const d = parseDay(day);
  return df(d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
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
/** « Ce matin », « Demain après-midi », « ven. 7, soir », « 12 nov., matin » */
export function whenText(day: string, block: BlockKey): string {
  const n = daysBetween(today(), day);
  if (n === 0) return t(`customers.when.today.${block}`);
  if (n === 1) return t(`customers.when.tomorrow.${block}`);
  return t(`customers.when.other.${block}`, { day: dayWord(day) });
}
/** the local day of a timestamp ('YYYY-MM-DD'), or null */
export function dayOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** inside a sentence: « hier », « demain », « ven. 7 », « 4 nov. » */
export function dayInline(day: string): string {
  const n = daysBetween(today(), day);
  const w = dayWord(day);
  return Math.abs(n) <= 1 ? w.toLowerCase() : w;
}
/** « Rendez-vous demain matin », « Rendez-vous le ven. 7, soir » */
export function nextLine(day: string, block: BlockKey): string {
  const n = daysBetween(today(), day);
  if (n === 0) return t(`customers.whenLine.today.${block}`);
  if (n === 1) return t(`customers.whenLine.tomorrow.${block}`);
  return t(`customers.whenLine.other.${block}`, { day: dayInline(day) });
}
/** « Dernière visite : 6 avr. » */
export function lastLine(day: string): string { return t('customers.whenLine.last', { day: dayInline(day) }); }
/** a timestamp as a day: « Aujourd’hui », « Hier », else « 4 nov. »; `inline`: inside a sentence (« aujourd’hui ») */
export function stampDay(iso: string | null | undefined, inline = false): string {
  const day = dayOfIso(iso);
  if (!day) return '';
  if (Math.abs(daysBetween(today(), day)) > 1) return dateShort(day);
  return inline ? dayWord(day).toLowerCase() : dayWord(day);
}

/** what a car is called in a list: « 2019 Honda Civic », else its plate or the end of its VIN */
export function carName(v: Vehicle | null | undefined): string {
  if (!v) return '';
  return vehicleLabel(v) || v.plate || (v.vin ? t('vehicles.vinTail', { tail: v.vin.slice(-6) }) : t('vehicles.untitled'));
}

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
