import { describe, it, expect } from 'vitest';
import { normalizeRecon, openCount, shownFindings, allBalanced, findingText, findingTarget, isMissingFunction, runWhen, sheetCaption, checkOutcome, newerFinish, type ReconSummary } from './recon';

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
  it('« Tout balance » holds with only a piece of information', () => {
    expect(allBalanced(summary({ last_run: { day: '2026-11-14', status: 'ok' }, findings: [f('a', 'info'), f('c', 'bad', 'closed')] }))).toBe(true);
    expect(allBalanced(summary({ last_run: { day: '2026-11-14', status: 'warn' }, findings: [] }))).toBe(false);
    expect(allBalanced(summary({ last_run: null, runs: [] }))).toBe(false);
  });
  it('review argent-recon-seen: a difference « Vu » is still a difference: no « Tout balance », it stays listed', () => {
    const s = summary({ last_run: { day: '2026-11-14', status: 'ok' }, findings: [f('b', 'bad', 'acked'), f('a', 'info')] });
    expect(allBalanced(s)).toBe(false);
    expect(shownFindings(s).map((x) => x.id)).toEqual(['a', 'b']);
    expect(openCount({ available: true, summary: s })).toBe(0);
    expect(allBalanced(summary({ last_run: { day: '2026-11-14', status: 'ok' }, findings: [f('w', 'warn', 'acked')] }))).toBe(false);
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
  it('review TR-7: an expense the phone does not hold (deleted, not synced yet) opens nothing, so no link', () => {
    const pay = () => undefined;
    const has = (id: string) => id === 'e1';
    expect(findingTarget({ entity_table: 'expenses', entity_id: 'e1' }, pay, has)).toEqual({ expense: 'e1' });
    expect(findingTarget({ entity_table: 'expenses', entity_id: 'e2' }, pay, has)).toBeNull();
  });
});

describe('review rapprochement-05: which day the last check is about', () => {
  it('yesterday (the night’s check), today so far (« Vérifier maintenant »), or older (the night did not run)', () => {
    expect(runWhen('2026-11-15', '2026-11-16')).toBe('yesterday');
    expect(runWhen('2026-11-16', '2026-11-16')).toBe('today');
    expect(runWhen('2026-11-14', '2026-11-16')).toBe('older');
    // across a month and a year
    expect(runWhen('2026-11-30', '2026-12-01')).toBe('yesterday');
    expect(runWhen('2026-12-31', '2027-01-01')).toBe('yesterday');
  });
});

describe('review treasury-recon-r2-1 / r2-2: the caption above the day’s sheet', () => {
  it('« Vérifier maintenant » at 14 h Sunday, read Monday: Sunday only up to 14 h, not the whole day', () => {
    // 2026-11-15T19:00Z = 14 h in Montréal (EST), whatever the machine's zone
    expect(sheetCaption({ day: '2026-11-15', finished_at: '2026-11-15T19:00:00Z' }, '2026-11-16')).toEqual({ kind: 'until', day: '2026-11-15', minute: 14 * 60 });
    // 23 h 30 in Montréal is 04:30Z the next day: still the same Montréal day, still « so far »
    expect(sheetCaption({ day: '2026-11-15', finished_at: '2026-11-16T04:30:00Z' }, '2026-11-16')).toEqual({ kind: 'until', day: '2026-11-15', minute: 23 * 60 + 30 });
    // an older day seen the same way
    expect(sheetCaption({ day: '2026-11-13', finished_at: '2026-11-13T15:00:00Z' }, '2026-11-16')).toEqual({ kind: 'until', day: '2026-11-13', minute: 10 * 60 });
  });
  it('the night’s check (07:40 UTC the next day): the whole day', () => {
    expect(sheetCaption({ day: '2026-11-15', finished_at: '2026-11-16T07:40:00Z' }, '2026-11-16')).toEqual({ kind: 'day', day: '2026-11-15' });
    // « Vérifier maintenant » today re-checks yesterday too: finished today, so yesterday is whole
    expect(sheetCaption({ day: '2026-11-15', finished_at: '2026-11-16T14:00:00Z' }, '2026-11-16')).toEqual({ kind: 'day', day: '2026-11-15' });
  });
  it('today so far, whatever the finish time', () => {
    expect(sheetCaption({ day: '2026-11-16', finished_at: '2026-11-16T14:00:00Z' }, '2026-11-16')).toEqual({ kind: 'today' });
    expect(sheetCaption({ day: '2026-11-16', finished_at: null }, '2026-11-16')).toEqual({ kind: 'today' });
  });
  it('no finish time: no caption (the sub line already says « Journée du … »); a finish time that is not a date: the day', () => {
    expect(sheetCaption({ day: '2026-11-15', finished_at: null }, '2026-11-16')).toBeNull();
    expect(sheetCaption({ day: '2026-11-15', finished_at: 'pas une date' }, '2026-11-16')).toEqual({ kind: 'day', day: '2026-11-15' });
  });
});

