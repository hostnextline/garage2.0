import { describe, it, expect } from 'vitest';
import { pendingOf, withSteps, withAnswer, paidWaiting } from './pending';
import type { OutboxEntry } from '../../data/local';
import type { JobStatus } from '../../data/types';

let n = 0;
const rpc = (name: string, args: Record<string, unknown>, state: 'pending' | 'failed' = 'pending'): OutboxEntry =>
  ({ seq: ++n, op: `op${n}`, kind: 'rpc', rpc: name, args: { p_op: `op${n}`, ...args }, at: `2026-11-15T14:0${n % 10}:00Z`, tries: 0, state });
const step = (job: string, action: string, state: 'pending' | 'failed' = 'pending') => rpc('job_step', { p_job: job, p_action: action, p_data: {} }, state);
const J = (status: JobStatus, waiver: string | null = null) => ({ id: 'j1', status, waiver_signed_at: waiver });
const play = (status: JobStatus, entries: OutboxEntry[], waiver: string | null = null) => withSteps(J(status, waiver), pendingOf(entries).steps.get('j1'));

describe('steps kept on the phone, read from the outbox (jobs-a-04: they survive a restart)', () => {
  it('Je pars, Je suis arrivé and the signature waiting: the job is shown on site and signed', () => {
    const r = play('booked', [step('j1', 'leave'), step('j1', 'arrive'), step('j1', 'waiver')]);
    expect(r.status).toBe('on_site');
    expect(r.waiver_signed_at).toBeTruthy();
  });
  it('a step the server already applied is not played twice (its row came back before the outbox forgot it)', () => {
    expect(play('en_route', [step('j1', 'leave'), step('j1', 'arrive')]).status).toBe('on_site');
    expect(play('on_site', [step('j1', 'leave'), step('j1', 'arrive')]).status).toBe('on_site');
    expect(play('done', [step('j1', 'finish')]).status).toBe('done');
    expect(play('on_site', [step('j1', 'waiver')], '2026-11-15T13:00:00Z').waiver_signed_at).toBe('2026-11-15T13:00:00Z');
  });
  it('a row changed for another reason keeps the steps waiting (no « base » to match any more)', () => {
    const job = { id: 'j1', status: 'booked' as JobStatus, waiver_signed_at: null, eta_min: 615 };
    expect(withSteps(job, pendingOf([step('j1', 'leave')]).steps.get('j1')).status).toBe('en_route');
  });
  it('a step another phone already did is not shown again', () => {
    // the office pressed « Je suis arrivé » on a stale screen while the truck was already there
    expect(play('on_site', [step('j1', 'arrive')]).status).toBe('on_site');
    expect(play('done', [step('j1', 'cancel')]).status).toBe('done');
  });
  it('« Revenir en arrière » undoes a step still waiting; one undoing the server’s step is left to the screen’s memory', () => {
    expect(play('booked', [step('j1', 'leave'), step('j1', 'back')]).status).toBe('booked');
    expect(play('booked', [step('j1', 'leave'), step('j1', 'arrive'), step('j1', 'back')]).status).toBe('en_route');
    expect(play('on_site', [step('j1', 'back')]).status).toBe('on_site');
  });
  it('cancel, no-show, reopen, finish', () => {
    expect(play('booked', [step('j1', 'cancel')]).status).toBe('cancelled');
    expect(play('on_site', [step('j1', 'no_show')]).status).toBe('no_show');
    expect(play('no_show', [step('j1', 'reopen')]).status).toBe('booked');
    expect(play('on_site', [step('j1', 'finish')]).status).toBe('done');
  });
  it('a refused step is not waiting (it is in the « refusé » banner); other jobs are left alone', () => {
    expect(play('booked', [step('j1', 'leave', 'failed')]).status).toBe('booked');
    expect(play('booked', [step('j2', 'leave')]).status).toBe('booked');
  });
  it('the same object when nothing changes (no redraw for nothing)', () => {
    const j = J('booked');
    expect(withSteps(j, [])).toBe(j);
    expect(withSteps(j, undefined)).toBe(j);
    expect(withSteps(j, [{ action: 'arrive', at: 'x' }])).toBe(j);
  });
});

describe('payments and answers waiting', () => {
  it('payments count per invoice, or per job when sent without one (jobs-a-02)', () => {
    const v = pendingOf([
      rpc('payment_add', { p_invoice: 'inv1', p_amount_cents: 5000, p_job: null }),
      rpc('payment_add', { p_invoice: 'inv1', p_amount_cents: 2000, p_job: null }),
      rpc('payment_add', { p_invoice: null, p_amount_cents: 1000, p_job: 'j1' }),
      rpc('payment_add', { p_invoice: 'inv1', p_amount_cents: 9999 }, 'failed'),
      rpc('payment_add', { p_invoice: 'inv2', p_amount_cents: 300 })
    ]);
    expect(paidWaiting(v, 'j1', 'inv1')).toBe(8000);
    expect(paidWaiting(v, 'j1', null)).toBe(1000);
    expect(paidWaiting(v, 'j9', 'inv2')).toBe(300);
    expect(paidWaiting(v, 'j9', 'inv9')).toBe(0);
  });
  it('a customer’s answer waiting shows as given (jobs-b-07)', () => {
    const v = pendingOf([rpc('extra_answer', { p_item: 'i1', p_accept: true, p_via: 'signature' }), rpc('extra_answer', { p_item: 'i2', p_accept: false, p_via: 'verbal' })]);
    expect(withAnswer({ id: 'i1', status: 'proposed' as const }, v.answers).status).toBe('approved');
    expect(withAnswer({ id: 'i2', status: 'proposed' as const }, v.answers).status).toBe('declined');
    // the server already has it: left as the server says
    expect(withAnswer({ id: 'i1', status: 'declined' as const }, v.answers).status).toBe('declined');
    const other = { id: 'i3', status: 'proposed' as const };
    expect(withAnswer(other, v.answers)).toBe(other);
  });
  it('an invoice asked and waiting', () => {
    expect(pendingOf([rpc('invoice_for_job', { p_job: 'j1', p_refresh: false })]).invoicing.has('j1')).toBe(true);
  });
  it('table writes and other operations are not steps', () => {
    const v = pendingOf([{ seq: 1, op: 'x', kind: 'insert', table: 'job_items', id: 'i', values: {}, at: '', tries: 0, state: 'pending' }, rpc('move_job', { p_job: 'j1' })]);
    expect(v.steps.size + v.paidOnInvoice.size + v.answers.size + v.invoicing.size).toBe(0);
  });
});
