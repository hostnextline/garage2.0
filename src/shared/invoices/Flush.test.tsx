/* The payment taken on this phone while the outbox really sends it (the real sync, with a pretend server): the
   server's answer (the invoice paid, the payment row) reaches the screen a moment before the outbox lets the
   operation go. In that moment the payment must not be counted twice: no « Trop-perçu » after an ordinary
   « Encaisser », no payment listed twice, and after a refund no « Encaisser » offered again. Every state the panel
   shows is watched (each render), not only the last one. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { replaceLocal, clearAll } from '../../data/store';
import { startSync, stopSync, syncOptions, net } from '../../data/sync';
import { addPayment } from '../../data/api';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access, Invoice, Job, Payment } from '../../data/types';
import { InvoicePanel } from './InvoicePanel';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 60) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await wait(20); };

const job = { id: 'j-1', number: 101, status: 'on_site', customer_id: 'c-1', truck_id: 't-1', day: '2026-11-17', block: 'pm', created_by: null } as unknown as Job;
const inv = (o: Partial<Invoice> = {}) => ({ id: 'f-1', job_id: 'j-1', customer_id: 'c-1', status: 'issued', number: 51, lang: 'fr', taxes_on: true, notes: null,
  lines: [{ description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' }],
  subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 0, created_at: '2026-11-17T14:00:00Z', issued_at: '2026-11-17T15:00:00Z', ...o }) as unknown as Invoice;
const payRow = (id: string, cents: number, by: string, at = new Date().toISOString()) =>
  ({ id, invoice_id: 'f-1', job_id: 'j-1', amount_cents: cents, method: 'cash', reference: null, stripe_session: null, note: null, paid_at: at, created_at: at, updated_at: at, deleted_at: null, created_by: by }) as Payment;

/* a pretend Supabase: pulls bring nothing new, each rpc waits until the test answers it */
interface Call { name: string; args: Record<string, unknown>; answer: (data: unknown) => void }
function server() {
  const calls: Call[] = [];
  const empty: Record<string, unknown> = new Proxy({}, {
    get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res, rej) : () => empty)
  });
  const client = {
    from: () => empty,
    rpc: (name: string, args: Record<string, unknown>) => new Promise((resolve) => { calls.push({ name, args, answer: (data) => resolve({ data, error: null }) }); }),
    auth: { refreshSession: async () => ({ error: null }) },
    channel: () => empty,
    removeChannel: async () => undefined
  };
  return { client: client as unknown as SupabaseClient, calls };
}

/* every state the panel showed */
function watch() {
  const seen = { over: false, payOffered: false, twice: false, rowsBefore: 0 };
  const look = () => {
    if (q('invoice-over')) seen.over = true;
    if (q('invoice-pay')) seen.payOffered = true;
    const list = q('payments');
    if (!list) return;
    const waitingRows = list.textContent!.split('En attente du réseau').length - 1;
    // a payment the server has (a new row) and the same one still listed as waiting
    if (waitingRows && list.children.length - waitingRows > seen.rowsBefore) seen.twice = true;
  };
  const mo = new MutationObserver(look);
  mo.observe(box, { subtree: true, childList: true, characterData: true, attributes: true });
  return Object.assign(seen, { look, stop: () => mo.disconnect() });
}

let n = 0;
beforeEach(() => {
  lang.value = 'fr';
  syncOptions.realtime = false;
});
afterEach(() => { act(() => render(null, box)); stopSync(); clearAll(); access.value = null; });

async function start() {
  const uid = `u-flush-${++n}-${Date.now()}`;
  access.value = { id: uid, full_name: 'Saleh', short_name: null, email: null, phone: null, roles: ['mechanic'], owner: false, lang: 'fr', prefs: {}, color: null, rights: {} as Access['rights'], trucks: ['t-1'] };
  const s = server();
  await startSync(s.client, uid);
  await wait();
  return { ...s, uid };
}

describe('a payment while the outbox sends it (the real flush)', () => {
  it('« Encaisser » online: never « Trop-perçu », never listed twice, then paid', async () => {
    const s = await start();
    replaceLocal('jobs', [job]);
    replaceLocal('job_items', []);
    replaceLocal('payments', []);
    replaceLocal('invoices', [inv()]);
    act(() => render(<InvoicePanel jobId="j-1" />, box));
    await wait();
    expect(q('invoice-pay')?.textContent).toMatch(/Encaisser 114,98/);
    const seen = watch();

    const paying = addPayment('f-1', 11498, 'cash', null, 'j-1');
    await until(() => s.calls.length === 1);
    await until(() => !!q('pay-waiting'));
    // on its way: counted, not offered again
    expect(q('invoice-pay')).toBeNull();
    expect(q('pay-waiting')?.textContent).toMatch(/114,98/);
    seen.payOffered = false;

    // the server answers: the invoice paid and its payment row arrive before the outbox lets the operation go
    await act(async () => { s.calls[0].answer({ ok: true, rows: { invoices: [inv({ status: 'paid', paid_cents: 11498 })], payments: [payRow('p-1', 11498, s.uid)] } }); });
    await paying;
    await until(() => !net.value.sending && net.value.pending === 0);
    await wait(100);
    seen.look();
    seen.stop();

    expect(seen.over).toBe(false);
    expect(seen.twice).toBe(false);
    expect(seen.payOffered).toBe(false);
    expect(q('invoice-over')).toBeNull();
    expect(q('pay-waiting')).toBeNull();
    expect(q('payments')?.children.length).toBe(1);
    expect(q('payments')?.textContent).not.toContain('En attente du réseau');
  });

  it('« Rembourser » online: the money paid twice is given back, « Encaisser » never comes back', async () => {
    const s = await start();
    const old = '2026-11-17T15:05:00Z';
    replaceLocal('jobs', [job]);
    replaceLocal('job_items', []);
    replaceLocal('payments', [payRow('p-1', 11498, s.uid, old), payRow('p-2', 11498, s.uid, '2026-11-17T15:06:00Z')]);
    replaceLocal('invoices', [inv({ status: 'paid', paid_cents: 22996 })]);
    act(() => render(<InvoicePanel jobId="j-1" />, box));
    await wait();
    expect(q('invoice-over')?.textContent).toMatch(/Trop-perçu.*114,98/s);
    const seen = watch();
    seen.rowsBefore = 2;

    const giving = addPayment('f-1', -11498, 'cash', null, 'j-1');
    await until(() => s.calls.length === 1);
    await until(() => !q('invoice-over'));
    expect(q('invoice-over')).toBeNull();

    await act(async () => {
      s.calls[0].answer({ ok: true, rows: { invoices: [inv({ status: 'paid', paid_cents: 11498 })], payments: [payRow('p-1', 11498, s.uid, old), payRow('p-2', 11498, s.uid, '2026-11-17T15:06:00Z'), payRow('p-3', -11498, s.uid)] } });
    });
    await giving;
    await until(() => !net.value.sending && net.value.pending === 0);
    await wait(100);
    seen.look();
    seen.stop();

    expect(seen.payOffered).toBe(false);
    expect(seen.over).toBe(false);
    expect(seen.twice).toBe(false);
    expect(q('payments')?.children.length).toBe(3);
    expect(q('payments')?.textContent).not.toContain('En attente du réseau');
  });
});
