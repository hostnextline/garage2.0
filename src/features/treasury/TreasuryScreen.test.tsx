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
const saved: { data: string; name: string }[] = [];
vi.mock('../../shared/export/download', async (orig) => {
  const real = await orig<typeof import('../../shared/export/download')>();
  return { ...real, saveFile: (data: Uint8Array | string, name: string) => { saved.push({ data: typeof data === 'string' ? data : '', name }); } };
});
const work = { signature: 0, period: 0 };
vi.mock('./select', async (orig) => {
  const real = await orig<typeof import('./select')>();
  return {
    ...real,
    rowsSignature: (...a: Parameters<typeof real.rowsSignature>) => { work.signature++; return real.rowsSignature(...a); },
    periodExpenses: (...a: Parameters<typeof real.periodExpenses>) => { work.period++; return real.periodExpenses(...a); }
  };
});
import TreasuryScreen from './TreasuryScreen';
import { replaceLocal, upsertLocal } from '../../data/store';
import { access } from '../../data/auth';
import { net } from '../../data/sync';
import { lang } from '../../lib/i18n';
import { today, addDays, longDay, clock, minuteOf } from '../../lib/dates';
import type { Access, Customer, Expense, Invoice } from '../../data/types';

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
  replaceLocal('customers', []);
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

describe('Trésorerie: a redraw does not redo the period’s work (review fluidite-05)', () => {
  it('the phone starting and stopping to send redraws the screen, but the rows of the period are not filtered or signed again', async () => {
    await show();
    const before = { ...work };
    expect(before.signature).toBeGreaterThan(0);
    for (const sending of [true, false, true, false]) {
      await act(async () => { net.value = { ...net.value, sending }; });
      await wait();
    }
    expect(work).toEqual(before);
    // a new row of the period does: once
    await act(async () => { upsertLocal('expenses', [expense('e3', 1000)], { force: true }); });
    await wait();
    expect(work.period).toBe(before.period + 1);
    expect(work.signature).toBe(before.signature + 1);
  });
});

describe('Trésorerie: the accountant’s files follow the names (review TR-4)', () => {
  it('a customer renamed during the visit: the CSV has the new name', async () => {
    access.value = { ...who(), rights: { treasury: true, invoices: true } } as unknown as Access;
    replaceLocal('customers', [{ id: 'c1', first_name: 'Marc', last_name: 'Tremblay', company: null } as unknown as Customer]);
    replaceLocal('invoices', [{ id: 'i1', number: 1042, status: 'paid', customer_id: 'c1', subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 11498, issued_at: `${today()}T17:00:00Z` } as unknown as Invoice]);
    await show();
    await act(async () => { upsertLocal('customers', [{ id: 'c1', first_name: 'Marc', last_name: 'Gagnon', company: null } as unknown as Customer], { force: true }); });
    await wait();
    saved.length = 0;
    await act(async () => { q('export-csv')[0].click(); });
    expect(saved[0].data).toMatch(/Marc Gagnon/);
    expect(saved[0].data).not.toMatch(/Tremblay/);
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
  const title = () => q('treasury-recon')[0].querySelector('h2, h3, .panel-title')?.textContent ?? q('treasury-recon')[0].textContent ?? '';
  /** the night's check of a day finishes the next day at 07:40 UTC (cron 'garage-recon') */
  const night = (day: string) => `${addDays(day, 1)}T07:40:00Z`;
  const panelText = () => q('treasury-recon')[0].textContent ?? '';
  const warn = { id: 'f2', check_id: 'M5', severity: 'warn', entity_table: null, entity_id: null, message_fr: 'Une dépense sans reçu.', message_en: 'x', first_day: '2026-11-10', last_day: '2026-11-14', state: 'open' };
  it('review rapprochement-05: with a difference open, the day’s sheet (cash received per person) is still shown, with its day', async () => {
    const day = addDays(today(), -1);
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day, status: 'warn', finished_at: night(day), counts: {}, sheet: SHEET }, runs: [], findings: [warn] }));
    await show();
    expect(q('recon-ok').length).toBe(0);
    expect(q('recon-finding').length).toBe(1);
    expect(q('recon-sheet')[0].textContent).toMatch(/Reçu : Débit, Saleh/);
    expect(q('recon-sheet-day')[0].textContent).toMatch(/^Journée du /);
    expect(title()).toMatch(/Rapprochement d’hier/);
  });
  it('review rapprochement-05: after « Vérifier maintenant » the server answers today so far: the title and the sheet say today', async () => {
    const day = today();
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day, status: 'ok', finished_at: `${day}T14:00:00Z`, counts: {}, sheet: SHEET }, runs: [], findings: [] }));
    await show();
    expect(title()).toMatch(/Rapprochement d’aujourd’hui/);
    expect(title()).not.toMatch(/hier/);
    expect(q('recon-sheet-day')[0].textContent).toBe('Aujourd’hui jusqu’ici');
    expect(q('recon-sheet').length).toBe(1);
  });
  it('review rapprochement-05: the night’s check did not run: « Dernier rapprochement », the sheet with its day; in English too', async () => {
    const day = addDays(today(), -3);
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day, status: 'ok', finished_at: night(day), counts: {}, sheet: SHEET }, runs: [], findings: [] }));
    await show();
    expect(title()).toMatch(/Dernier rapprochement/);
    lang.value = 'en';
    await wait();
    expect(title()).toMatch(/Latest reconciliation/);
    expect(q('recon-sheet-day')[0].textContent).toMatch(/^Day of /);
  });
  it('review treasury-recon-r2-1: « Vérifier maintenant » at 14 h yesterday, read today before the night’s check: not the whole day', async () => {
    const day = addDays(today(), -1);
    // 19:00 UTC = 14 h (EST) or 15 h (EDT) in Montréal, on that same day
    const at = `${day}T19:00:00Z`;
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day, status: 'ok', finished_at: at, counts: {}, sheet: SHEET }, runs: [], findings: [] }));
    await show();
    const cap = q('recon-sheet-day')[0].textContent ?? '';
    expect(cap).toBe(`Journée du ${longDay(day, 'fr')}, jusqu’à ${clock(minuteOf(new Date(at)), 'fr')}`);
    expect(cap).toMatch(/jusqu’à 1[45] h$/);
    expect(q('recon-sheet').length).toBe(1);
    lang.value = 'en';
    await wait();
    expect(q('recon-sheet-day')[0].textContent).toMatch(/^Day of .*, until [23] p\.m\.$/);
  });
  it('review treasury-recon-r2-2: no finish time: « Journée du » once in the panel (the sub line), no caption repeating it', async () => {
    const day = addDays(today(), -1);
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day, status: 'ok', finished_at: null, counts: {}, sheet: SHEET }, runs: [], findings: [] }));
    await show();
    expect(panelText().match(/Journée du/g)?.length).toBe(1);
    expect(q('recon-sheet-day').length).toBe(0);
    expect(q('recon-sheet').length).toBe(1);
  });
  it('review treasury-recon-r2-2: with the finish time in the sub line, the caption still gives the day', async () => {
    const day = addDays(today(), -1);
    answers.set('recon_summary', () => ({ ok: true, can_ack: true, last_run: { day, status: 'ok', finished_at: night(day), counts: {}, sheet: SHEET }, runs: [], findings: [] }));
    await show();
    expect(panelText()).toMatch(/Vérifié le /);
    expect(panelText().match(/Journée du/g)?.length).toBe(1);
    expect(q('recon-sheet-day')[0].textContent).toBe(`Journée du ${longDay(day, 'fr')}`);
  });
});