describe('review argent-recon-brake: what « Vérifier maintenant » got back', () => {
  const tap = Date.parse('2026-11-16T15:04:20Z');
  const summaryAt = (finished_at: string | null, extra: Record<string, unknown> = {}) => ({ ok: true, can_ack: true, last_run: { day: '2026-11-16', status: 'ok', finished_at, counts: {} }, runs: [], findings: [], ...extra });
  it('a server that says it braked: braked, try again at its next_at', () => {
    expect(checkOutcome(summaryAt('2026-11-16T15:04:02Z', { braked: true, next_at: '2026-11-16T15:05:00Z' }), '2026-11-16T15:04:02Z', tap))
      .toEqual({ braked: true, nextAt: new Date('2026-11-16T15:05:00Z') });
  });
  it('braked without next_at, or with one that is not a time or already past: the next minute after the tap', () => {
    for (const next_at of [undefined, 'soon', '2026-11-16T15:00:00Z', 42]) {
      expect(checkOutcome(summaryAt(null, { braked: true, next_at }), null, tap)).toEqual({ braked: true, nextAt: new Date('2026-11-16T15:05:00Z') });
    }
  });
  it('a server that says it checked: not braked, even when the finish time did not move', () => {
    expect(checkOutcome(summaryAt('2026-11-16T15:04:02Z', { braked: false }), '2026-11-16T15:04:02Z', tap)).toEqual({ braked: false });
  });
  it('an older server (no « braked »): the finish time did not move past the one the panel had → braked', () => {
    expect(checkOutcome(summaryAt('2026-11-16T15:04:02Z'), '2026-11-16T15:04:02.000+00:00', tap)).toEqual({ braked: true, nextAt: new Date('2026-11-16T15:05:00Z') });
    expect(checkOutcome(summaryAt('2026-11-16T15:03:00Z'), '2026-11-16T15:04:02Z', tap).braked).toBe(true);
  });
  it('an older server: a newer finish time is a check that ran; nothing to compare with says nothing', () => {
    expect(checkOutcome(summaryAt('2026-11-16T15:04:21Z'), '2026-11-16T15:04:02Z', tap)).toEqual({ braked: false });
    expect(checkOutcome(summaryAt('2026-11-16T15:04:21Z'), null, tap)).toEqual({ braked: false });
    expect(checkOutcome(summaryAt(null), '2026-11-16T15:04:02Z', tap)).toEqual({ braked: false });
    expect(checkOutcome(null, '2026-11-16T15:04:02Z', tap)).toEqual({ braked: false });
    expect(checkOutcome({ ok: true }, '2026-11-16T15:04:02Z', tap)).toEqual({ braked: false });
  });
  it('the newer of two finish times', () => {
    expect(newerFinish(null, '2026-11-16T15:04:02Z')).toBe('2026-11-16T15:04:02Z');
    expect(newerFinish('2026-11-16T15:05:00Z', '2026-11-16T15:04:02Z')).toBe('2026-11-16T15:05:00Z');
    expect(newerFinish('2026-11-16T15:04:02Z', '2026-11-16T15:05:00Z')).toBe('2026-11-16T15:05:00Z');
    expect(newerFinish('x', null)).toBeNull();
    expect(newerFinish(undefined, undefined)).toBeNull();
  });
});
