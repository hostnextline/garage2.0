import { describe, it, expect } from 'vitest';
import { coffreCandidates, normalizeCoffre, coffreSheet, coffreCsv, type CoffreLabels } from './logic';
import { nextStep } from '../jobs/nextStep';
import type { Job, Invoice } from '../../data/types';
import { coffre as fr } from '../../i18n/fr/coffre';
import { coffre as en } from '../../i18n/en/coffre';

const job = (id: string, extra: Partial<Job> = {}) => ({ id, customer_id: 'c1', status: 'done', day: '2026-11-0' + (id.length % 9), number: Number(id.replace(/\D/g, '')) || 1, coffre_id: null, deleted_at: null, ...extra } as unknown as Job);
const L: CoffreLabels = { sheet: 'Coffre', title: 'Rapport', period: 'Période :', day: 'Date', customer: 'Client', jobs: 'Jobs', work: 'Travaux', value: 'Valeur', amount: 'Reçu', note: 'Note', by: 'Par', total: 'Total' };

describe('« Coffre »: which jobs can go in it', () => {
  const jobs = [job('j1'), job('j2'), job('j3', { customer_id: 'c2' }), job('j4', { status: 'cancelled' }), job('j5', { coffre_id: 'k' }), job('j6'), job('j7')];
  const inv = (id: string): Invoice | undefined => (id === 'j6' ? { status: 'paid', paid_cents: 5000, deleted_at: null } as Invoice : undefined);
  const list = coffreCandidates(jobs[1], jobs, inv, (id) => id === 'j7');
  it('the same customer only, not cancelled, not already in it, nothing paid (this job first)', () => {
    expect(list.map((j) => j.id)).toEqual(['j2', 'j1']);
  });
});

describe('« Coffre »: a job in it is settled', () => {
  const rights = { act: true, invoice: true, payLater: false } as Parameters<typeof nextStep>[3];
  const ctx = { today: '2026-11-07' } as Parameters<typeof nextStep>[4];
  it('on site, signed: « Terminer », no invoice to make', () => {
    const j = { id: 'x', status: 'on_site', day: '2026-11-07', waiver_signed_at: 'now', pay_later: false, coffre_id: 'k' } as Job;
    expect(nextStep(j, [{ id: 'i', status: 'done' } as never], null, rights, ctx).kind).toBe('finish');
    expect(nextStep({ ...j, coffre_id: null }, [{ id: 'i', status: 'done' } as never], null, rights, ctx).kind).toBe('invoice');
  });
});

describe('« Coffre »: the report apart', () => {
  const r = normalizeCoffre({ rows: [
    { id: 'a', day: '2026-11-02', customer: 'Tante Rima', amount_cents: 10000, value_cents: 25000, job_numbers: [12, 14], job_ids: ['x', 'y'], work: 'Freins', note: 'Cadeau' },
    { id: 'b', day: '2026-11-05', customer: 'Karim', amount_cents: '0', value_cents: 8000, job_numbers: [20] }
  ] }, '2026-11-01', '2026-11-30');
  it('reads the answer and adds it up', () => {
    expect(r).toMatchObject({ count: 2, amount_cents: 10000, value_cents: 33000 });
    expect(r.rows[1]).toMatchObject({ amount_cents: 0, note: null, work: '' });
  });
  it('the Excel sheet: header, one line per entry, the totals', () => {
    const s = coffreSheet(r, L);
    expect(s.rows.length).toBe(4 + 2 + 1);
    expect(s.rows[4][2]).toBe('12, 14');
    expect(s.rows[6][5]).toEqual({ v: 100, s: 'boldMoney' });
  });
  it('the CSV in French: « ; » and the decimal comma', () => {
    const csv = coffreCsv(r, L, 'fr');
    expect(csv.split('\r\n')[1]).toBe('2026-11-02;Tante Rima;12 14;Freins;250,00;100,00;Cadeau;');
    expect(csv).toContain('Total;;2;;330,00;100,00;;');
  });
  it('every word exists in French and English', () => {
    const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !('one' in v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });
});
