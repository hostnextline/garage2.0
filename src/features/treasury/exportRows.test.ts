import { describe, it, expect } from 'vitest';
import type { Expense, Invoice } from '../../data/types';
import { normalizeReport } from './report';
import { garageDay, revenueLines, expenseLines, exportMismatch, type LineNames } from './exportRows';
import { workbookSheets, type ExportLabels } from '../../shared/export/exports';
import { byCategory, categoryList, expenseMatches, filterCategories, methodLabel, periodExpenses, rowsSignature } from './select';
import { lang } from '../../lib/i18n';

const N: LineNames = { invoiceNumber: (v) => `F-${v.number}`, customer: (id) => `C ${id}`, status: (s) => s, method: (m) => m || '', truck: (id) => id || '' };
const NOV = { from: '2026-11-01', to: '2026-11-30' };
const inv = (x: Partial<Invoice>) => ({ id: 'i', number: 1, status: 'issued', customer_id: 'c', subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 0, issued_at: '2026-11-10T15:00:00Z', ...x } as Invoice);
const exp = (x: Partial<Expense>) => ({ id: 'e', day: '2026-11-05', vendor: 'NAPA', category: 'Pièces', description: null, subtotal_cents: 8498, tps_cents: 425, tvq_cents: 848, total_cents: 9771, method: 'debit', truck_id: null, receipt_id: null, notes: null, ...x } as Expense);

describe('the accountant’s lines', () => {
  it('x-time-09 / bug 24: an invoice is on its Montréal day, whatever the phone’s time zone', () => {
    // 30 November, 22 h in Montréal = 1 December 03 h UTC (4 h in Paris)
    expect(garageDay('2026-12-01T03:00:00Z')).toBe('2026-11-30');
    expect(garageDay('2026-11-30T05:30:00Z')).toBe('2026-11-30');
    expect(garageDay(null)).toBeNull();
    expect(garageDay('nonsense')).toBeNull();
    const lines = revenueLines([inv({ id: 'late', issued_at: '2026-12-01T03:00:00Z' })], NOV, N);
    expect(lines.map((l) => l.day)).toEqual(['2026-11-30']);
  });
  it('only finished invoices (issued or paid), partly paid said so', () => {
    const lines = revenueLines([inv({ id: 'a', paid_cents: 1000 }), inv({ id: 'b', status: 'draft' }), inv({ id: 'c', status: 'void' }), inv({ id: 'd', status: 'paid', paid_cents: 11498 })], NOV, N);
    expect(lines.map((l) => l.status)).toEqual(['partial', 'paid']);
  });
  it('expense lines of the period', () => {
    expect(expenseLines([exp({}), exp({ id: 'x', day: '2026-10-31' })], NOV, N)).toHaveLength(1);
  });
  it('bug 09: the warning compares the amounts too, not only the counts', () => {
    const rev = revenueLines([inv({})], NOV, N);
    const ex = expenseLines([exp({})], NOV, N);
    const report = (expenses: Record<string, number>) => normalizeReport({ revenue: { subtotal: 10000, tps: 500, tvq: 998, total: 11498, count: 1 }, expenses }, NOV.from, NOV.to);
    expect(exportMismatch(report({ subtotal: 8498, tps: 425, tvq: 848, total: 9771, count: 1 }), rev, ex, true)).toBe(false);
    // the same count, another amount (changed on another phone)
    expect(exportMismatch(report({ subtotal: 8000, tps: 425, tvq: 848, total: 9273, count: 1 }), rev, ex, true)).toBe(true);
    expect(exportMismatch(report({ subtotal: 8498, tps: 425, tvq: 848, total: 9771, count: 2 }), rev, ex, true)).toBe(true);
    // someone without « Factures » holds no invoice: only the expenses count
    expect(exportMismatch(report({ subtotal: 8498, tps: 425, tvq: 848, total: 9771, count: 1 }), [], ex, false)).toBe(false);
  });
  it('bug 25: without the invoices, the file holds the expenses only (no Taxes sheet that reads as a refund)', () => {
    const L = new Proxy({}, { get: () => new Proxy({}, { get: (_t, k) => String(k) }) }) as unknown as ExportLabels;
    const x = { from: NOV.from, to: NOV.to, revenue: [], expenses: expenseLines([exp({})], NOV, N), labels: L };
    expect(workbookSheets(x)).toHaveLength(3);
    const only = workbookSheets({ ...x, expensesOnly: true });
    expect(only).toHaveLength(1);
    expect(only[0].rows).toHaveLength(3);
  });
});

describe('the treasury’s reads of the phone’s copy', () => {
  it('the garage’s categories, else the default list; a category still used is offered as a filter', () => {
    expect(categoryList(['Pièces', ' ', 3, 'Repas'])).toEqual(['Pièces', 'Repas']);
    expect(categoryList(null)).toContain('Frais bancaires');
    expect(filterCategories(['Pièces'], [exp({ category: 'pièces' }), exp({ category: 'Vieux nom' })])).toEqual(['Pièces', 'Vieux nom']);
  });
  it('the period’s expenses, newest first; the same day: the one typed last first', () => {
    const rows = periodExpenses([exp({ id: 'a', day: '2026-11-05', created_at: '1' }), exp({ id: 'b', day: '2026-11-05', created_at: '2' }), exp({ id: 'c', day: '2026-11-20' }), exp({ id: 'z', day: '2026-12-01' })], NOV);
    expect(rows.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });
  it('search: vendor, category, method words, the amount typed either way, accents ignored', () => {
    const e = exp({ vendor: 'Pièces d’auto Lordco', total_cents: 9771 });
    expect(expenseMatches(e, 'pieces lordco')).toBe(true);
    expect(expenseMatches(e, '97,71')).toBe(true);
    expect(expenseMatches(e, '97.71')).toBe(true);
    expect(expenseMatches(e, 'canac')).toBe(false);
  });
  it('by category, before taxes, the largest first', () => {
    expect(byCategory([exp({}), exp({ id: 'f', category: 'Carburant', subtotal_cents: 100 }), exp({ id: 'g' })])).toEqual([{ category: 'Pièces', subtotal: 16996, n: 2 }, { category: 'Carburant', subtotal: 100, n: 1 }]);
  });
  it('the signature changes with any change of a row, not with the order', () => {
    const a = exp({}), b = exp({ id: 'b' });
    expect(rowsSignature([a, b])).toBe(rowsSignature([b, a]));
    expect(rowsSignature([a, b])).not.toBe(rowsSignature([a, { ...b, category: 'Repas' }]));
    expect(rowsSignature([a])).not.toBe(rowsSignature([a, b]));
  });
});

describe('the payment-method words (R170)', () => {
  it('a known method in the person’s language; one the dictionaries do not know is shown as stored; none is empty', () => {
    lang.value = 'fr';
    expect(methodLabel('debit')).toBe('Débit');
    expect(methodLabel('virement-interac-2')).toBe('virement-interac-2');
    expect(methodLabel(null)).toBe('');
    lang.value = 'en';
    expect(methodLabel('debit')).not.toBe('treasury.methods.debit');
    expect(methodLabel('crypto')).toBe('crypto');
    lang.value = 'fr';
  });
});
