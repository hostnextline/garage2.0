import { describe, it, expect } from 'vitest';
import type { OutboxEntry } from '../../data/local';
import { paymentsWaiting, waitingCents, finishWaiting, makeWaiting, coffreWaiting, rowWaiting, waitingForNetwork } from './waiting';

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
  it('online, what was never retried is on its way: « pas de réseau » is not said for it', () => {
    const list = [{ tries: 0 }, { tries: 2 }];
    expect(waitingForNetwork(list, true)).toEqual([{ tries: 2 }]);
    expect(waitingForNetwork(list, false)).toHaveLength(2);
  });
});
