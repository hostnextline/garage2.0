// Stripe's signed notice "payment done": checked, then the payment goes on the invoice once (Stripe may send it twice).
import { serve, json, fail } from '../_shared/http.ts';
import { adminDb, secret } from '../_shared/db.ts';
import { verifyStripe } from '../_shared/stripe.ts';
import { applyCheckout, applyRefund } from '../_shared/payments.ts';

export const handler = serve(async (req) => {
  if (req.method !== 'POST') fail('method', 'POST seulement.', 405);
  const raw = await req.text();
  const whsec = await secret('stripe_webhook_secret');
  if (!whsec) fail('no_stripe', 'Stripe n’est pas branché.', 400);
  const event = await verifyStripe(raw, req.headers.get('stripe-signature'), whsec);
  const db = adminDb();
  const { data: seen } = await db.from('stripe_events').select('id').eq('id', event.id).maybeSingle();
  if (seen) return json({ ok: true, already: true });
  let result = 'ignored';
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    result = await applyCheckout(event.data?.object || {});   // throws → 500 → Stripe tries again later
  } else if (event.type === 'charge.refunded') {
    result = await applyRefund(event.data?.object || {});     // a refund made in Stripe: a negative payment on the invoice
  }
  // only once the payment is safely recorded
  await db.from('stripe_events').insert({ id: event.id }).then(() => undefined, () => undefined);
  return json({ ok: true, result });
});
