// The card page a Stripe refund is written under in « payments » (« <page>#<refund> »), found by the SAME rule as
// _shared/payments.ts applyRefunds, so the reconciliation expects the row the server really writes:
//   1. the payment in the books (its reference is Stripe's payment id): page = its « stripe_session », or Stripe's payment
//      id when it has none (applyRefunds: `p.stripe_session || pi`) — Stripe is not asked;
//   2. else the paid page of the garage's app for that payment (a page of the last 72 hours already seen, else asked from
//      Stripe): the refunds of a payment the books do not have are kept aside beside that page (« <cs>#<refund> »);
//   3. else not a payment of the garage's app: not ours to check (null).
// No import: plain code, read by the function (Deno) and by the API test (Node) alike.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);

type Row = Record<string, any>;
export interface RefundPage { page: string; job: string | null; invoice: string | null; from: 'books' | 'stripe' }

/** `row` = the card payment of the books for that Stripe payment (or null); `seen` = a paid page already listed;
    `stripe` = Stripe's paid page for that payment (asked only when the books do not have it) */
export async function refundPage(pi: string, row: () => Promise<Row | null | undefined>, seen: Row | undefined,
  stripe: () => Promise<Row | null | undefined>): Promise<RefundPage | null> {
  if (!pi) return null;
  const p = await row();
  if (p) return { page: String(p.stripe_session || pi), job: uuid(p.job_id), invoice: uuid(p.invoice_id), from: 'books' };
  const s = seen ?? (await stripe());
  if (!s || (s.payment_status != null && s.payment_status !== 'paid')) return null;
  const job = uuid(s.metadata?.job_id), invoice = uuid(s.metadata?.invoice_id);
  if (!job && !invoice) return null;
  return { page: String(s.id), job, invoice, from: 'stripe' };
}
