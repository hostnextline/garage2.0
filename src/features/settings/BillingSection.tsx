/* Facturation: how invoice numbers are written, the hourly rate, payment delay, the month's goal, the words printed on
   the invoice (bottom line and conditions, in French and English). */
import { useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { settings, invoicesList } from '../../data/select';
import { saveSettings } from '../../data/api';
import { Panel, Field, Input, Textarea, MoneyInput, Banner, attempt, toast } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';
import { NumInput } from './fields';
import { viewOf, check, patchOf, nextNumber, type BillingView, type BillingErrors } from './billingModel';

/** the section's fields as stored now (also what the dot of the list compares the draft with) */
export const billingSaved = (): BillingView => viewOf(settings.value.billing, settings.value.company || {});

export function BillingSection() {
  const saved = billingSaved();
  const { draft: d, set, dirty, changes, reset } = useSectionDraft<BillingView>('billing', saved);
  const [err, setErr] = useState<BillingErrors>({});
  const put = <K extends keyof BillingView>(k: K) => (v: BillingView[K]) => { set((x) => ({ ...x, [k]: v })); if (err[k]) setErr({ ...err, [k]: undefined }); };
  const example = nextNumber(d, Math.max(0, ...invoicesList.value.map((v) => Number(v.number) || 0)));
  // the number shown on an invoice is written with the CURRENT prefix and digits: the old ones change too
  const renames = 'invoice_prefix' in changes || 'pad' in changes;

  const save = async () => {
    const e = check(d);
    setErr(e);
    if (Object.keys(e).length) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const p = patchOf(changes);
    const ok = await attempt(async () => {
      if (p.billing) await saveSettings('billing', { ...settings.value.billing, ...p.billing });
      if (p.company) await saveSettings('company', { ...(settings.value.company || {}), ...p.company });
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
          {renames && <Banner kind="warn" data-testid="billing-renames">{t('settings.billing.renamesPast')}</Banner>}
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
