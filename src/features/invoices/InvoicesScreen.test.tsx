/* « Factures »: the search follows the jobs that name an invoice's customer (review inv-r5). An invoice with no
   customer of its own is found by its job's customer; when that job changes (another customer), the list searched
   must follow at once, not keep the result worked out before. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access, Customer, Invoice, Job } from '../../data/types';
import InvoicesScreen from './InvoicesScreen';

const box = document.createElement('div');
document.body.appendChild(box);
const wait = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const rows = () => box.querySelectorAll('[data-testid="invoices-list"] .inv-rows > *').length;

const person = (id: string, first: string, last: string) => ({ id, first_name: first, last_name: last, company: null, phone: null, lang: 'fr' }) as unknown as Customer;
const job = (customer: string) => ({ id: 'j-1', number: 101, status: 'done', customer_id: customer, truck_id: 't-1', day: '2026-11-17', block: 'pm', created_by: null }) as unknown as Job;
const inv = { id: 'f-1', job_id: 'j-1', customer_id: null, status: 'issued', number: 51, lang: 'fr', taxes_on: true, notes: null,
  lines: [{ description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' }],
  subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 0, created_at: '2026-11-17T14:00:00Z', issued_at: '2026-11-17T15:00:00Z' } as unknown as Invoice;

beforeEach(() => {
  lang.value = 'fr';
  access.value = { id: 'u-1', full_name: 'Hassan', short_name: null, email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null, rights: {} as Access['rights'], trucks: [] };
});
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; });

describe('« Factures » searched', () => {
  it('the job of an invoice changes customer: the search follows it at once', async () => {
    replaceLocal('customers', [person('c-1', 'Julie', 'Tremblay'), person('c-2', 'Marc', 'Gagnon')]);
    replaceLocal('jobs', [job('c-2')]);
    replaceLocal('payments', []);
    replaceLocal('invoices', [inv]);
    act(() => render(<InvoicesScreen params={{}} query={new URLSearchParams('tab=all')} />, box));
    await wait();
    expect(rows()).toBe(1);
    const search = box.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => { search.value = 'Julie'; search.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait();
    expect(rows()).toBe(0);
    // the appointment was for Julie: the job is put right, the invoice is found by her name
    act(() => replaceLocal('jobs', [job('c-1')]));
    await wait();
    expect(rows()).toBe(1);
  });
});
