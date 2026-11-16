import { describe, it, expect } from 'vitest';
import type { OutboxEntry } from '../../data/local';
import { paymentsWaiting, waitingCents, waitingSplit, notOnServer, CLOCK_ROOM_MS, finishWaiting, makeWaiting, coffreWaiting, rowWaiting, waitingForNetwork, type PaidRow } from './waiting';

const at = '2026-11-15T12:00:00.000Z';
const rpc = (name: string, args: Record<string, unknown>, tries = 0): OutboxEntry => ({ op: `op-${name}-${Math.random()}`, kind: 'rpc', rpc: name, args, at, tries, state: 'pending' });
const pay = (invoice: string | null, cents: number, job: string | null = 'j-1', tries = 0) =>
  rpc('payment_add', { p_invoice: invoice, p_amount_cents: cents, p_method: 'cash', p_reference: null, p_job: job, p_session: null, p_op: 'x' }, tries);

describe('what waits on this phone about money', () => {
  it('a payment taken with no signal (or still on its way) is counted, even never retried', () => {
    const list = [pay('f-1', 11498), pay('f-2', 5000), rpc('invoice_finish', { p_invoice: 'f-1' })];
    expect(paymentsWaiting(list, { invoiceId: 'f-1', jobId: 'j-1' }).map((p) => p.cents)).toEqual([11498]);
    expect(waitingCents(paymentsWaiting(list, { invoiceId: 'f-1' }))).toBe(11498);
    expect(waitingCents(paymentsWaiting(list, { invoiceId: 'f-3' }))).toBe(0);
  });
  it('a payment on the job without an invoice counts for that job; a refund is negative', () => {
    const list = [pay(null, 2000, 'j-1'), pay('f-1', -500)];
    expect(waitingCents(paymentsWaiting(list, { invoiceId: 'f-1', jobId: 'j-1' }))).toBe(1500);
    expect(waitingCents(paymentsWaiting(list, { invoiceId: 'f-9', jobId: 'j-2' }))).toBe(0);
  });
  it('a finish, a new invoice, the Coffre, an autosave: each for its own row', () => {
    const list: OutboxEntry[] = [
      rpc('invoice_finish', { p_invoice: 'f-1' }), rpc('invoice_for_job', { p_job: 'j-1', p_refresh: true }), rpc('coffre_add', { p_jobs: ['j-4', 'j-5'], p_amount: 0 }),
      { op: 'u', kind: 'update', table: 'invoices', id: 'f-2', values: { notes: 'x' }, at, tries: 0, state: 'pending' }
    ];
    expect(finishWaiting(list, 'f-1')).toBe(true);
    expect(finishWaiting(list, 'f-2')).toBe(false);
    expect(makeWaiting(list, 'j-1')).toHaveLength(1);
    expect(coffreWaiting(list, 'j-5')).toBe(true);
    expect(coffreWaiting(list, 'j-1')).toBe(false);
    expect(rowWaiting(list, 'invoices', 'f-2')).toBe(true);
    expect(rowWaiting(list, 'invoices', 'f-1')).toBe(false);
    expect(rowWaiting(list, 'quotes', 'f-2')).toBe(false);
  });
  it('a payment and a refund waiting are summed apart', () => {
    const list = paymentsWaiting([pay('f-1', 1000), pay('f-1', -2755), pay('f-1', 500)], { invoiceId: 'f-1' });
    expect(waitingSplit(list)).toEqual({ in: 1500, out: -2755 });
    expect(waitingSplit([])).toEqual({ in: 0, out: 0 });
  });
  it('online, what was never retried is on its way: « pas de réseau » is not said for it', () => {
    const list = [{ tries: 0 }, { tries: 2 }];
    expect(waitingForNetwork(list, true)).toEqual([{ tries: 2 }]);
    expect(waitingForNetwork(list, false)).toHaveLength(2);
  });
});

/* The server's answer reaches the phone before the outbox lets the operation go (review inv-r1): a payment the phone
   already holds as a row is not counted a second time as waiting. */
