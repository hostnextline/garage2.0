/* Small pieces the customer screens share: the flags in words, the plate badge, an icon beside a short text.
   (When an appointment is, in words: when.ts.) */
import type { ComponentChildren } from 'preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import type { Customer } from '../../data/types';
import { Pill } from '../../ui';

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
