/* Cash at the door: what the customer hands over, the quick bills, and the change to give back (rounded to 5 ¢:
   no pennies); only what is due is recorded. */
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { Field, MoneyInput, Banner } from '../../ui';
import { cashQuick, type Cash } from '../../domain/money/invoice';

export function PayCash(p: { cash: Cash; received: number | null; onReceived: (c: number | null, info?: { valid: boolean }) => void; balance: number }) {
  const { cash } = p;
  const l = lang.value;
  return (
    <div class="pay-cash stack" data-testid="pay-cash">
      <Field label={t('invoices.pay.received')} hint={cash.dueCash !== cash.due ? t('invoices.pay.rounded', { amount: money(cash.dueCash, l) }) : undefined}>
        <div class="pay-amount"><MoneyInput cents={p.received} onCents={p.onReceived} aria-label={t('invoices.pay.received')} /></div>
      </Field>
      <div class="chips" role="group" aria-label={t('invoices.pay.quick')}>
        {cashQuick(cash.dueCash).map((c) => (
          <button key={c} type="button" class="chip pay-bill" aria-pressed={p.received === c} onClick={() => p.onReceived(c)}>
            {c === cash.dueCash ? t('invoices.pay.exact') : money(c, l, { whole: true })}
          </button>
        ))}
      </div>
      {p.received != null && (cash.short > 0
        ? <Banner kind="warn" title={t('invoices.pay.short', { amount: money(cash.short, l) })}>{t('invoices.pay.shortText', { amount: money(cash.record, l), left: money(p.balance - cash.record, l) })}</Banner>
        : (
          <div class="pay-change" role="status" data-testid="pay-change">
            <span>{t('invoices.pay.giveBack')}</span>
            <b class="money">{money(cash.change, l)}</b>
          </div>
        ))}
    </div>
  );
}
