/* The pretend server of ?demo (dev only) held to the app and to the database: every operation the app calls exists in
   it, an unknown one is never « ok », a person reads and changes only what the database lets them, nothing goes to the
   live project. */
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { handle, registeredRpcs, registeredFns, rpcOf, registerRpc, find, table } from './fake-server';
import { loadDemo, accessOf, sealDemo } from './demo';
import { ME } from './demo-data';
import { SUPABASE_URL } from '../lib/config';
import { sb } from '../data/auth';

const SRC = join(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'dev' ? [] : files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}
/** the names of the operations and server functions the app's code calls (the customer's page has its own demo) */
function appCalls() {
  const rpc = new Set<string>(), fn = new Set<string>();
  for (const p of files(SRC)) {
    if (p.includes(`${join('src', 'client')}`)) continue;
    const s = readFileSync(p, 'utf8');
    for (const m of s.matchAll(/(?:\.rpc|callRpc|sendOrKeep|rpcNow|change)(?:<[^(]*>)?\(\s*['"`]([a-z_]+)['"`]/g)) rpc.add(m[1]);
    for (const m of s.matchAll(/callFn(?:<[^(]*>)?\(\s*['"`]([a-z_-]+)['"`]/g)) fn.add(m[1]);
  }
  return { rpc: [...rpc].sort(), fn: [...fn].sort() };
}
const url = (path: string) => new URL(`${SUPABASE_URL}${path}`);
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const r = await handle(url(`/rest/v1/rpc/${name}`), { method: 'POST', body: JSON.stringify(args) });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}
async function get(t: string, query = '') {
  const r = await handle(url(`/rest/v1/${t}?select=*${query}`), { method: 'GET' });
  return (await r.json()) as { id: string; [k: string]: unknown }[];
}
const as = (id: string) => { loadDemo(id); };
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown>;

describe('demo-01: the demo knows every operation the app calls', () => {
  beforeEach(() => as(ME.owner));
  it('each database operation and server function called by the app is answered by the demo', () => {
    const { rpc: names, fn } = appCalls();
    expect(names.length).toBeGreaterThan(30);
    const known = new Set(registeredRpcs());
    expect(names.filter((n) => !known.has(n))).toEqual([]);
    // Hermes needs the garage's own server: the demo says « pas disponible » in words (not a silent « ok »)
    const fns = new Set(registeredFns());
    expect(fn.filter((n) => !fns.has(n) && n !== 'hermes')).toEqual([]);
  });
  it('an operation it does not know is answered like a database without that function, never « ok »', async () => {
    const r = await rpc('no_such_operation', { p_x: 1 });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('PGRST202');
    expect(r.body.ok).toBeUndefined();
  });
  it('a mistake inside a pretend operation is a refusal (400), not a 500 the app would send again for ever (demo-21)', async () => {
    registerRpc('demo_boom', () => { throw new Error('boom'); });
    const r = await rpc('demo_boom');
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'P0001', hint: 'demo_bug' });
  });
  it('a change sent again with the same p_op gets the first answer and is applied once', async () => {
    const before = Number(find('job_items', 'ji-3')!.unit_cents);
    const a = await rpc('job_item_price', { p_op: 'op-1', p_item: 'ji-3', p_unit_cents: 12000 });
    const b = await rpc('job_item_price', { p_op: 'op-1', p_item: 'ji-3', p_unit_cents: 99999 });
    expect(before).toBe(8999);
    expect(a.body.ok).toBe(true);
    expect(b.body).toEqual(a.body);
    expect(find('job_items', 'ji-3')!.unit_cents).toBe(12000);
  });
});

describe('demo-01: the operations that used to do nothing', () => {
  beforeEach(() => as(ME.owner));
  it('« Changer le prix » changes the line and the draft invoice; refused once the invoice is finished', () => {
    call('invoice_for_job', { p_job: 'j-3' });
    call('job_item_price', { p_item: 'ji-3', p_unit_cents: 10000 });
    expect(find('job_items', 'ji-3')!.unit_cents).toBe(10000);
    const inv = table('invoices').find((v) => v.job_id === 'j-3' && !v.deleted_at)!;
    expect(inv.subtotal_cents).toBe(10000);
    call('invoice_finish', { p_invoice: inv.id });
    expect(code(() => call('job_item_price', { p_item: 'ji-3', p_unit_cents: 5000 }))).toBe('invoice_done');
    expect(code(() => call('job_item_price', { p_item: 'ji-1a', p_unit_cents: 5000 }))).toBe('closed');
  });
  it('« Modifier la facture » opens a finished invoice again with its number; its payment waits on the job', () => {
    call('invoice_for_job', { p_job: 'j-2' });
    const inv = table('invoices').find((v) => v.job_id === 'j-2' && !v.deleted_at)!;
    const no = call('invoice_finish', { p_invoice: inv.id }).number;
    call('payment_add', { p_invoice: inv.id, p_amount_cents: 1000, p_method: 'cash', p_job: 'j-2' });
    const r = call('invoice_reopen', { p_invoice: inv.id });
    expect(r).toMatchObject({ ok: true, number: no });
    expect(find('invoices', inv.id)).toMatchObject({ status: 'draft', paid_cents: 0, number: no });
    expect(table('payments').filter((p) => p.job_id === 'j-2' && !p.invoice_id).length).toBe(1);
    const again = call('invoice_finish', { p_invoice: inv.id });
    expect(again).toMatchObject({ number: no, again: true });
    expect(find('invoices', inv.id)!.paid_cents).toBe(1000);
    expect(code(() => call('invoice_reopen', { p_invoice: 'f-1' }))).toBe('closed');   // job done
  });
  it('« Changer de client » moves the appointment, its car and its address, and asks to resend the confirmation', () => {
    const r = call('job_customer', { p_job: 'j-3', p_customer: 'c-kevin', p_vehicle: null });
    expect(r).toMatchObject({ ok: true, vehicle_id: 'v-kevin' });
    expect(find('jobs', 'j-3')).toMatchObject({ customer_id: 'c-kevin', vehicle_id: 'v-kevin', confirm_sent_at: null });
    expect(code(() => call('job_customer', { p_job: 'j-2', p_customer: 'c-kevin' }))).toBe('started');
    expect(code(() => call('job_customer', { p_job: 'j-4', p_customer: 'c-kevin' }))).toBe('same');
  });
  it('« Entrée » paid by the Trésorerie moves the stock and makes the expense; « Supprimer cet article » deletes it', () => {
    const qty = Number(find('inventory_items', 'i-filtre')!.qty);
    const r = call('inventory_buy', { p_item: 'i-filtre', p_qty: 4, p_total_cents: 4599, p_from: 'treasury', p_vendor: 'Lordco', p_note: null });
    expect(find('inventory_items', 'i-filtre')!.qty).toBe(qty + 4);
    const e = find('expenses', r.expense_id)!;
    expect(e).toMatchObject({ category: 'Pièces', total_cents: 4599 });
    expect(Number(e.subtotal_cents) + Number(e.tps_cents) + Number(e.tvq_cents)).toBe(4599);
    expect(code(() => call('inventory_buy', { p_item: 'i-filtre', p_qty: 1, p_total_cents: 100, p_from: 'coffre' }))).toBe('bad_from');
    call('inventory_delete', { p_item: 'i-filtre' });
    expect(find('inventory_items', 'i-filtre')).toBeUndefined();
    expect(table('inventory_moves').some((m) => m.item_id === 'i-filtre')).toBe(false);
  });
  it('the VIN history, the table of rights and the reconciliation answer like the server', () => {
    const v = call('vin_history', { p_vin: '2HGFC2F59KH512345', p_customer: 'c-julie' }) as { visits: { job_id: string; here: boolean; work: string[] }[] };
    expect(v.visits.map((x) => x.job_id)).toContain('j-1');
    expect(v.visits.every((x) => x.here)).toBe(true);
    expect(v.visits.some((x) => x.job_id === 'j-t3')).toBe(false);   // cancelled
    const t = call('rights_table', {}) as { rules: Record<string, Record<string, string>> };
    expect(t.rules.office.agenda).toBe('always');
    expect(t.rules.mechanic.settings).toBe('never');
    const s = call('recon_summary', { p_days: 14 }) as { last_run: { sheet: { invoiced_cents: number } }; runs: unknown[] };
    expect(s.runs.length).toBe(14);
    expect(s.last_run.sheet.invoiced_cents).toBeGreaterThan(0);   // yesterday's invoice of Patrick
  });
});

describe('demo-02: rights and row scope, as the database', () => {
  it('a mechanic without « Agenda » reads only the jobs of the vehicle he drives (and what he booked)', async () => {
    as(ME.saleh);
    const jobs = await get('jobs');
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.truck_id === 't-complet' || j.created_by === ME.saleh)).toBe(true);
    expect(jobs.some((j) => j.id === 'j-6')).toBe(false);   // Adam's job of today
    const items = await get('job_items');
    expect(items.some((i) => i.job_id === 'j-6')).toBe(false);
    // no « Trésorerie »: no expense, no receipt
    expect(await get('expenses')).toEqual([]);
    // « Clients » and « Factures » are his by default: every customer and invoice, as on live
    expect((await get('customers')).some((c) => c.id === 'c-amira')).toBe(true);
    // the owner reads everything
    as(ME.owner);
    expect((await get('jobs')).some((j) => j.id === 'j-6')).toBe(true);
    expect((await get('expenses')).length).toBeGreaterThan(0);
  });
  it('the operations refuse by right: the map, the numbers, the treasury, the team, an invoice cancelled', () => {
    as(ME.saleh);   // demo settings: mechanic money off
    expect(code(() => call('dashboard', { p_month: null }))).toBe('not_allowed');
    expect(code(() => call('treasury_report', { p_from: '2026-01-01', p_to: '2026-12-31' }))).toBe('not_allowed');
    expect(code(() => call('member_update', { p_staff: ME.adam, p_patch: { phone: null } }))).toBe('not_allowed');
    expect(code(() => call('invoice_void', { p_invoice: 'f-y2', p_reason: 'x' }))).toBe('not_allowed');
    expect(code(() => call('payment_remove', { p_payment: 'p-1' }))).toBe('not_allowed');
    expect(code(() => call('recon_summary', {}))).toBe('not_allowed');
    expect(code(() => call('job_step', { p_job: 'j-7', p_action: 'leave' }))).toBe('ok');   // demo settings give him « Réserver »
    as(ME.treasurer);
    expect(code(() => call('treasury_report', { p_from: '2026-01-01', p_to: '2026-12-31' }))).toBe('ok');
    expect(code(() => call('team_map', { p_day: null }))).toBe('ok');
  });
  it('a write the row rules refuse is answered 403, like PostgREST', async () => {
    as(ME.saleh);
    const r = await handle(url('/rest/v1/expenses'), { method: 'POST', body: JSON.stringify({ id: 'e-new', day: '2026-11-16', vendor: 'X', total_cents: 100 }) });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('42501');
    expect(find('expenses', 'e-new')).toBeUndefined();
    as(ME.treasurer);
    const ok = await handle(url('/rest/v1/expenses'), { method: 'POST', body: JSON.stringify({ id: 'e-new', day: '2026-11-16', vendor: 'X', total_cents: 100 }) });
    expect(ok.status).toBe(201);
  });
  it('my_access gives the rights by the always / can / never table (demo-25), access_of is the owner\'s only', () => {
    as(ME.saleh);
    // a personal « yes » never gives a right the role can never have
    table('staff').find((s) => s.id === ME.saleh)!.rights = { settings: true, edit_invoices: true, map: false };
    const a = accessOf(ME.saleh);
    expect(a.rights.settings).toBe(false);
    expect(a.rights.edit_invoices).toBe(false);
    expect(a.rights.map).toBe(false);
    expect(a.trucks).toEqual(['t-complet']);
    expect(call('access_of', { p_staff: ME.adam })).toBeNull();
  });
});

describe('the pretend REST: order and offset (demo-22, demo-23)', () => {
  beforeEach(() => as(ME.owner));
  it('order=…desc and offset are applied', async () => {
    const all = await get('jobs', '&order=id.asc');
    const ids = all.map((j) => j.id);
    expect(ids).toEqual([...ids].sort());
    const page = await get('jobs', '&order=id.asc&offset=2&limit=3');
    expect(page.map((j) => j.id)).toEqual(ids.slice(2, 5));
    const desc = await get('jobs', '&order=number.desc&limit=1');
    expect(desc[0].number).toBe(Math.max(...all.map((j) => Number(j.number))));
  });
});

describe('demo-03: nothing leaves for the live project', () => {
  it('the session kept on this browser is not renewed nor thrown away, and no live socket opens', async () => {
    const r = await handle(url('/auth/v1/token?grant_type=refresh_token'), { method: 'POST', body: '{}' });
    expect(r.status).toBe(503);   // « try later »: supabase-js keeps the stored session
    sealDemo();
    const before = (globalThis as { WebSocket?: unknown }).WebSocket;
    let opened = 0;
    (globalThis as { WebSocket?: unknown }).WebSocket = class { constructor() { opened++; } };
    try {
      sb.channel('demo-test').subscribe();
      expect(opened).toBe(0);
      expect(sb.realtime.isConnected()).toBe(false);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = before;
      void sb.removeAllChannels();
    }
  });
});
