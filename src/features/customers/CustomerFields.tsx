/* The fields of a customer's file, the same everywhere: the new customer page, « Modifier », the short sheet of the
   customer picker. Also the duplicate check (« Ce numéro est déjà à Julie Tremblay »). */
import type { ComponentChildren } from 'preact';
import { t } from '../../lib/i18n';
import { phoneDigits, formatPhone, EMAIL_RE } from '../../lib/text';
import type { Customer, Lang } from '../../data/types';
import { customersList, customerName } from '../../data/select';
import { Field, Input, PhoneInput, Textarea, Seg, Switch, Banner } from '../../ui';
import { AddressField, placeFields, EMPTY_PLACE, type PlaceValue } from './AddressField';
import { phoneOwners } from './dupes';
import { cap } from './search';

export interface Draft {
  first_name: string; last_name: string; company: string; phone: string; email: string; lang: Lang;
  place: PlaceValue; notes: string; sms_ok: boolean; card_on_file: boolean;
}
export function emptyDraft(o: Partial<Draft> = {}): Draft {
  return { first_name: '', last_name: '', company: '', phone: '', email: '', lang: 'fr', place: { ...EMPTY_PLACE }, notes: '', sms_ok: true, card_on_file: false, ...o };
}
export function draftOf(c: Customer): Draft {
  return {
    first_name: c.first_name || '', last_name: c.last_name || '', company: c.company || '', phone: c.phone || '', email: c.email || '',
    lang: c.lang === 'en' ? 'en' : 'fr', notes: c.notes || '', sms_ok: c.sms_ok !== false, card_on_file: !!c.card_on_file,
    place: { address: c.address || '', unit: c.unit, postal_code: c.postal_code, lat: c.lat, lng: c.lng, city: c.city }
  };
}
/** what is saved: names written with capitals when typed in lower case, the phone written the Québec way */
export function customerPatch(d: Draft): Partial<Customer> {
  const name = (s: string) => (s.trim() ? cap(s.trim().replace(/\s+/g, ' ')) : null);
  return {
    first_name: name(d.first_name), last_name: name(d.last_name), company: d.company.trim() || null,
    phone: d.phone.trim() ? formatPhone(d.phone) : null, email: d.email.trim() || null, lang: d.lang,
    ...placeFields(d.place), notes: d.notes.trim() || null, sms_ok: d.sms_ok, card_on_file: d.card_on_file
  };
}
/** only the fields that changed (two people may change the same file at the same time) */
export function changed(before: Partial<Customer>, after: Partial<Customer>): Partial<Customer> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) if ((before as Record<string, unknown>)[k] !== v) out[k] = v;
  return out as Partial<Customer>;
}

export interface DraftErrors { name?: string; phone?: string; email?: string }
export function checkDraft(d: Draft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.first_name.trim() && !d.last_name.trim() && !d.company.trim()) e.name = t('customers.form.errors.name');
  if (d.phone.trim() && !phoneDigits(d.phone)) e.phone = t('customers.form.errors.phone');
  if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) e.email = t('customers.form.errors.email');
  return e;
}
export const hasErrors = (e: DraftErrors) => Object.values(e).some(Boolean);

/** « Ce numéro est déjà à Julie Tremblay » with a way to go to that file (or to pick it) */
export function DupBanner(p: { phone: string; exceptId?: string | null; action: (c: Customer) => ComponentChildren }) {
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
