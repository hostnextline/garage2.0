// Card money in the books. A card payment Stripe confirmed goes on the invoice (or the job, when paid ahead) — once,
// whatever happens. Money given back from Stripe's own screens comes back the same way: a negative card payment, once
// per refund.
//
// The rule of this file: money Stripe took is NEVER lost, never counted twice and never asked for again and again.
//   recorded     payment_add took it (on the invoice named, or on the job when that invoice was cancelled, removed or
//                reopened meanwhile: the next finished invoice of the job takes it)                       → 'applied'
//                Since Part 27 (20261116000100_refonte_argent.sql) the database takes EVERY card payment and refund
//                itself (the invoice, else the job's finished invoice, else waiting on the job, else on nothing) and,
//                when it is not where it was meant to go, writes its own note (activity « payment_unmatched ») in the
//                same transaction as the money: nothing more is written here then, and the nightly reconciliation
//                lists a payment that waits on a closed job or on nothing.
//   known        the same Stripe page or refund was already recorded                                      → 'already'
//   parked       the database refuses it for good (today's database before Part 27, or a refusal nobody foresaw):
//                it is written in the history (activity « payment_parked », with everything needed to enter it by
//                hand) and on the job's texts, for the office                                             → 'parked'
//                Kept aside is FINAL for that page or refund: the office enters it by hand, so the books never take
//                it by themselves afterwards (a later notice, the customer's page, a refund notice), even once the
//                database would: it would be counted twice. The refunds of a page kept aside are kept aside beside it.
//   not ours     no payment of the app behind it                                                          → 'ignored'
//   a hiccup     (the database or Stripe did not answer) is thrown: the caller answers 5xx and Stripe tries again.
import { adminDb } from './db.ts';
import { sha256hex } from './tokens.ts';
import { stripeCall } from './stripe.ts';
import { money } from './texts.ts';

type Row = Record<string, any>;
export type Applied = 'applied' | 'already' | 'ignored' | 'parked';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (x: unknown): string | null => (typeof x === 'string' && UUID.test(x) ? x : null);

/** the operation id of a Stripe object: always the same one for the same object, so the same notice arriving twice at the
    same instant is one operation for the database */
