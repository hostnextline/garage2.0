/* The fields of a customer's file, the same everywhere: the new customer page, « Modifier », the short sheet of the
   customer picker. Also the duplicate check (« Ce numéro est déjà à Julie Tremblay »). The model is draft.ts. */
import type { ComponentChildren } from 'preact';
import { t } from '../../lib/i18n';
import type { Customer } from '../../data/types';
import { customersList, customerName } from '../../data/select';
import { Field, Input, PhoneInput, Textarea, Seg, Switch, Banner } from '../../ui';
import { AddressField } from '../places/AddressField';
import { phoneOwners } from './dupes';
import type { Draft, DraftErrors } from './draft';

// the draft model lives in draft.ts; booking imports these two from here
export { customerPatch, emptyDraft, type Draft, type DraftErrors } from './draft';

/** « Ce numéro est déjà à Julie Tremblay » with a way to go to that file (or to pick it) */
function DupBanner(p: { phone: string; exceptId?: string | null; action: (c: Customer) => ComponentChildren }) {
  const owners = phoneOwners(p.phone, customersList.value, p.exceptId);
  if (!owners.length) return null;
  const first = owners[0];
  return (
    <Banner kind="warn" title={t('customers.dup.title', { name: customerName(first), n: owners.length - 1 })} data-testid="dup-banner">
      <span class="small">{t('customers.dup.hint')}</span>
      <span class="customers-dup-action">{p.action(first)}</span>
    </Banner>
  );
}

export function CustomerFields(p: {
  draft: Draft; set: (patch: Partial<Draft>) => void; errors?: DraftErrors;
  /** the file being changed (left out of the duplicate check) */
  exceptId?: string | null;
  /** what the duplicate banner offers: open the other file, or pick it */
  dupAction: (c: Customer) => ComponentChildren;
  /** the short form of the picker: names, phone, address, language */
  short?: boolean; autoFocus?: boolean;
}) {
  const d = p.draft, e = p.errors || {};
  return (
    <div class="stack customers-form">
      <div class="grid-2 customers-names">
        <Field label={t('customers.form.first')} error={e.name}>
          <Input value={d.first_name} onValue={(v) => p.set({ first_name: v })} autoComplete="off" autoCapitalize="words" autoFocus={p.autoFocus} invalid={!!e.name} data-testid="cf-first" />
        </Field>
        <Field label={t('customers.form.last')}>
          <Input value={d.last_name} onValue={(v) => p.set({ last_name: v })} autoComplete="off" autoCapitalize="words" invalid={!!e.name} data-testid="cf-last" />
        </Field>
      </div>
      <Field label={t('customers.form.company')} optional hint={t('customers.form.companyHint')}>
        <Input value={d.company} onValue={(v) => p.set({ company: v })} autoComplete="off" data-testid="cf-company" />
      </Field>
      <Field label={t('customers.form.phone')} error={e.phone} hint={!d.phone.trim() ? t('customers.form.phoneHint') : undefined}>
        <PhoneInput value={d.phone} onValue={(v) => p.set({ phone: v })} invalid={!!e.phone} />
      </Field>
      <DupBanner phone={d.phone} exceptId={p.exceptId} action={p.dupAction} />
      {!p.short && (
        <Field label={t('customers.form.email')} optional error={e.email}>
          <Input type="email" inputMode="email" autoComplete="off" value={d.email} onValue={(v) => p.set({ email: v })} invalid={!!e.email} data-testid="cf-email" />
        </Field>
      )}
      <AddressField value={d.place} onValue={(v) => p.set({ place: v })} details />
      <Field label={t('customers.form.lang')} group hint={t('customers.form.langHint')}>
        <Seg value={d.lang} onValue={(v) => p.set({ lang: v })} label={t('customers.form.lang')} class="customers-seg"
          options={[{ value: 'fr', label: t('customers.form.langFr') }, { value: 'en', label: t('customers.form.langEn') }]} data-testid="cf-lang" />
      </Field>
      {!p.short && (
        <>
          <Field label={t('customers.form.notes')} optional hint={t('customers.form.notesHint')}>
            <Textarea value={d.notes} onValue={(v) => p.set({ notes: v })} rows={2} data-testid="cf-notes" />
          </Field>
          <div class="customers-switches">
            <Switch checked={d.sms_ok} onChange={(v) => p.set({ sms_ok: v })} label={t('customers.form.sms')} hint={t('customers.form.smsHint')} data-testid="cf-sms" />
            <Switch checked={d.card_on_file} onChange={(v) => p.set({ card_on_file: v })} label={t('customers.form.card')} hint={t('customers.form.cardHint')} data-testid="cf-card" />
          </div>
        </>
      )}
    </div>
  );
}
