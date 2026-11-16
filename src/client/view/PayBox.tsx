/* « Payer {amount} par carte » (an invoice) or « Payer maintenant {amount} » (the mechanic is there): Stripe's card page. */
import { CreditCard, Lock } from 'lucide-preact';
import { Button } from '../../ui/Button';
import type { JobView } from '../api';
import { cad } from '../format';
import { ct, type CLang } from '../i18n';
import { Note } from '../ui';

export function PayBox(p: { v: JobView; l: CLang; now?: boolean; failed: boolean; pendingNote: boolean; onPay: () => Promise<void> }) {
  const { v, l } = p;
  return (
    <div class="cl-pay cl-noprint" data-testid="client-pay">
      {p.pendingNote && <Note>{ct(l, 'pay.pending')}</Note>}
      <Button variant="primary" block icon={<CreditCard />} onClick={p.onPay} data-testid="client-pay-button">
        {ct(l, p.now ? 'pay.now' : 'pay.button', { amount: cad(v.pay.amount_cents, l) })}
      </Button>
      <p class="cl-pay-note"><Lock aria-hidden="true" />{ct(l, 'pay.secure')}</p>
      {p.failed && <Note kind="bad">{ct(l, 'pay.fail')}</Note>}
    </div>
  );
}
