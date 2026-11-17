/* The pretend server of ?demo (dev only): the steps of a job, the money and the booking rules are the database's. */
import { describe, it, expect, beforeEach } from 'vitest';
import { rpcOf, find, table, put } from './fake-server';
import { loadDemo } from './demo';
import { ME } from './demo-data';
import { addDays, today, dayOf } from '../lib/dates';

const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown>;
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const step = (job: string, action: string, data: Record<string, unknown> = {}) => call('job_step', { p_job: job, p_action: action, p_data: data });
const D = (n: number) => addDays(today(), n);
/** a coming Tuesday far enough to be empty (the Camion Complet works then) */
const freeTuesday = () => { for (let n = 20; n < 30; n++) if (new Date(D(n) + 'T12:00').getDay() === 2) return D(n); return D(21); };

describe('job_step: the steps and the money (demo-05, demo-06, demo-07)', () => {
  beforeEach(() => loadDemo(ME.owner));
  it('a job paid by the Coffre can be finished (job_paid)', () => {
    call('coffre_add', { p_jobs: ['j-2'], p_amount: 0 });
    expect(find('jobs', 'j-2')!.coffre_id).toBeTruthy();
    expect(code(() => step('j-2', 'finish'))).toBe('ok');
    expect(find('jobs', 'j-2')!.status).toBe('done');
  });
  it('« Défaire » on a finished job puts it back on site', () => {
    step('j-1', 'back');
    expect(find('jobs', 'j-1')).toMatchObject({ status: 'on_site', finished_at: null });
    expect(code(() => step('j-4', 'back'))).toBe('bad_step');   // booked: nothing to undo
  });
  it('« Je pars » is refused while the truck has an unpaid job on site', () => {
    expect(code(() => step('j-3', 'leave'))).toBe('unpaid_here');   // j-2 on site, not paid
    put('jobs', { id: 'j-2', pay_later: true });
    expect(code(() => step('j-3', 'leave'))).toBe('ok');
  });
  it('finish: only on site or en route; « paiera plus tard » needs the office and a finished invoice', () => {
    expect(code(() => step('j-4', 'finish', { pay_later: true }))).toBe('bad_step');
    expect(code(() => step('j-2', 'finish'))).toBe('pay_first');
    expect(code(() => step('j-2', 'finish', { pay_later: true }))).toBe('invoice_first');
    loadDemo(ME.saleh);
    expect(code(() => step('j-2', 'finish', { pay_later: true }))).toBe('pay_first');
    loadDemo(ME.owner);
    const inv = (call('invoice_for_job', { p_job: 'j-2' }).rows as { invoices: { id: string }[] }).invoices[0];
    call('invoice_finish', { p_invoice: inv.id });
    expect(code(() => step('j-2', 'finish', { pay_later: true, reason: 'Virement' }))).toBe('ok');
    expect(find('jobs', 'j-2')).toMatchObject({ status: 'done', pay_later: true, pay_later_reason: 'Virement' });
  });
  it('finish takes the confirmed parts off the stock, once', () => {
    put('jobs', { id: 'j-2', pay_later: true });
    put('invoices', { id: 'f-j2', job_id: 'j-2', customer_id: 'c-marc', status: 'issued', number: 77, total_cents: 1000, paid_cents: 0, lines: [] });
    const qty = Number(find('inventory_items', 'i-plaq')!.qty);
    step('j-2', 'finish', { parts: [{ item_id: 'i-plaq', qty: 1 }] });
    expect(find('inventory_items', 'i-plaq')!.qty).toBe(qty - 1);
  });
  it('cancel / no_show: the work\'s value is lost, the customer\'s no-shows count; reopen refused in the past', () => {
    step('j-4', 'no_show');
    expect(find('jobs', 'j-4')!.lost_cents).toBe(12000);
    expect(find('customers', 'c-kevin')!.no_shows).toBe(1);
    expect(code(() => step('j-y3', 'reopen'))).toBe('block_started');   // yesterday
    expect(code(() => step('j-1', 'cancel'))).toBe('bad_step');
  });
  it('arrive ends the trip; a mechanic may not move another truck\'s job without « Réserver »', () => {
    step('j-6', 'arrive');
    expect(find('trips', 'tr-1')!.status).toBe('arrived');
    loadDemo(ME.saleh);
    put('settings', { id: '1', role_rights: { mechanic: { book: false } } });
    expect(code(() => step('j-7', 'leave'))).toBe('not_allowed');
  });
});

