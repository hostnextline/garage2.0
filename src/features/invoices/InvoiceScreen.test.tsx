/* One invoice (#/invoice/:id), drawn with the device's copy: who is offered what beside the document. The server is
   pretended (nothing is sent). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access, Invoice, Job, Payment } from '../../data/types';
import InvoiceScreen from './InvoiceScreen';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const draw = async () => { act(() => render(<InvoiceScreen params={{ id: 'f-1' }} query={new URLSearchParams()} />, box)); await wait(); };

const job = (o: Partial<Job> = {}) => ({ id: 'j-1', number: 101, status: 'on_site', customer_id: 'c-1', truck_id: 't-1', day: '2026-11-17', block: 'pm', created_by: null, ...o }) as unknown as Job;
const inv = (o: Partial<Invoice> = {}) => ({ id: 'f-1', job_id: 'j-1', customer_id: 'c-1', status: 'issued', number: 51, lang: 'fr', taxes_on: true, notes: null,
  lines: [{ description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' }],
  subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 0, created_at: '2026-11-17T14:00:00Z', issued_at: '2026-11-17T15:00:00Z', ...o }) as unknown as Invoice;
const pay = (id: string, cents: number, o: Partial<Payment> = {}) => ({ id, invoice_id: 'f-1', job_id: 'j-1', amount_cents: cents, method: 'cash', reference: null,
  paid_at: '2026-11-17T15:10:00Z', created_at: '2026-11-17T15:10:00Z', created_by: 'u-1', deleted_at: null, ...o }) as unknown as Payment;
const owner: Access = { id: 'u-1', full_name: 'Hassan', short_name: null, email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null, rights: {} as Access['rights'], trucks: [] };
const mechanic: Access = { ...owner, id: 'u-2', full_name: 'Saleh', roles: ['mechanic'], owner: false, trucks: ['t-1'] };

beforeEach(() => {
  lang.value = 'fr';
  access.value = owner;
  replaceLocal('customers', []);
  replaceLocal('job_items', []);
  replaceLocal('messages', []);
  replaceLocal('payments', []);
});
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; });

describe('« Modifier la facture » on the invoice screen (R42)', () => {
  it('a paid invoice of a job under way can be changed; once the job is done, no more', async () => {
    replaceLocal('jobs', [job()]);
    replaceLocal('invoices', [inv({ status: 'paid', paid_cents: 11498 })]);
    replaceLocal('payments', [pay('p-1', 11498)]);
    await draw();
    expect(q('invoice-reopen')).not.toBeNull();
    act(() => replaceLocal('jobs', [job({ status: 'done' })]));
    await wait();
    expect(q('invoice-reopen')).toBeNull();
  });
});

describe('« Trop-perçu » on the invoice screen (review argent-app-02)', () => {
  it('the mechanic of the job is told to tell the office: no « Inscrire le remboursement » (the server would refuse it)', async () => {
    access.value = mechanic;
    replaceLocal('jobs', [job()]);
    replaceLocal('invoices', [inv({ status: 'paid', paid_cents: 20000 })]);
    replaceLocal('payments', [pay('p-1', 20000)]);
    await draw();
    expect(q('invoice-over')?.textContent).toContain('Dis-le au bureau');
    expect(q('invoice-refund')).toBeNull();
  });
  it('the owner records it', async () => {
    replaceLocal('jobs', [job()]);
    replaceLocal('invoices', [inv({ status: 'paid', paid_cents: 20000 })]);
    replaceLocal('payments', [pay('p-1', 20000)]);
    await draw();
    expect(q('invoice-over')?.textContent).toContain('inscris-la ici');
    expect(q('invoice-refund')).not.toBeNull();
  });
});
