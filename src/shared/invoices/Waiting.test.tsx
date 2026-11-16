/* What waits on the phone, as the invoice panel and the pay sheet show it: a payment taken with no signal is never
   offered a second time; a « Terminer la facture » waiting for the network shows the invoice finished and lets the
   mechanic take the payment (it waits behind the finish). The outbox is pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { OutboxEntry } from '../../data/local';

const outbox = vi.hoisted(() => ({ list: [] as OutboxEntry[] }));
vi.mock('../../domain/money/waiting', async (orig) => ({ ...(await orig<typeof import('../../domain/money/waiting')>()), waitingEntries: () => outbox.list }));

import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access, Invoice, Job } from '../../data/types';
import { InvoicePanel } from './InvoicePanel';
import { PaySheet } from './PaySheet';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 50) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const job = { id: 'j-1', number: 101, status: 'on_site', customer_id: 'c-1', truck_id: 't-1', day: '2026-11-17', block: 'pm', created_by: null } as unknown as Job;
const inv = (o: Partial<Invoice> = {}) => ({ id: 'f-1', job_id: 'j-1', customer_id: 'c-1', status: 'issued', number: 51, lang: 'fr', taxes_on: true, notes: null,
  lines: [{ description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' }],
  subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 0, created_at: '2026-11-17T14:00:00Z', issued_at: '2026-11-17T15:00:00Z', ...o }) as unknown as Invoice;
const rpc = (name: string, args: Record<string, unknown>): OutboxEntry => ({ op: `op-${name}`, kind: 'rpc', rpc: name, args, at: '2026-11-17T15:10:00Z', tries: 0, state: 'pending' });
const cash = (cents: number) => rpc('payment_add', { p_invoice: 'f-1', p_amount_cents: cents, p_method: 'cash', p_reference: null, p_job: 'j-1', p_session: null, p_op: 'x' });

beforeEach(() => {
  lang.value = 'fr';
  access.value = { id: 'u-1', full_name: 'Saleh', short_name: null, email: null, phone: null, roles: ['mechanic'], owner: false, lang: 'fr', prefs: {}, color: null, rights: {} as Access['rights'], trucks: ['t-1'] };
  replaceLocal('jobs', [job]);
  replaceLocal('job_items', []);
  replaceLocal('payments', []);
  outbox.list = [];
});
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; });

describe('a payment kept on the phone', () => {
  it('the whole balance waits: no « Encaisser » again, the panel and the sheet say it waits, with its amount', async () => {
    replaceLocal('invoices', [inv()]);
    outbox.list = [cash(11498)];
    act(() => render(<InvoicePanel jobId="j-1" />, box));
    await wait();
    expect(q('invoice-pay')).toBeNull();
    expect(q('pay-waiting')?.textContent).toMatch(/Paiement en attente d’envoi.*114,98/s);
    expect(q('payments')?.textContent).toContain('En attente du réseau');
    act(() => render(<PaySheet open invoiceId="f-1" onClose={() => undefined} />, box));
    await wait();
    expect(q('pay-confirm')).toBeNull();
    expect(q('pay-waiting')?.textContent).toMatch(/114,98/);
  });
  it('a part waits: only the rest is offered', async () => {
    replaceLocal('invoices', [inv()]);
    outbox.list = [cash(4000)];
    act(() => render(<PaySheet open invoiceId="f-1" onClose={() => undefined} />, box));
    await wait();
    expect(q('pay-balance')?.textContent).toMatch(/74,98/);
    expect(q('pay-waiting-part')?.textContent).toMatch(/40,00/);
  });
});

describe('« Terminer la facture » waiting for the network', () => {
  it('the draft is shown finished, read-only, and « Encaisser » its total works', async () => {
    replaceLocal('invoices', [inv({ status: 'draft', number: null, subtotal_cents: 0, tps_cents: 0, tvq_cents: 0, total_cents: 0, issued_at: null })]);
    outbox.list = [{ ...rpc('invoice_finish', { p_invoice: 'f-1', p_op: 'y' }), tries: 1 }];
    act(() => render(<InvoicePanel jobId="j-1" />, box));
    await wait();
    expect(q('lines-editor')).toBeNull();
    expect(q('invoice-finish')).toBeNull();
    expect(q('invoice-pay')?.textContent).toMatch(/Encaisser 114,98/);
    // nothing that needs the number yet
    expect(q('invoice-send')).toBeNull();
    expect(q('invoice-void')).toBeNull();
    act(() => render(<PaySheet open invoiceId="f-1" onClose={() => undefined} />, box));
    await wait();
    expect(q('pay-balance')?.textContent).toMatch(/114,98/);
    expect(q('pay-cash')).not.toBeNull();
  });
});
