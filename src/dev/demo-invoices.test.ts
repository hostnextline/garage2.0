/* The demo's pretend invoices (dev only) follow the server's rule of 2026-11-20: « Modifier la facture », a line taken
   off, the total now under what the customer paid: finished « paid » with its number, `over_cents` said, never refused.
   (Kept OUT of src/dev/demo-extra/: demo.ts loads every section file of that folder into the demo itself.) */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, rpcOf, find, put, type DemoRow } from './fake-server';
import { load } from './demo-extra/invoices';

const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown> & { rows?: Record<string, DemoRow[]> };
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const brakes = { description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' };
const wipers = { description: 'Essuie-glaces', qty: 1, unit_cents: 5000, taxable: true, kind: 'part' };
const as = (id: string) => { (globalThis as { __demoUser?: string }).__demoUser = id; };

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  put('settings', { id: '1', taxes: { enabled: true, tps: 0.05, tvq: 0.09975 } });
  // the people on screen: the owner (every right), and the mechanic who drives the job's truck
  put('staff', { id: 'u-hassan', roles: ['owner'], active: true });
  put('staff', { id: 'u-saleh', roles: ['mechanic'], active: true });
  put('trucks', { id: 't-x', name: 'Camion', driver_id: 'u-saleh', sort: 1 });
  as('u-hassan');
  load();
  put('jobs', { id: 'j-x', customer_id: 'c-x', truck_id: 't-x', status: 'on_site' });
  // finished and paid: 150 $ + taxes = 172,46 $
  put('invoices', { id: 'f-x', job_id: 'j-x', customer_id: 'c-x', number: 77, status: 'draft', taxes_on: true, lines: [brakes, wipers], paid_cents: 0, issued_at: null, due_on: null });
  expect(call('invoice_finish', { p_invoice: 'f-x' })).toMatchObject({ ok: true, number: 77 });
  put('payments', { id: 'p-x', invoice_id: 'f-x', job_id: 'j-x', amount_cents: 17246, method: 'cash' });
  put('invoices', { id: 'f-x', status: 'paid', paid_cents: 17246, issued_at: '2026-11-20T15:00:00.000Z', due_on: '2026-11-20' });
});

describe('demo: « Modifier la facture » then a total under what was paid', () => {
  it('the wipers do not fit, taken off: finished again « paid », same number and date, over_cents = what goes back', () => {
    expect(call('invoice_reopen', { p_invoice: 'f-x' })).toMatchObject({ ok: true, number: 77 });
    expect(find('invoices', 'f-x')).toMatchObject({ status: 'draft', number: 77, paid_cents: 0 });
    expect(find('payments', 'p-x')!.invoice_id).toBeNull();
    put('invoices', { id: 'f-x', lines: [brakes] });
    let r: Record<string, unknown> = {};
    expect(code(() => { r = call('invoice_finish', { p_invoice: 'f-x' }); })).toBe('ok');
    // 100 $ + taxes = 114,98 $; paid 172,46 $: 57,48 $ to give back
    expect(r).toMatchObject({ ok: true, number: 77, again: true, over_cents: 5748 });
    expect(find('invoices', 'f-x')).toMatchObject({ status: 'paid', number: 77, total_cents: 11498, paid_cents: 17246, issued_at: '2026-11-20T15:00:00.000Z', due_on: '2026-11-20' });
    expect(find('payments', 'p-x')!.invoice_id).toBe('f-x');
  });
  it('the mechanic of the job’s truck does the same, on his own phone: never refused', () => {
    as('u-saleh');
    expect(call('invoice_reopen', { p_invoice: 'f-x' })).toMatchObject({ ok: true, number: 77 });
    put('invoices', { id: 'f-x', lines: [brakes] });
    expect(call('invoice_finish', { p_invoice: 'f-x' })).toMatchObject({ ok: true, number: 77, again: true, over_cents: 5748 });
    expect(find('invoices', 'f-x')!.status).toBe('paid');
  });
  it('finished again at the same total: nothing over; a first finish under what was paid ahead says it too', () => {
    call('invoice_reopen', { p_invoice: 'f-x' });
    expect(call('invoice_finish', { p_invoice: 'f-x' })).toMatchObject({ again: true, over_cents: 0, number: 77 });
    put('jobs', { id: 'j-y', customer_id: 'c-x', status: 'on_site' });
    put('payments', { id: 'p-y', invoice_id: null, job_id: 'j-y', amount_cents: 20000, method: 'card_online' });
    put('invoices', { id: 'f-y', job_id: 'j-y', customer_id: 'c-x', number: null, status: 'draft', taxes_on: true, lines: [brakes], paid_cents: 0 });
    expect(call('invoice_finish', { p_invoice: 'f-y' })).toMatchObject({ again: false, number: 78, over_cents: 20000 - 11498 });
    expect(find('invoices', 'f-y')!.status).toBe('paid');
  });
  it('« Modifier la facture » only while the job is coming or under way', () => {
    put('jobs', { id: 'j-x', status: 'done' });
    expect(code(() => call('invoice_reopen', { p_invoice: 'f-x' }))).toBe('closed');
    expect(find('invoices', 'f-x')!.status).toBe('paid');
  });
});
