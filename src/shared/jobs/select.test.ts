/* The job as the screens show it, with what waits in the outbox (pretended here): after a restart, after the row changed
   for another reason, with a payment waiting (jobs-a-02, jobs-a-04, x-errors-14, jobs-b-07). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxEntry } from '../../data/local';

const box = vi.hoisted(() => ({ entries: [] as OutboxEntry[] }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), outboxList: () => Promise.resolve(box.entries) }));

import { net } from '../../data/sync';
import { upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import type { Job, Access } from '../../data/types';
import { seen, stepOf, itemsSeen, proposedOf, blockingJob } from './select';
import { pendingJobs } from './pending';

let n = 0;
const rpc = (name: string, args: Record<string, unknown>): OutboxEntry => ({ seq: ++n, op: `op${n}`, kind: 'rpc', rpc: name, args, at: '2026-11-15T14:00:00Z', tries: 1, state: 'pending' });
const JOB = (o: Partial<Job> = {}) => ({ id: 'j1', number: 1, status: 'booked', day: '2026-11-15', block: 'am', truck_id: 't1', customer_id: 'c1', vehicle_id: 'v1', waiver_signed_at: null, pay_later: false, coffre_id: null, updated_at: '2026-11-15T13:00:00Z', ...o } as unknown as Job);
/** the outbox changed: the screens read it again (the frame's count of waiting changes moves) */
async function outboxNow(entries: OutboxEntry[]) {
  box.entries = entries;
  pendingJobs();
  net.value = { ...net.value, pending: entries.length };
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  clearAll();
  access.value = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
  upsertLocal('vehicles', [{ id: 'v1', customer_id: 'c1', vin: '1HGCM82633A004352' }]);
  await outboxNow([]);
});

describe('steps kept on the phone survive a restart and a change of the row', () => {
  it('« Je pars » and « Je suis arrivé » waiting: on site, with the signature step next (nothing in memory: as after a restart)', async () => {
    await outboxNow([rpc('job_step', { p_job: 'j1', p_action: 'leave' }), rpc('job_step', { p_job: 'j1', p_action: 'arrive' })]);
    const j = JOB();
    expect(seen(j).status).toBe('on_site');
    expect(stepOf(j).kind).toBe('waiver');
    // the planner changed the arrival time meanwhile (another updated_at): still on site
    expect(seen({ ...j, eta_min: 640, updated_at: '2026-11-15T14:05:00Z' } as Job).status).toBe('on_site');
  });
  it('once the outbox is empty, the server’s row is shown', async () => {
    await outboxNow([rpc('job_step', { p_job: 'j1', p_action: 'leave' })]);
    expect(seen(JOB()).status).toBe('en_route');
    await outboxNow([]);
    expect(seen(JOB()).status).toBe('booked');
  });
});

describe('a payment waiting is not asked a second time', () => {
  it('« Encaisser » becomes « Terminer » while the payment covering it waits; the next job is not blocked by it', async () => {
    upsertLocal('invoices', [{ id: 'inv1', job_id: 'j1', status: 'issued', total_cents: 22995, paid_cents: 0, lines: [{ item_id: 'i1', description: 'x', qty: 1, unit_cents: 20000, taxable: true }] }]);
    upsertLocal('job_items', [{ id: 'i1', job_id: 'j1', status: 'done', qty: 1, unit_cents: 20000, sort: 1, description: 'Freins' }]);
    const here = JOB({ status: 'on_site', waiver_signed_at: 'x' });
    upsertLocal('jobs', [here, JOB({ id: 'j2', number: 2, status: 'booked' })]);
    expect(stepOf(here)).toEqual({ kind: 'pay', payLater: false, due: 22995 });
    expect(blockingJob(JOB({ id: 'j2' }))?.id).toBe('j1');
    await outboxNow([rpc('payment_add', { p_invoice: 'inv1', p_amount_cents: 22995, p_method: 'cash', p_job: null })]);
    expect(stepOf(here)).toEqual({ kind: 'finish', waiting: true });
    expect(blockingJob(JOB({ id: 'j2' }))).toBeUndefined();
  });
  it('a part paid: once the invoice shows it, still in the outbox a moment, it is not counted twice (jobs-r2)', async () => {
    upsertLocal('invoices', [{ id: 'inv2', job_id: 'j3', status: 'issued', total_cents: 10000, paid_cents: 0, lines: [{ item_id: 'i3', description: 'x', qty: 1, unit_cents: 10000, taxable: false }] }]);
    upsertLocal('job_items', [{ id: 'i3', job_id: 'j3', status: 'done', qty: 1, unit_cents: 10000, sort: 1, description: 'Freins' }]);
    const here = JOB({ id: 'j3', status: 'on_site', waiver_signed_at: 'x' });
    await outboxNow([rpc('payment_add', { p_invoice: 'inv2', p_amount_cents: 4000, p_method: 'cash', p_job: 'j3' })]);
    expect(stepOf(here)).toEqual({ kind: 'pay', payLater: false, due: 6000, waiting: true });
    // the server's answer lands before the entry leaves the outbox: 40 $ on the invoice, 60 $ still owed
    upsertLocal('invoices', [{ id: 'inv2', job_id: 'j3', status: 'issued', total_cents: 10000, paid_cents: 4000, lines: [{ item_id: 'i3', description: 'x', qty: 1, unit_cents: 10000, taxable: false }] }]);
    expect(stepOf(here)).toEqual({ kind: 'pay', payLater: false, due: 6000 });
    await outboxNow([]);
    expect(stepOf(here)).toEqual({ kind: 'pay', payLater: false, due: 6000 });
  });
});

describe('a customer’s answer waiting', () => {
  it('shows as given, and the red button goes on', async () => {
    upsertLocal('job_items', [{ id: 'x1', job_id: 'j1', status: 'proposed', qty: 1, unit_cents: 18000, sort: 1, description: 'Plaquettes' }]);
    const j = JOB({ status: 'on_site', waiver_signed_at: 'x' });
    expect(stepOf(j)).toEqual({ kind: 'answer', itemId: 'x1' });
    await outboxNow([rpc('extra_answer', { p_item: 'x1', p_accept: true, p_via: 'signature' })]);
    expect(itemsSeen('j1')[0].status).toBe('approved');
    expect(proposedOf('j1')).toEqual([]);
    expect(stepOf(j).kind).toBe('invoice');
  });
});
