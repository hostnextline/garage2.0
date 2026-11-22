/* Réglages → Facturation, the rules without the screen (billingModel.test.ts). The section writes two parts: `billing`
   (numbers, rates, conditions) and `company` (the bottom line of the invoice); each gets ONLY the keys changed.
   « Frais de déplacement » / « Gratuits à partir de » are no longer on the screen: nothing ever charged them
   (x-deadcode-01). Their stored value (`billing.travel`) is left exactly as it is, for the owner to decide. */
import { t } from '../../lib/i18n';
import type { Settings } from '../../data/types';
import { rangeError } from './checks';
import { cleanText } from './draft';

export interface BillingView {
  invoice_prefix: string; pad: number | null; hourly_cents: number | null; due_days: number | null; goal_cents: number | null;
  footer_fr: string; footer_en: string; terms_fr: string; terms_en: string;
}
export type BillingErrors = Partial<Record<keyof BillingView, string>>;

export function viewOf(b: Settings['billing'], c: Settings['company']): BillingView {
  return {
    invoice_prefix: b.invoice_prefix ?? 'F-', pad: Number(b.pad ?? 4), hourly_cents: b.hourly_cents ?? null,
    due_days: Number(b.due_days ?? 0), goal_cents: b.goal_cents ?? null,
    footer_fr: c?.footer_fr || '', footer_en: c?.footer_en || '', terms_fr: b.terms_fr || '', terms_en: b.terms_en || ''
  };
}

export function check(d: BillingView): BillingErrors {
  const e: BillingErrors = {};
  if (rangeError(d.pad, 1, 8) || !Number.isInteger(d.pad)) e.pad = t('settings.billing.badPad');
  if ((d.invoice_prefix || '').trim().length > 10) e.invoice_prefix = t('settings.billing.badPrefix');
  if (rangeError(d.due_days, 0, 365) || !Number.isInteger(d.due_days)) e.due_days = t('settings.billing.badDue');
  return e;
}

/** the keys of each part changed by the person (a part with nothing changed is absent) */
export function patchOf(c: Partial<BillingView>): { billing?: Record<string, unknown>; company?: Record<string, unknown> } {
  const billing: Record<string, unknown> = {};
  if ('invoice_prefix' in c) billing.invoice_prefix = String(c.invoice_prefix || '').trim();
  if ('pad' in c) billing.pad = c.pad;
  if ('hourly_cents' in c) billing.hourly_cents = c.hourly_cents ?? null;
  if ('due_days' in c) billing.due_days = c.due_days;
  if ('goal_cents' in c) billing.goal_cents = c.goal_cents ?? null;
  if ('terms_fr' in c) billing.terms_fr = cleanText(c.terms_fr) ?? '';
  if ('terms_en' in c) billing.terms_en = cleanText(c.terms_en) ?? '';
  const company: Record<string, unknown> = {};
  if ('footer_fr' in c) company.footer_fr = cleanText(c.footer_fr) ?? '';
  if ('footer_en' in c) company.footer_en = cleanText(c.footer_en) ?? '';
  return { ...(Object.keys(billing).length ? { billing } : {}), ...(Object.keys(company).length ? { company } : {}) };
}

/** the number the next invoice gets, as it will be written */
export function nextNumber(d: Pick<BillingView, 'invoice_prefix' | 'pad'>, lastNumber: number): string {
  const pad = Number.isFinite(d.pad) && d.pad != null ? Math.min(8, Math.max(1, Math.round(d.pad))) : 4;
  return `${d.invoice_prefix || ''}${String(Math.max(0, lastNumber) + 1).padStart(pad, '0')}`;
}
