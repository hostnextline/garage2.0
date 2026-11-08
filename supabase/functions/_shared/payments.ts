// A card payment Stripe confirmed goes on the invoice (or the job, when paid ahead) — once, whatever happens.
// A refund made in Stripe comes back the same way: a negative card payment on the same invoice, once per refund.
import { adminDb } from './db.ts';

export async function applyCheckout(session: Record<string, any>): Promise<'applied' | 'already' | 'ignored'> {
  if (session?.payment_status !== 'paid') return 'ignored';
  const md = session.metadata || {};
  const amount = Number(session.amount_total || 0);
  if (!amount || (!md.invoice_id && !md.job_id)) return 'ignored';
  const db = adminDb();
  const { data: seen } = await db.from('payments').select('id').eq('stripe_session', session.id).maybeSingle();
  if (seen) return 'already';
  const { error } = await db.rpc('payment_add', {
    p_op: crypto.randomUUID(), p_invoice: md.invoice_id || null, p_amount_cents: amount, p_method: 'card_online',
    p_reference: session.payment_intent || session.id, p_job: md.invoice_id ? null : md.job_id, p_session: session.id
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return 'already';
    throw error;
  }
  return 'applied';
}

/** « charge.refunded »: each refund of the charge, once (the refund's id is kept as the payment's session) */
export async function applyRefund(charge: Record<string, any>): Promise<'applied' | 'already' | 'ignored'> {
  const intent = String(charge?.payment_intent || '');
  const refunds = (charge?.refunds?.data || []) as Record<string, any>[];
  if (!intent || !refunds.length) return 'ignored';
  const db = adminDb();
  // the payment this charge made (its reference is the payment intent)
  const { data: paid } = await db.from('payments').select('id, invoice_id, job_id').eq('reference', intent).is('deleted_at', null).gt('amount_cents', 0).limit(1).maybeSingle();
  if (!paid) return 'ignored';
  let out: 'applied' | 'already' | 'ignored' = 'already';
  for (const r of refunds) {
    const amount = Number(r.amount || 0);
    if (!r.id || amount <= 0 || (r.status && r.status !== 'succeeded')) continue;
    const { data: seen } = await db.from('payments').select('id').eq('stripe_session', String(r.id)).maybeSingle();
    if (seen) continue;
    const { error } = await db.rpc('payment_add', {
      p_op: crypto.randomUUID(), p_invoice: (paid as Record<string, any>).invoice_id || null, p_amount_cents: -amount, p_method: 'card_online',
      p_reference: String(r.id), p_job: (paid as Record<string, any>).invoice_id ? null : (paid as Record<string, any>).job_id, p_session: String(r.id)
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) continue;
      throw error;
    }
    out = 'applied';
  }
  return out;
}
