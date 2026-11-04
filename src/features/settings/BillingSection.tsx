/* Facturation: how invoice numbers are written, the hourly rate, travel fees, payment delay, the month's goal,
   the words printed on the invoice (bottom line and conditions, in French and English). */
import { useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { settings, invoicesList } from '../../data/select';
import { saveSettings } from '../../data/api';
import { Panel, Field, Input, Textarea, MoneyInput, attempt, toast } from '../../ui';
import { useSectionDraft, SaveBar, Section, NumInput, rangeError } from './SectionFrame';
import { cleanText } from './draft';

interface Billing {
  invoice_prefix: string; pad: number | null; hourly_cents: number | null; travel_cents: number | null; free_over_cents: number | null;
  due_days: number | null; goal_cents: number | null; footer_fr: string; footer_en: string; terms_fr: string; terms_en: string;
}
type Errs = Partial<Record<keyof Billing, string>>;

export function BillingSection() {
  const b = settings.value.billing;
  const c = settings.value.company || {};
  const saved: Billing = {
    invoice_prefix: b.invoice_prefix ?? 'F-', pad: Number(b.pad ?? 4), hourly_cents: b.hourly_cents ?? null, travel_cents: b.travel?.cents ?? 0,
    free_over_cents: b.travel?.free_over_cents ?? null, due_days: Number(b.due_days ?? 0), goal_cents: b.goal_cents ?? null,
    footer_fr: c.footer_fr || '', footer_en: c.footer_en || '', terms_fr: b.terms_fr || '', terms_en: b.terms_en || ''
  };
  const { draft: d, set, dirty, reset } = useSectionDraft<Billing>('billing', saved);
  const [err, setErr] = useState<Errs>({});
  const put = <K extends keyof Billing>(k: K) => (v: Billing[K]) => { set((x) => ({ ...x, [k]: v })); if (err[k]) setErr({ ...err, [k]: undefined }); };
  const nextNo = Math.max(0, ...invoicesList.value.map((v) => Number(v.number) || 0)) + 1;
  const pad = Number.isFinite(d.pad) && d.pad != null ? Math.min(8, Math.max(1, Math.round(d.pad))) : 4;
  const example = `${d.invoice_prefix || ''}${String(nextNo).padStart(pad, '0')}`;

  const save = async () => {
    const e: Errs = {};
    const padErr = rangeError(d.pad, 1, 8);
    if (padErr || !Number.isInteger(d.pad)) e.pad = t('settings.billing.badPad');
    if ((d.invoice_prefix || '').trim().length > 10) e.invoice_prefix = t('settings.billing.badPrefix');
    const dueErr = rangeError(d.due_days, 0, 365);
    if (dueErr || !Number.isInteger(d.due_days)) e.due_days = t('settings.billing.badDue');
    setErr(e);
    if (Object.keys(e).length) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const billing = {
      ...settings.value.billing,
      invoice_prefix: (d.invoice_prefix || '').trim(), pad: d.pad, hourly_cents: d.hourly_cents ?? null,
      travel: { cents: d.travel_cents ?? 0, free_over_cents: d.free_over_cents ?? null },
      due_days: d.due_days, goal_cents: d.goal_cents ?? null, terms_fr: cleanText(d.terms_fr) ?? '', terms_en: cleanText(d.terms_en) ?? ''
    };
    const footerChanged = (cleanText(d.footer_fr) ?? '') !== (cleanText(saved.footer_fr) ?? '') || (cleanText(d.footer_en) ?? '') !== (cleanText(saved.footer_en) ?? '');
    const ok = await attempt(async () => {
      await saveSettings('billing', billing);
      if (footerChanged) await saveSettings('company', { ...(settings.value.company || {}), footer_fr: cleanText(d.footer_fr) ?? '', footer_en: cleanText(d.footer_en) ?? '' });
    }, { ok: t('settings.saved') });
    if (ok) reset();
  };

  return (
    <Section testid="settings-billing" bar={<SaveBar dirty={dirty} onSave={save} onReset={() => { reset(); setErr({}); }} />}>
      <Panel title={t('settings.billing.numbers')} help={t('settings.billing.numbersHelp')}>
        <div class="stack">
          <div class="grid-2">
            <Field label={t('settings.billing.prefix')} help={t('settings.billing.prefixHelp')} error={err.invoice_prefix}>
              <Input value={d.invoice_prefix} onValue={put('invoice_prefix')} autoComplete="off" maxLength={12} invalid={!!err.invoice_prefix} data-testid="billing-prefix" />
            </Field>
            <Field label={t('settings.billing.pad')} help={t('settings.billing.padHelp')} error={err.pad}>
              <NumInput value={d.pad} onValue={put('pad')} invalid={!!err.pad} aria-label={t('settings.billing.pad')} />
            </Field>
          </div>
          <p class="settings-example" data-testid="billing-example">{t('settings.billing.example', { n: example })}</p>
        </div>
      </Panel>
      <Panel title={t('settings.billing.rates')}>
        <div class="grid-2">
          <Field label={t('settings.billing.hourly')} help={t('settings.billing.hourlyHelp')} optional>
            <MoneyInput cents={d.hourly_cents} onCents={put('hourly_cents')} aria-label={t('settings.billing.hourly')} />
          </Field>
          <Field label={t('settings.billing.goal')} help={t('settings.billing.goalHelp')} optional>
            <MoneyInput cents={d.goal_cents} onCents={put('goal_cents')} aria-label={t('settings.billing.goal')} />
          </Field>
          <Field label={t('settings.billing.travel')} help={t('settings.billing.travelHelp')}>
            <MoneyInput cents={d.travel_cents} onCents={put('travel_cents')} aria-label={t('settings.billing.travel')} />
          </Field>
          <Field label={t('settings.billing.freeOver')} help={t('settings.billing.freeOverHelp')} optional>
            <MoneyInput cents={d.free_over_cents} onCents={put('free_over_cents')} aria-label={t('settings.billing.freeOver')} />
          </Field>
          <Field label={t('settings.billing.due')} help={t('settings.billing.dueHelp')} error={err.due_days}>
            <NumInput value={d.due_days} onValue={put('due_days')} unit={t('settings.billing.dueUnit')} invalid={!!err.due_days} aria-label={t('settings.billing.due')} />
          </Field>
        </div>
      </Panel>
      <Panel title={t('settings.billing.texts')}>
        <div class="stack">
          <div class="grid-2">
            <Field label={`${t('settings.billing.footer')} (${t('settings.langFr')})`} help={t('settings.billing.footerHelp')} optional>
              <Input value={d.footer_fr} onValue={put('footer_fr')} maxLength={200} />
            </Field>
            <Field label={`${t('settings.billing.footer')} (${t('settings.langEn')})`} optional>
              <Input value={d.footer_en} onValue={put('footer_en')} maxLength={200} />
            </Field>
          </div>
          <div class="grid-2">
            <Field label={`${t('settings.billing.terms')} (${t('settings.langFr')})`} help={t('settings.billing.termsHelp')} optional>
              <Textarea value={d.terms_fr} onValue={put('terms_fr')} rows={4} />
            </Field>
            <Field label={`${t('settings.billing.terms')} (${t('settings.langEn')})`} optional>
              <Textarea value={d.terms_en} onValue={put('terms_en')} rows={4} />
            </Field>
          </div>
        </div>
      </Panel>
    </Section>
  );
}
