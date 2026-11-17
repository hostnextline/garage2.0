/* The payments of an invoice: the method in words, when, how much; a refund (money given back) says so; the ones
   taken on this phone and still waiting for the network are listed too (they count in what is paid). */
import type { Payment } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { clock, stamp as stampText, dayOf, minuteOf, today } from '../../lib/dates';
import { Button, Rows, RowItem, Money } from '../../ui';
import type { WaitingPayment } from '../../domain/money/waiting';
import { methodWord } from './select';

const how = (method: string, cents: number, l: string) => (cents < 0 ? t('invoices.payments.refund', { how: methodWord(method, l) }) : methodWord(method, l));

export function PaymentsList(p: { pays: Payment[]; waiting?: WaitingPayment[]; onRemove?: (pay: Payment) => unknown; canRemove?: (pay: Payment) => boolean; bare?: boolean }) {
  const l = lang.value;
  // the garage's clock (Montréal), as the day is: a phone set to another zone writes the same time (R169)
  const when = (iso: string) => { const d = new Date(iso); return dayOf(d) === today() ? clock(minuteOf(d), l) : stampText(iso, l); };
  return (
    <div class="inv-pays">
      {!p.bare && <h3 class="inv-subtitle">{t('invoices.payments.title')}</h3>}
      <Rows data-testid="payments">
        {p.pays.map((x) => (
          <RowItem key={x.id} title={how(x.method, x.amount_cents, l)} sub={[when(x.paid_at), x.reference ? t('invoices.payments.ref', { r: x.reference }) : ''].filter(Boolean).join(', ')}
            end={<span class="row"><Money cents={x.amount_cents} />
              {p.onRemove && p.canRemove?.(x) && (
                <Button variant="ghost" confirm={t('invoices.payments.removeConfirm')} onClick={() => p.onRemove!(x)} data-testid="payment-remove">{t('invoices.payments.remove')}</Button>
              )}</span>} />
        ))}
        {(p.waiting || []).map((w) => (
          <RowItem key={w.op} title={how(w.method, w.cents, l)} sub={t('invoices.payments.waiting')} end={<Money cents={w.cents} />} />
        ))}
      </Rows>
    </div>
  );
}