describe('a waiting payment the server already answered', () => {
  const row = (id: string, cents: number, o: Partial<PaidRow> = {}): PaidRow => ({ id, invoice_id: 'f-1', job_id: 'j-1', amount_cents: cents, method: 'cash', reference: null, created_at: '2026-11-15T12:00:02.000Z', created_by: 'u-1', ...o });
  const none = () => undefined;
  const waiting = (list: OutboxEntry[]) => paymentsWaiting(list, { invoiceId: 'f-1', jobId: 'j-1' });

  it('its row arrived (the answer, or realtime): no longer waiting', () => {
    const w = waiting([pay('f-1', 11498)]);
    expect(notOnServer(w, [row('p-1', 11498)], { known: none, me: 'u-1' })).toEqual([]);
  });
  it('a row the phone already had when it first saw the payment waiting is an older payment, not its answer', () => {
    const w = waiting([pay('f-1', 5000)]);
    // the first half paid earlier, the same amount, the same way: the second half still waits
    expect(notOnServer(w, [row('p-old', 5000)], { known: () => new Set(['p-old']), me: 'u-1' })).toHaveLength(1);
  });
  it('a row that says something else is not its answer', () => {
    const w = waiting([pay('f-1', 11498)]);
    const keep = (r: PaidRow) => notOnServer(w, [r], { known: none, me: 'u-1' }).length;
    expect(keep(row('p', 11000))).toBe(1);                                   // another amount
    expect(keep(row('p', 11498, { method: 'debit' }))).toBe(1);              // another way
    expect(keep(row('p', 11498, { reference: 'A-12' }))).toBe(1);            // a reference this one has not
    expect(keep(row('p', 11498, { invoice_id: 'f-2' }))).toBe(1);            // another invoice
    expect(keep(row('p', 11498, { created_by: 'u-2' }))).toBe(1);            // someone else took it
    expect(keep(row('p', 11498, { created_at: new Date(Date.parse(at) - CLOCK_ROOM_MS - 60000).toISOString() }))).toBe(1); // made well before it
    // made a little before it by the clocks (a phone a few minutes ahead): still its answer
    expect(keep(row('p', 11498, { created_at: new Date(Date.parse(at) - 3 * 60000).toISOString() }))).toBe(0);
  });
  it('two equal payments waiting, one answered: one still waits (each row answers one payment)', () => {
    const w = waiting([pay('f-1', 2000), pay('f-1', 2000)]);
    const left = notOnServer(w, [row('p-1', 2000)], { known: none, me: 'u-1' });
    expect(left).toHaveLength(1);
    expect(left[0].op).toBe(w[1].op);
  });
  it('a payment taken on the job (no invoice) is answered by the job\'s row, even put on the finished invoice by the server', () => {
    const w = paymentsWaiting([pay(null, 3000, 'j-1')], { invoiceId: 'f-1', jobId: 'j-1' });
    expect(notOnServer(w, [row('p-1', 3000, { invoice_id: 'f-1' })], { known: none, me: 'u-1' })).toEqual([]);
    expect(notOnServer(w, [row('p-1', 3000, { invoice_id: null, job_id: 'j-2' })], { known: none, me: 'u-1' })).toHaveLength(1);
  });
  it('a refund is answered by its negative row; the reference is compared as the server writes it (empty = none)', () => {
    const w = waiting([rpc('payment_add', { p_invoice: 'f-1', p_amount_cents: -2755, p_method: 'interac', p_reference: '', p_job: 'j-1', p_op: 'r' })]);
    expect(w[0].reference).toBeNull();
    expect(notOnServer(w, [row('p-r', -2755, { method: 'interac', reference: null })], { known: none, me: 'u-1' })).toEqual([]);
  });
  it('without knowing who is signed in (the demo), the person is not compared', () => {
    expect(notOnServer(waiting([pay('f-1', 100)]), [row('p', 100, { created_by: 'u-9' })], { known: none, me: '' })).toEqual([]);
  });
});
