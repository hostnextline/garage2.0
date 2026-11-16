/* « Trésorerie »: the report follows the expenses (bug 01), the export warning only when the phone really misses
   something, and « Rapprochement d'hier » (hidden on a server without it, « Tout balance », the differences, « Vu »).
   The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

type Answer = (args: Record<string, unknown>) => unknown;
const answers = new Map<string, Answer>();
const calls: { name: string; args: Record<string, unknown> }[] = [];
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    rpcNow: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const a = answers.get(name);
      if (!a) throw Object.assign(new Error(`Could not find the function public.${name}`), { code: 'PGRST202' });
      return a(args);
    }
  };
});
import TreasuryScreen from './TreasuryScreen';
import { replaceLocal, upsertLocal } from '../../data/store';
import { access } from '../../data/auth';
import { net } from '../../data/sync';
import { lang } from '../../lib/i18n';
import { today } from '../../lib/dates';
import type { Access, Expense } from '../../data/types';

let person = 0;
const who = (): Access => ({ id: `u${++person}`, full_name: 'Louis', short_name: 'Louis', email: null, phone: null, roles: ['treasurer'], owner: false, lang: 'fr', prefs: {}, color: null,
  rights: { treasury: true }, trucks: [], card_online: false, texts_online: false } as unknown as Access);
const expense = (id: string, total: number, extra: Partial<Expense> = {}): Expense => ({ id, day: today(), vendor: 'NAPA', category: 'Pièces', description: null, subtotal_cents: total, tps_cents: 0, tvq_cents: 0, total_cents: total, method: null, truck_id: null, receipt_id: null, notes: null, created_at: '2026-11-01T10:00:00Z', ...extra } as Expense);
/** the server's report, from the rows it holds */
let serverRows: Expense[] = [];
const report = () => {
  const sum = (k: 'subtotal_cents' | 'tps_cents' | 'tvq_cents' | 'total_cents') => serverRows.reduce((n, e) => n + e[k], 0);
  return { revenue: { subtotal: 0, tps: 0, tvq: 0, total: 0, count: 0 }, expenses: { subtotal: sum('subtotal_cents'), tps: sum('tps_cents'), tvq: sum('tvq_cents'), total: sum('total_cents'), count: serverRows.length }, by_category: [], collected: [] };
};

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const show = async () => { await act(async () => { render(null, box); render(<TreasuryScreen params={{}} query={new URLSearchParams()} />, box); }); await wait(); await wait(); };
const reportsAsked = () => calls.filter((c) => c.name === 'treasury_report').length;

beforeEach(() => {
  lang.value = 'fr'; calls.length = 0; answers.clear();
  answers.set('treasury_report', () => report());
  access.value = who();
  net.value = { ...net.value, online: true, pending: 0, sending: false };
  serverRows = [expense('e1', 9771)];
  replaceLocal('expenses', serverRows);
  replaceLocal('invoices', []);
});

describe('Trésorerie: the report follows the expenses (bug 01)', () => {
  it('an expense saved here: the report is asked again once it is sent, and no false warning', async () => {
    await show();
    expect(reportsAsked()).toBe(1);
    expect(q('export-mismatch').length).toBe(0);
    // saved on the phone, still waiting to be sent: nothing asked yet, and no warning meanwhile
    await act(async () => { net.value = { ...net.value, pending: 1 }; upsertLocal('expenses', [expense('e2', 11498)], { force: true }); });
    await wait(1400);
    await wait(1400);
    expect(reportsAsked()).toBe(1);
    expect(q('export-mismatch').length).toBe(0);
    // sent: the server has it, the report is asked again and agrees
    serverRows = [...serverRows, expense('e2', 11498)];
    // (effects run when each act ends: one turn for the hook to see the change, then its pause)
    await act(async () => { net.value = { ...net.value, pending: 0 }; });
    await wait(1400);
    await wait();
    expect(reportsAsked()).toBe(2);
    expect(q('treasury-profit')[0].textContent).toMatch(/212,69/);
    expect(q('export-mismatch').length).toBe(0);
  });
  it('the warning stays when the server holds something the phone does not, with nothing waiting', async () => {
    serverRows = [expense('e1', 9771), expense('e9', 5000)];
    await show();
    expect(q('export-mismatch').length).toBe(1);
  });
  it('same count, other amounts (changed on another phone): the warning too', async () => {
    serverRows = [expense('e1', 9000)];
    await show();
    expect(q('export-mismatch').length).toBe(1);
  });
});

describe('Trésorerie: « Rapprochement d’hier »', () => {
  const SHEET = { invoiced_cents: 45990, received: [{ method: 'debit', by: 'u1', by_name: 'Saleh', cents: 22995 }], refunded_cents: 0, expenses: [], coffre_in_cents: 0, coffre_out_cents: 0, to_receive_cents: 22995 };
  it('a server without it: nothing shown, the screen works', async () => {
    await show();
    expect(calls.some((c) => c.name === 'recon_summary' && c.args.p_days === 14)).toBe(true);
    expect(q('treasury-recon').length).toBe(0);
    expect(q('treasury-report').length).toBe(1);
  });
  it('everything balances: « Tout balance » and the day’s sheet', async () => {
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day: '2026-11-14', status: 'ok', finished_at: '2026-11-15T07:40:00Z', counts: {}, sheet: SHEET }, runs: [], findings: [] }));
    await show();
    expect(q('recon-ok').length).toBe(1);
    expect(q('recon-sheet')[0].textContent).toMatch(/Reçu : Débit, Saleh/);
  });
  it('differences: in plain words, each opens what it is about; « Vu » goes to the server, then the panel asks again', async () => {
    let state = 'open';
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day: '2026-11-14', status: 'bad', counts: {} }, runs: [],
      findings: [{ id: 'f1', check_id: 'M2', severity: 'bad', entity_table: 'invoices', entity_id: 'i7', message_fr: 'La facture 1042 dit payée mais il manque 20,00 $.', message_en: 'x', first_day: '2026-11-14', last_day: '2026-11-14', state }] }));
    answers.set('recon_ack', () => { state = 'acked'; return { ok: true }; });
    await show();
    const row = q('recon-finding')[0];
    expect(row.textContent).toMatch(/il manque 20,00/);
    expect(row.getAttribute('href')).toBe('#/invoice/i7');
    await act(async () => { q('recon-ack')[0].click(); });
    await wait(); await wait();
    expect(calls.find((c) => c.name === 'recon_ack')?.args).toEqual({ p_finding: 'f1', p_note: null });
    expect(q('recon-ack').length).toBe(0);
    expect(location.hash).not.toBe('#/invoice/i7');
  });
});
