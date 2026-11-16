// Stripe's signed notices: « a card page was paid » and « money was given back ». The signature is checked before
// anything else; then the payment (or the refund) goes in the books once, even when Stripe sends the notice twice.
//
// What Stripe is answered (it sends a notice again, for days, until it gets a 2xx):
//   2xx  the money is in the books, or already was, or is kept aside for the office (a refusal of the database that
//        no new try can change: _shared/payments.ts « parked »), or the notice is not about the app
//   4xx  the notice is not Stripe's (signature): nothing in it is believed
//   5xx  a hiccup worth another try (the database or Stripe did not answer), or no notice secret yet (nothing can be
//        checked: Stripe keeps it and sends it again once the secret is saved): nothing is marked as handled
// A refund notice while the garage has no Stripe key (its list of refunds cannot be read) is written in the history for
// the owner (« payment_parked », once) and answered 2xx: no new try can read it either.
import { serve, json, fail } from '../_shared/http.ts';
import { adminDb, secret } from '../_shared/db.ts';
import { verifyStripe } from '../_shared/stripe.ts';
import { applyCheckout, applyRefunds, type Applied } from '../_shared/payments.ts';

const PAID = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
// « charge.refunded » carries the charge, the others the refund itself: both name the payment (payment_intent)
const REFUND = ['charge.refunded', 'charge.refund.updated', 'refund.created', 'refund.updated', 'refund.failed'];

export const handler = serve(async (req) => {
  if (req.method !== 'POST') fail('method', 'POST seulement.', 405);
  const raw = await req.text();
  const whsec = await secret('stripe_webhook_secret');
  if (!whsec) fail('no_stripe', 'Stripe n’est pas branché.', 503);
  const event = await verifyStripe(raw, req.headers.get('stripe-signature'), whsec);
  const id = typeof event?.id === 'string' ? event.id.slice(0, 200) : '';
  if (!id) fail('event', 'Avis illisible.', 400);
  const db = adminDb();
  const { data: seen, error } = await db.from('stripe_events').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (seen) return json({ ok: true, already: true });
  const type = String(event.type || ''), object = event.data?.object || {};
  let result: Applied = 'ignored';
  if (PAID.includes(type)) {
    result = await applyCheckout(object);              // a hiccup throws → 5xx → Stripe tries again later
  } else if (REFUND.includes(type)) {
    const key = await secret('stripe_key');
    if (key) result = await applyRefunds(key, object.payment_intent);
    else {
      // signed by Stripe, but its refunds cannot be read without the key: the owner is told, Stripe is not asked again
      const pi = typeof object.payment_intent === 'string' ? object.payment_intent.slice(0, 120) : '';
      const { data: known, error: ek } = await db.from('activity').select('id').eq('action', 'payment_parked').eq('data->>session', `refund:${pi}`).limit(1);
      if (ek) throw ek;
      if (!known?.length) {
        const { error: en } = await db.from('activity').insert({ entity: 'stripe', entity_id: null, action: 'payment_parked', data: {
          kind: 'refund', session: `refund:${pi}`, reference: pi, event: id, type, amount_cents: -Math.round(Number(object.amount_refunded ?? object.amount ?? 0)) || null,
          reason: 'no_stripe_key' } });
        if (en) throw en;
      }
      return json({ ok: true, result: 'parked' });
    }
  }
  // only once the money is safely recorded (or kept aside): the same notice again answers « already »
  await db.from('stripe_events').insert({ id }).then(() => undefined, () => undefined);
  return json({ ok: true, result });
});