export async function stripeOp(what: string): Promise<string> {
  const h = await sha256hex(`stripe:${what}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const already = (e: Row) => e?.code === '23505' || /duplicate|unique/i.test(String(e?.message || ''));
/** why the database will never take it: the code of its refusal (public.fail), or a row that cannot exist (wrong data,
    a broken link between rows); null = a hiccup, worth trying again */
function never(e: Row): string | null {
  const code = String(e?.code || '');
  if (code === 'P0001') return String(e?.hint || 'refused');
  return /^(22|23)/.test(code) ? code : null;
}

interface Entry { op: string; invoice: string | null; job: string | null; amount: number; reference: string; session: string; kind: 'payment' | 'refund' | 'refund_failed' }

/** written where the office sees it: the history (activity) and the job's own texts. For money kept aside (« parked »:
    Stripe is answered 2xx and never sends it again) the history row IS the only trace: not written = thrown, so Stripe is
    answered 5xx and sends the notice again. The text on the job is a reminder only (logged when it fails). */
async function note(action: 'payment_moved' | 'payment_parked', e: Entry, reason: string) {
  const db = adminDb();
  const { error } = await db.from('activity').insert({ entity: 'job', entity_id: e.job, action, data: {
    kind: e.kind, session: e.session, reference: e.reference, amount_cents: e.amount, invoice: e.invoice, job: e.job, reason } });
  if (error) {
    if (action === 'payment_parked') throw error;
    console.error('payments: note not written', action, e.session, String(error.message).slice(0, 200));
  }
  if (!e.job) return;
  const sum = money(Math.abs(e.amount), 'fr');
  const what = e.kind === 'payment' ? `Paiement par carte de ${sum}` : e.kind === 'refund' ? `Remboursement par carte de ${sum}` : `Remboursement par carte de ${sum} qui n’a pas passé`;
  const body = action === 'payment_parked'
    ? `${what} : PAS inscrit (${reason}). À entrer à la main. Référence Stripe : ${e.reference}`
    : `${what} : la facture visée n’est plus bonne (${reason}), il est inscrit sur la job et ira sur la prochaine facture. À vérifier.`;
  const { error: em } = await db.from('messages').insert({ job_id: e.job, kind: 'payment_check', channel: 'web', status: 'skipped', error: 'note', body });
  if (em) console.error('payments: job text not written', e.session, String(em.message).slice(0, 200));
}
/** that Stripe page (or refund) was kept aside for the office before */
async function parkedBefore(session: string): Promise<boolean> {
  const { data: known, error } = await adminDb().from('activity').select('id').eq('action', 'payment_parked').eq('data->>session', session).limit(1);
  if (error) throw error;
  return !!known?.length;
}
/** kept aside once: the history row of that Stripe page (or refund) is written only if it is not there yet */
async function park(e: Entry, why: string): Promise<Applied> {
  if (!(await parkedBefore(e.session))) await note('payment_parked', e, why);
  return 'parked';
}

/** payment_add, never refusing money already moved */
async function record(e: Entry): Promise<Applied> {
  // kept aside for the office already: it stays so (the office enters it by hand), never in the books a second time
  if (await parkedBefore(e.session)) return 'parked';
  const db = adminDb();
  const add = (invoice: string | null) => db.rpc('payment_add', { p_op: e.op, p_invoice: invoice, p_amount_cents: e.amount, p_method: 'card_online',
    p_reference: e.reference, p_job: e.job, p_session: e.session });
  let { error } = await add(e.invoice);
  if (!error) return 'applied';
  if (already(error)) return 'already';
  let why = never(error);
  if (!why) throw error;
  if (e.invoice && e.job) {
    // that invoice no longer takes it (cancelled, removed, reopened): the money moved all the same, so it goes on the job
    ({ error } = await add(null));
    if (!error) { await note('payment_moved', e, why); return 'applied'; }
    if (already(error)) return 'already';
    const again = never(error);
    if (!again) throw error;
    why = again;
  }
  // refused for good: kept in the history (once), the notice is not asked for again
  return park(e, why);
}

/** a paid card page (Stripe Checkout session) */
export async function applyCheckout(session: Row): Promise<Applied> {
  if (session?.payment_status !== 'paid') return 'ignored';
  const md = session.metadata || {};
  const amount = Math.round(Number(session.amount_total || 0));
  const invoice = uuid(md.invoice_id), job = uuid(md.job_id);
  const id = String(session.id || '');
  if (!id || !(amount > 0) || (!invoice && !job)) return 'ignored';
  const db = adminDb();
  const { data: seen, error } = await db.from('payments').select('id').eq('stripe_session', id).maybeSingle();
  if (error) throw error;
  if (seen) return 'already';
  return record({ op: await stripeOp(`checkout:${id}`), invoice, job, amount, reference: String(session.payment_intent || id), session: id, kind: 'payment' });
}

/** every refund Stripe holds for a payment (asked from Stripe: its notices do not carry the list) */
async function refundsOf(key: string, intent: string): Promise<Row[]> {
  const all: Row[] = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ payment_intent: intent, limit: '100' });
    if (after) q.set('starting_after', after);
    const d = await stripeCall(key, 'GET', `/refunds?${q}`);
    const list = (Array.isArray(d?.data) ? d.data : []) as Row[];
    all.push(...list);
    if (!d?.has_more || !list.length) break;
    after = String(list[list.length - 1].id);
  }
  return all;
}

/** the payment of the app this Stripe payment made (its reference is Stripe's payment id), or null */
async function paymentOf(pi: string): Promise<Row | null> {
  const { data, error } = await adminDb().from('payments').select('id, invoice_id, job_id, stripe_session').eq('reference', pi).eq('method', 'card_online')
    .gt('amount_cents', 0).is('deleted_at', null).order('created_at').limit(1).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}
/** the card page of the app that made this Stripe payment (asked from Stripe), when it is one of ours and paid */
async function checkoutOf(key: string, pi: string): Promise<Row | null> {
  const d = await stripeCall(key, 'GET', `/checkout/sessions?${new URLSearchParams({ payment_intent: pi, limit: '5' })}`);
  const list = (Array.isArray(d?.data) ? d.data : []) as Row[];
  return list.find((s) => s?.payment_status === 'paid' && (uuid(s.metadata?.job_id) || uuid(s.metadata?.invoice_id))) || null;
}

/** Money given back in Stripe for the payment `intent` (notices « charge.refunded », « charge.refund.updated »): each
    refund that passed is a negative card payment, once (kept as « <card page>#<refund> »), on the invoice the payment is
    on (or on the job). A refund still on its way is left for Stripe's next notice; one that failed after it was written
    is taken back by the opposite amount (« …#echec »). Stripe not answering is thrown: the notice comes again.
    The payment itself not in the books yet (its notice still being retried, or lost): it is recorded first, from Stripe's
    own card page; a payment kept aside for the office gets its refunds kept aside beside it (never a payment entered by
    hand that was already given back without a word). */
export async function applyRefunds(key: string, intent: unknown): Promise<Applied> {
  const pi = typeof intent === 'string' ? intent : '';
  if (!/^[A-Za-z0-9_]{6,120}$/.test(pi)) return 'ignored';
  const db = adminDb();
  let p = await paymentOf(pi);
  let parkedPage: Row | null = null;
  if (!p) {
    const sess = await checkoutOf(key, pi);
    if (!sess) return 'ignored';                        // not a payment of the app
    const first = await applyCheckout(sess);
    if (first === 'parked') parkedPage = sess;
    else if (first === 'ignored') return 'ignored';
    else if (!(p = await paymentOf(pi))) {
      // recorded under another reference (an older row): kept aside rather than lost
      parkedPage = sess;
    }
  }
  const refunds = await refundsOf(key, pi);
  if (parkedPage) {
    const md = parkedPage.metadata || {};
    const done: Applied[] = [];
    for (const r of refunds) {
      const id = String(r?.id || ''), amount = Math.round(Number(r?.amount || 0));
      if (r?.status !== 'succeeded' || !/^[A-Za-z0-9_]{4,120}$/.test(id) || !(amount > 0)) continue;
      done.push(await park({ op: await stripeOp(`refund:${id}`), invoice: uuid(md.invoice_id), job: uuid(md.job_id), amount: -amount, reference: id,
        session: `${String(parkedPage.id)}#${id}`, kind: 'refund' }, 'paiement pas inscrit'));
    }
    return done.length ? 'parked' : 'ignored';
  }
  p = p as Row;
  const page = String(p.stripe_session || pi);
  const { data: rows, error: e2 } = await db.from('payments').select('stripe_session').like('stripe_session', `${page.replace(/[%_\\]/g, '\\$&')}#%`);
  if (e2) throw e2;
  const have = new Set(((rows || []) as Row[]).map((r) => String(r.stripe_session)));
  const done: Applied[] = [];
  for (const r of refunds) {
    const id = String(r?.id || ''), amount = Math.round(Number(r?.amount || 0));
    if (!/^[A-Za-z0-9_]{4,120}$/.test(id) || !(amount > 0)) continue;
    const session = `${page}#${id}`, back = `${session}#echec`;
    const base = { invoice: uuid(p.invoice_id), job: uuid(p.job_id), reference: id };
    if (r.status === 'succeeded') {
      done.push(have.has(session) ? 'already' : await record({ ...base, op: await stripeOp(`refund:${id}`), amount: -amount, session, kind: 'refund' }));
    } else if ((r.status === 'failed' || r.status === 'canceled') && have.has(session)) {
      done.push(have.has(back) ? 'already' : await record({ ...base, op: await stripeOp(`refund-failed:${id}`), amount, session: back, kind: 'refund_failed' }));
    }
  }
  return done.includes('applied') ? 'applied' : done.includes('parked') ? 'parked' : done.includes('already') ? 'already' : 'ignored';
}
