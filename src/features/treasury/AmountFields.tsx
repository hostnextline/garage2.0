/* The amounts of the expense sheet: « Total payé » first (the end-to-end test types it in the first money field),
   « TPS et TVQ » / « Pas de taxes », then before taxes, TPS and TVQ and the line that says whether they add up.
   Each field reports what was typed; the rules are in expenseDraft.ts. */
import { t } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Field, MoneyInput, Seg } from '../../ui';
import type { AmountField, Draft } from './expenseDraft';

export function AmountFields(p: {
  d: Draft; l: string; fromReceipt: boolean; errors: { total?: string; sum?: string };
  onAmount: (field: AmountField, cents: number | null) => void; onTaxed: (taxed: boolean) => void;
}) {
  const { d, l } = p;
  const sum = (d.subtotal ?? 0) + (d.tps ?? 0) + (d.tvq ?? 0);
  const sumKnown = d.total != null && d.subtotal != null && d.tps != null && d.tvq != null;
  return (
    <>
      <Field label={t('treasury.form.total')} hint={p.fromReceipt ? <span class="tre-read">{t('treasury.form.fromReceipt')}</span> : t('treasury.form.totalHint')} error={p.errors.total}>
        <span class="tre-total"><MoneyInput cents={d.total} invalid={!!p.errors.total} aria-label={t('treasury.form.total')} onCents={(c) => p.onAmount('total', c)} /></span>
      </Field>
      <Field group label={t('treasury.form.taxes')}>
        <Seg value={d.taxed ? 'yes' : 'no'} label={t('treasury.form.taxes')} data-testid="expense-taxed"
          options={[{ value: 'yes', label: t('treasury.form.taxed') }, { value: 'no', label: t('treasury.form.untaxed') }]}
          onValue={(v) => p.onTaxed(v === 'yes')} />
      </Field>
      {d.taxed && (
        <>
          <div class="tre-split">
            <Field label={t('treasury.form.subtotal')}>
              <MoneyInput cents={d.subtotal} aria-label={t('treasury.form.subtotal')} onCents={(c) => p.onAmount('subtotal', c)} />
            </Field>
            <Field label={t('treasury.form.tps')}>
              <MoneyInput cents={d.tps} aria-label={t('treasury.form.tps')} onCents={(c) => p.onAmount('tps', c)} />
            </Field>
            <Field label={t('treasury.form.tvq')}>
              <MoneyInput cents={d.tvq} aria-label={t('treasury.form.tvq')} onCents={(c) => p.onAmount('tvq', c)} />
            </Field>
          </div>
          {p.errors.sum ? <p class="field-error" role="alert" style={{ margin: 0 }}>{p.errors.sum}</p>
            : sumKnown && (sum === d.total
              ? <p class="small muted" style={{ margin: 0 }} data-testid="expense-sum">{t('treasury.form.sumOk', { total: money(d.total, l) })} {!p.fromReceipt && t('treasury.form.computed')}</p>
              : <p class="small tre-warn" style={{ margin: 0 }} role="status" data-testid="expense-sum">{t('treasury.form.sumBad', { sum: money(sum, l), total: money(d.total, l) })}</p>)}
        </>
      )}
    </>
  );
}
