/* « Le client préfère payer sur son téléphone? »: texts the invoice, whose page has « Payer » when card payments are
   switched on. Whether they are: everyone's access says it (my_access → card_online); an older copy of the access
   without that answer asks the server (owner only). */
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Send, Smartphone } from 'lucide-preact';
import { team } from '../../data/api';
import { isOwner, access } from '../../data/auth';
import { t } from '../../lib/i18n';
import { Button } from '../../ui';
import { sendText, SendSheet, type SendResult } from './send';

type StripeState = 'unknown' | 'on' | 'off';
const stripe = signal<StripeState | null>(null);
async function checkStripe() {
  const known = access.value?.card_online;
  if (typeof known === 'boolean') { stripe.value = known ? 'on' : 'off'; return; }
  if (!isOwner()) { stripe.value = 'unknown'; return; }
  try {
    const r = await team<{ stripe?: { on?: boolean } }>('secrets');
    stripe.value = r.ok && r.stripe ? (r.stripe.on ? 'on' : 'off') : 'unknown';
  } catch (e) {
    // the answer is only a hint for the words below: without it the sheet says « si le paiement par carte est branché »
    console.warn('stripe state', e);
    if (stripe.value == null) stripe.value = 'unknown';
  }
}

export function PayLink(p: { jobId: string; onLeave: () => void }) {
  const [manual, setManual] = useState<SendResult | null>(null);
  useEffect(() => { void checkStripe(); }, []);
  const send = async () => { const r = await sendText('invoice', p.jobId, t('invoices.pay.link.sent')); if (r) setManual(r); };
  return (
    <div class="pay-link">
      <h3 class="pay-link-title"><Smartphone aria-hidden="true" />{t('invoices.pay.link.title')}</h3>
      {stripe.value === 'off'
        ? <p class="muted small" style={{ margin: 0 }}>{t('invoices.pay.link.off')}{isOwner() && <> <a href="#/settings/connect" onClick={p.onLeave}>{t('invoices.pay.link.settings')}</a></>}</p>
        : <>
          <p class="muted small" style={{ margin: 0 }}>{stripe.value === 'on' ? t('invoices.pay.link.on') : t('invoices.pay.link.unknown')}</p>
          <Button icon={<Send />} onClick={send} data-testid="pay-link">{t('invoices.pay.link.send')}</Button>
        </>}
      <SendSheet result={manual} onClose={() => setManual(null)} />
    </div>
  );
}
