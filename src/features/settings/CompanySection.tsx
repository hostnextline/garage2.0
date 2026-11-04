/* Entreprise: the garage's name, how to reach it, its official numbers (printed on invoices and estimates). */
import { useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { EMAIL_RE } from '../../lib/text';
import { settings } from '../../data/select';
import { saveSettings } from '../../data/api';
import { Panel, Field, Input, PhoneInput, attempt, toast } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';
import { cleanText } from './draft';

const FIELDS = ['name', 'legal_name', 'phone', 'email', 'website', 'address', 'tps_no', 'tvq_no', 'neq'] as const;
type Company = Record<(typeof FIELDS)[number], string>;

export function CompanySection() {
  const c = settings.value.company || {};
  const saved = Object.fromEntries(FIELDS.map((k) => [k, String((c as Record<string, unknown>)[k] ?? '')])) as Company;
  const { draft: d, set, dirty, reset } = useSectionDraft<Company>('company', saved);
  const [err, setErr] = useState<Partial<Record<keyof Company, string>>>({});
  const field = (k: keyof Company) => (v: string) => { set((x) => ({ ...x, [k]: v })); if (err[k]) setErr({ ...err, [k]: undefined }); };

  const save = async () => {
    const e: Partial<Record<keyof Company, string>> = {};
    if (!d.name.trim()) e.name = t('settings.company.needName');
    if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) e.email = t('settings.company.badEmail');
    setErr(e);
    if (Object.keys(e).length) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const next: Record<string, unknown> = { ...(settings.value.company || {}) };
    for (const k of FIELDS) next[k] = cleanText(d[k]);
    if (await attempt(() => saveSettings('company', next), { ok: t('settings.saved') })) reset();
  };

  return (
    <Section testid="settings-company" bar={<SaveBar dirty={dirty} onSave={save} onReset={() => { reset(); setErr({}); }} />}>
      <Panel title={t('settings.company.garage')}>
        <div class="grid-2">
          <Field label={t('settings.company.name')} help={t('settings.company.nameHelp')} error={err.name}>
            <Input value={d.name} onValue={field('name')} autoComplete="organization" invalid={!!err.name} data-testid="company-name" />
          </Field>
          <Field label={t('settings.company.legal')} help={t('settings.company.legalHelp')} optional>
            <Input value={d.legal_name} onValue={field('legal_name')} autoComplete="off" />
          </Field>
        </div>
      </Panel>
      <Panel title={t('settings.company.reach')}>
        <div class="stack">
          <div class="grid-2">
            <Field label={t('settings.company.phone')} help={t('settings.company.phoneHelp')} optional>
              <PhoneInput value={d.phone} onValue={field('phone')} />
            </Field>
            <Field label={t('settings.company.email')} error={err.email} optional>
              <Input type="email" inputMode="email" autoComplete="email" value={d.email} onValue={field('email')} invalid={!!err.email} />
            </Field>
          </div>
          <Field label={t('settings.company.address')} help={t('settings.company.addressHelp')} optional>
            <Input value={d.address} onValue={field('address')} autoComplete="street-address" />
          </Field>
          <Field label={t('settings.company.website')} optional>
            <Input type="url" inputMode="url" autoComplete="url" value={d.website} onValue={field('website')} placeholder="https://" />
          </Field>
        </div>
      </Panel>
      <Panel title={t('settings.company.numbers')} help={t('settings.company.numbersHelp')}>
        <div class="settings-grid-3">
          <Field label={t('settings.company.tps')} optional>
            <Input value={d.tps_no} onValue={field('tps_no')} autoComplete="off" placeholder={t('settings.company.tpsPh')} />
          </Field>
          <Field label={t('settings.company.tvq')} optional>
            <Input value={d.tvq_no} onValue={field('tvq_no')} autoComplete="off" placeholder={t('settings.company.tvqPh')} />
          </Field>
          <Field label={t('settings.company.neq')} help={t('settings.company.neqHelp')} optional>
            <Input value={d.neq} onValue={field('neq')} autoComplete="off" inputMode="numeric" />
          </Field>
        </div>
      </Panel>
    </Section>
  );
}
