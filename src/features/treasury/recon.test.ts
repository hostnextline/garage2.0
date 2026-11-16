import { describe, it, expect } from 'vitest';
import { normalizeRecon, openCount, shownFindings, allBalanced, findingText, findingTarget, isMissingFunction, type ReconSummary } from './recon';

const SHEET = { invoiced_cents: 45990, received: [{ method: 'debit', by: 'u1', by_name: 'Saleh', cents: 22995 }], refunded_cents: 0, expenses: [{ category: 'Carburant', cents: 6629 }], coffre_in_cents: 0, coffre_out_cents: 0, to_receive_cents: 22995 };
const summary = (x: Record<string, unknown>): ReconSummary => {
  const a = normalizeRecon(x);
  if (!a.available) throw new Error('not available');
  return a.summary;
};

describe('« Rapprochement d’hier »: the server’s answer', () => {
  it('reads the contract: last run, its sheet, the runs, the findings', () => {
    const s = summary({ ok: true, can_ack: true, last_run: { day: '2026-11-14', status: 'ok', finished_at: '2026-11-15T07:41:00Z', counts: { M1: '0' }, sheet: SHEET },
      runs: [{ day: '2026-11-13', status: 'warn' }, { day: '2026-11-14', status: 'ok' }], findings: [] });
    expect(s.can_ack).toBe(true);
    expect(s.last_run).toMatchObject({ day: '2026-11-14', status: 'ok', counts: { M1: 0 } });
    expect(s.last_run!.sheet!.received[0]).toEqual({ method: 'debit', by: 'u1', by_name: 'Saleh', cents: 22995 });
    expect(s.runs.map((r) => r.day)).toEqual(['2026-11-14', '2026-11-13']);
    expect(allBalanced(s)).toBe(true);
  });
  it('tolerant: missing or odd fields never throw', () => {
    const s = summary({ last_run: null, runs: 'x', findings: [{ id: 7, severity: 'huge', state: 'new' }, { severity: 'bad' }] });
    expect(s).toMatchObject({ can_ack: false, last_run: null, runs: [] });
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0]).toMatchObject({ id: '7', severity: 'warn', state: 'open', message_fr: '', entity_id: null });
    expect(allBalanced(s)).toBe(false);
    expect(summary({ last_run: { day: '2026-11-14', status: 'ok' } }).last_run!.sheet).toBeNull();
  });
  it('not a reconciliation: the demo’s « { ok: true } », a refusal, nothing at all', () => {
    expect(normalizeRecon({ ok: true })).toEqual({ available: false });
    expect(normalizeRecon({ ok: false, last_run: null })).toEqual({ available: false });
    expect(normalizeRecon(null)).toEqual({ available: false });
    expect(normalizeRecon({ runs: [] }).available).toBe(true);
  });
  it('a function the server does not have yet is recognised', () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.recon_summary' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
    expect(isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingFunction(Object.assign(new Error('Failed to fetch'), { code: '' }))).toBe(false);
  });
});

describe('« Rapprochement d’hier »: what the panel shows', () => {
  const f = (id: string, severity: string, state = 'open', last_day = '2026-11-14') =>
    ({ id, check_id: 'M2', severity, state, last_day, entity_table: 'invoices', entity_id: 'inv-' + id, message_fr: `Facture ${id}`, message_en: `Invoice ${id}` });
  it('the most serious first, then the newest; what was seen goes after; closed ones are gone', () => {
    const s = summary({ last_run: { day: '2026-11-14', status: 'bad' }, findings: [f('a', 'info'), f('b', 'warn'), f('c', 'bad', 'acked'), f('d', 'bad'), f('e', 'bad', 'closed'), f('g', 'warn', 'open', '2026-11-13')] });
    expect(shownFindings(s).map((x) => x.id)).toEqual(['d', 'b', 'g', 'a', 'c']);
    expect(openCount({ available: true, summary: s })).toBe(3);
    expect(openCount({ available: false })).toBe(0);
    expect(allBalanced(s)).toBe(false);
  });
  it('« Tout balance » holds with only a piece of information or what was already seen', () => {
    expect(allBalanced(summary({ last_run: { day: '2026-11-14', status: 'ok' }, findings: [f('a', 'info'), f('b', 'bad', 'acked')] }))).toBe(true);
    expect(allBalanced(summary({ last_run: { day: '2026-11-14', status: 'warn' }, findings: [] }))).toBe(false);
    expect(allBalanced(summary({ last_run: null, runs: [] }))).toBe(false);
  });
  it('the words in the person’s language, the other one when missing', () => {
    const s = summary({ runs: [], findings: [f('a', 'bad'), { id: 'z', message_fr: 'Seulement en français' }] });
    expect(findingText(s.findings[0], 'en')).toBe('Invoice a');
    expect(findingText(s.findings[0], 'fr')).toBe('Facture a');
    expect(findingText(s.findings[1], 'en')).toBe('Seulement en français');
  });
  it('each difference opens what it is about', () => {
    const pay = (id: string) => (id === 'p1' ? { invoice_id: 'i9', job_id: null } : id === 'p2' ? { invoice_id: null, job_id: 'j9' } : undefined);
    expect(findingTarget({ entity_table: 'invoices', entity_id: 'i1' }, pay)).toEqual({ href: '#/invoice/i1' });
    expect(findingTarget({ entity_table: 'jobs', entity_id: 'j1' }, pay)).toEqual({ href: '#/job/j1' });
    expect(findingTarget({ entity_table: 'inventory_items', entity_id: 'x' }, pay)).toEqual({ href: '#/inventory' });
    expect(findingTarget({ entity_table: 'expenses', entity_id: 'e1' }, pay)).toEqual({ expense: 'e1' });
    expect(findingTarget({ entity_table: 'payments', entity_id: 'p1' }, pay)).toEqual({ href: '#/invoice/i9' });
    expect(findingTarget({ entity_table: 'payments', entity_id: 'p2' }, pay)).toEqual({ href: '#/job/j9' });
    expect(findingTarget({ entity_table: 'payments', entity_id: 'p3' }, pay)).toBeNull();
    expect(findingTarget({ entity_table: 'coffre', entity_id: null }, pay)).toEqual({ href: '#/coffre' });
    expect(findingTarget({ entity_table: 'ops_backup_runs', entity_id: 'b' }, pay)).toBeNull();
  });
});
