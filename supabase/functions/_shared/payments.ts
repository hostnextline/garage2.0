// A card payment Stripe confirmed goes on the invoice (or the job, when paid ahead) — once, whatever happens.
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