describe('the money as the database counts it', () => {
  beforeEach(() => loadDemo(ME.owner));
  it('payment_add: never more than what is left, a refund only by the office and never more than paid', () => {
    expect(code(() => call('payment_add', { p_invoice: 'f-y2', p_amount_cents: 999999, p_method: 'cash' }))).toBe('too_much');
    expect(code(() => call('payment_add', { p_invoice: 'f-1', p_amount_cents: 100, p_method: 'cash' }))).toBe('too_much');   // paid
    expect(code(() => call('payment_add', { p_invoice: 'f-y2', p_amount_cents: 100, p_method: 'card_online' }))).toBe('method');
    expect(code(() => call('payment_add', { p_invoice: 'f-1', p_amount_cents: -99999999, p_method: 'cash' }))).toBe('refund_too_much');
    expect(code(() => call('payment_add', { p_invoice: 'f-1', p_amount_cents: -1000, p_method: 'cash' }))).toBe('ok');
    expect(find('invoices', 'f-1')!.status).toBe('issued');
  });
  it('« Encaissé » of the month is what was received that month; the treasury counts payments by method', () => {
    const month = today().slice(0, 7);
    const paidThisMonth = table('payments').filter((p) => !p.deleted_at && dayOf(new Date(String(p.paid_at))).slice(0, 7) === month).reduce((n, p) => n + Number(p.amount_cents), 0);
    expect(call('dashboard', { p_month: `${month}-01` }).collected_cents).toBe(paidThisMonth);
    expect(call('dashboard', { p_month: '2020-01-01' }).collected_cents).toBe(0);
    const tr = call('treasury_report', { p_from: '2020-01-01', p_to: '2020-01-31' });
    expect(tr.collected).toEqual([]);
    const all = call('treasury_report', { p_from: D(-400), p_to: D(0) }).collected as { method: string; total: number }[];
    const debit = table('payments').filter((p) => !p.deleted_at && p.method === 'debit' && dayOf(new Date(String(p.paid_at))) >= D(-400)).reduce((n, p) => n + Number(p.amount_cents), 0);
    expect(debit).toBeGreaterThan(0);
    expect(all.find((m) => m.method === 'debit')!.total).toBe(debit);
  });
  it('the Coffre keeps the work\'s value and refuses a job already paid', () => {
    expect(code(() => call('coffre_add', { p_jobs: ['j-1'], p_amount: 0 }))).toBe('has_payment');
    const r = call('coffre_add', { p_jobs: ['j-4'], p_amount: 5000 });
    expect(find('coffre', r.id)).toMatchObject({ value_cents: 12000, kind: 'received' });
    const rep = call('coffre_report', { p_from: D(-1), p_to: D(1) });
    expect(rep).toMatchObject({ amount_cents: 5000, value_cents: 12000, balance_cents: 5000 });
  });
});

describe('booking in block mode', () => {
  beforeEach(() => loadDemo(ME.owner));
  it('« Réserver quand même » books a full block at the end (demo-09); a mechanic may not force', () => {
    const day = freeTuesday();
    const book = (id: string, force = false) => call('book_job', { p_job: { id, customer_id: 'c-julie', day, block: 'am', duration_min: 100, truck_id: 't-complet', force }, p_items: [] });
    book('f1'); book('f2');
    expect(code(() => book('f3'))).toBe('truck_full');
    const r = book('f3', true);
    expect(r.forced).toBe(true);
    expect(find('jobs', 'f3')).toMatchObject({ forced: true, truck_id: 't-complet' });
    expect(find('jobs', 'f3')!.force).toBeUndefined();
    loadDemo(ME.saleh);
    expect(code(() => call('book_job', { p_job: { id: 'f4', customer_id: 'c-julie', day, block: 'pm', truck_id: 't-complet', force: true }, p_items: [] }))).toBe('not_allowed');
  });
  it('« Laisser l’app choisir » un-pins; a change of truck in the same block keeps the confirmation (demo-17)', () => {
    put('jobs', { id: 'j-t2', truck_pinned: true, confirm_sent_at: '2026-01-01T12:00:00.000Z' });
    const r = call('move_job', { p_job: 'j-t2', p_day: D(1), p_block: 'pm', p_truck: null });
    expect(r.unchanged).toBeUndefined();
    expect(find('jobs', 'j-t2')!.truck_pinned).toBe(false);
    expect(find('jobs', 'j-t2')!.confirm_sent_at).toBe('2026-01-01T12:00:00.000Z');
    expect(call('move_job', { p_job: 'j-t2', p_day: D(1), p_block: 'pm', p_truck: null }).unchanged).toBe(true);
  });
  it('a walk-in and a booking never get the same number (demo-18)', () => {
    const b = call('book_job', { p_job: { id: 'n-b', customer_id: 'c-julie', day: freeTuesday(), block: 'pm' }, p_items: [] });
    call('walk_in', { p_job: { id: 'n-w', customer_id: 'c-julie' }, p_items: [] });
    expect(b.ok).toBe(true);
    expect(find('jobs', 'n-w')!.number).not.toBe(find('jobs', 'n-b')!.number);
  });
  it('« Garde-route »: 0 switches a limit off (demo-19)', () => {
    const s = find('settings', '1')!;
    put('settings', { id: '1', booking: { ...(s.booking as object), max_hop_min: 0, max_day_drive_min: 0 } });
    const out = call('suggest_blocks', { p_lat: 45.58, p_lng: -73.75, p_from: D(1), p_days: 14, p_duration: 60, p_limit: 60 }) as unknown as { far: string | null }[];
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((x) => x.far === null)).toBe(true);
  });
});
