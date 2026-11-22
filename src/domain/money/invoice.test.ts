import { describe, it, expect } from 'vitest';
import { lineCents, unitCents, lineQty, linesTotals, invoiceAmounts, draftProblems, cleanLine, cashRound, cashChange, cashQuick, formatNumber, daysSince } from './invoice';
import { QC_TAXES } from '../../lib/money';
import type { Invoice } from '../../data/types';

const L = (unit_cents: number, o: Partial<{ qty: number; taxable: boolean; kind: string; description: string }> = {}) => ({ description: 'x', qty: 1, unit_cents, taxable: true, ...o });

describe('draft totals, the way the server computes them', () => {
  it('oil change and top-up: 149,99 $ → 172,45 $ with TPS and TVQ', () => {
    const t = linesTotals([L(8999), L(6000)], QC_TAXES);
    expect(t).toMatchObject({ subtotal: 14999, tps: 750, tvq: 1496, total: 17245 });
  });
  it('a discount line (positive amount) lowers the subtotal and the taxes', () => {
    const t = linesTotals([L(34999), L(5000, { kind: 'discount' })], QC_TAXES);
    expect(t.subtotal).toBe(29999);
    expect(t.tps).toBe(1500);      // 1499,95
    expect(t.tvq).toBe(2992);      // 2992,40
    expect(t.total).toBe(34491);
  });
  it('the unit price of a discount reads negative, whatever sign it was stored with; the quantity reads like the server', () => {
    expect(unitCents(L(5000, { kind: 'discount' }))).toBe(-5000);
    expect(unitCents(L(-5000, { kind: 'discount' }))).toBe(-5000);
    expect(unitCents(L(-2000))).toBe(-2000);
    expect(unitCents(L(1999))).toBe(1999);
    expect(lineQty({ qty: '1,5' as unknown as number })).toBe(1.5);
    expect(lineQty({})).toBe(1);
  });
  it('a discount typed as a negative amount counts the same (never adds money)', () => {
    expect(lineCents(L(-5000, { kind: 'discount' }))).toBe(-5000);
    expect(lineCents(L(5000, { kind: 'discount' }))).toBe(-5000);
    expect(lineCents(L(5000, { kind: 'discount', qty: 2 }))).toBe(-10000);
  });
  it('a non-taxable line is in the subtotal but not in the taxes', () => {
    const t = linesTotals([L(34999), L(225, { qty: 2, taxable: false })], QC_TAXES);
    expect(t.subtotal).toBe(35449);
    expect(t.taxable).toBe(34999);
    expect(t.tps).toBe(1750);      // 1749,95
    expect(t.tvq).toBe(3491);      // 3491,15
    expect(t.total).toBe(40690);
  });
  it('a non-taxable discount lowers only the subtotal', () => {
    const t = linesTotals([L(10000), L(1000, { kind: 'discount', taxable: false })], QC_TAXES);
    expect(t).toMatchObject({ subtotal: 9000, tps: 500, tvq: 998, total: 10498 });
  });
  it('taxes off on the invoice (exempt customer): total = subtotal', () => {
    const t = linesTotals([L(8999), L(6000)], QC_TAXES, false);
    expect(t).toMatchObject({ subtotal: 14999, tps: 0, tvq: 0, total: 14999 });
  });
  it('taxes off in the settings (business not registered)', () => {
    expect(linesTotals([L(8999)], { ...QC_TAXES, enabled: false }).total).toBe(8999);
  });
  it('missing rates fall back to Québec rates, missing qty counts 1 (like the server)', () => {
    expect(linesTotals([{ description: 'a', unit_cents: 20000 }], null).total).toBe(22995);
    expect(lineCents({ unit_cents: 1234 })).toBe(1234);
  });
  it('hours of labour with decimals round to the cent, half away from zero', () => {
    expect(lineCents(L(11500, { qty: 1.5 }))).toBe(17250);
    expect(lineCents(L(999, { qty: 0.5 }))).toBe(500);     // 499,5 → 500
    expect(lineCents(L(333, { qty: 0.3 }))).toBe(100);     // 99,9 → 100
    expect(lineCents({ qty: '1,5' as unknown as number, unit_cents: 1000 })).toBe(1500);
  });
  it('taxes match exact integer rounding for every taxable amount up to 3 000 $', () => {
    for (let c = 0; c <= 300000; c += 1) {
      const t = linesTotals([L(c)], QC_TAXES);
      const tps = Math.floor((c * 5 + 50) / 100), tvq = Math.floor((c * 9975 + 50000) / 100000);
      if (t.tps !== tps || t.tvq !== tvq) throw new Error(`taxable ${c}: got ${t.tps}/${t.tvq}, want ${tps}/${tvq}`);
    }
  });
  it('a negative total and an empty description are caught before finishing', () => {
    expect(draftProblems([], 0).problem).toBe('empty');
    expect(draftProblems([L(100, { description: ' ' }), L(100)], 230)).toEqual({ problem: 'no_description', lines: [0] });
    expect(draftProblems([L(100), L(500, { kind: 'discount' })], -460).problem).toBe('negative');
    expect(draftProblems([L(100)], 115).problem).toBeNull();
  });
  it('cleanLine keeps only what the server stores', () => {
    expect(cleanLine({ description: '  Freins ', qty: '2' as unknown as number, unit_cents: 100.4, taxable: undefined, kind: undefined, item_id: 'ji-1', total_cents: 9 } as never))
      .toEqual({ description: 'Freins', qty: 2, unit_cents: 100, taxable: true, kind: 'service', item_id: 'ji-1' });
  });
});

describe('what an invoice says', () => {
  const base = { lines: [L(8999), L(6000)], taxes_on: true, subtotal_cents: 1, tps_cents: 2, tvq_cents: 3, total_cents: 17245, paid_cents: 5000 } as unknown as Invoice;
  it('a draft is computed from its lines', () => {
    expect(invoiceAmounts({ ...base, status: 'draft' }, QC_TAXES)).toMatchObject({ subtotal: 14999, tps: 750, tvq: 1496, total: 17245, balance: 12245, showTaxes: true });
  });
  it('a finished invoice shows the server numbers (the truth)', () => {
    expect(invoiceAmounts({ ...base, status: 'issued' }, QC_TAXES)).toMatchObject({ subtotal: 1, tps: 2, tvq: 3, total: 17245, paid: 5000, balance: 12245 });
  });
  it('a cancelled invoice has nothing left to pay', () => {
    expect(invoiceAmounts({ ...base, status: 'void' }, QC_TAXES).balance).toBe(0);
  });
  it('paid more than the total (paid ahead then a rebate, the same payment twice): the money to give back is said', () => {
    expect(invoiceAmounts({ ...base, status: 'paid', paid_cents: 20000 }, QC_TAXES)).toMatchObject({ balance: 0, over: 2755 });
    expect(invoiceAmounts({ ...base, status: 'issued' }, QC_TAXES).over).toBe(0);
    // a cancelled invoice that still holds money owes all of it back
    expect(invoiceAmounts({ ...base, status: 'void', paid_cents: 5000 }, QC_TAXES).over).toBe(5000);
    // a draft counts from its lines
    expect(invoiceAmounts({ ...base, status: 'draft', paid_cents: 20000 }, QC_TAXES).over).toBe(2755);
    expect(invoiceAmounts({ ...base, status: 'draft', paid_cents: 0 }, QC_TAXES).over).toBe(0);
  });
  it('an exempt invoice hides the tax lines', () => {
    expect(invoiceAmounts({ ...base, status: 'issued', taxes_on: false, tps_cents: 0, tvq_cents: 0 }, QC_TAXES).showTaxes).toBe(false);
  });
});

describe('cash: the change to give back (no pennies in Canada)', () => {
  it('rounds the amount due to the nearest 5 ¢', () => {
    expect([9261, 9262, 9263, 9264, 9265, 9266, 9267, 9268, 9269, 9270].map(cashRound)).toEqual([9260, 9260, 9265, 9265, 9265, 9265, 9265, 9270, 9270, 9270]);
  });
  it('92,67 $ paid with 100 $: give back 7,35 $, record 92,67 $', () => {
    expect(cashChange(9267, 10000)).toEqual({ due: 9267, dueCash: 9265, received: 10000, record: 9267, change: 735, short: 0 });
  });
  it('the exact cash amount settles the invoice even when rounded down', () => {
    expect(cashChange(9267, 9265)).toMatchObject({ record: 9267, change: 0, short: 0 });
  });
  it('less than due: only what was received is recorded', () => {
    expect(cashChange(9267, 5000)).toMatchObject({ record: 5000, change: 0, short: 4265 });
  });
  it('nothing typed yet: the amount due', () => {
    expect(cashChange(17245, null)).toMatchObject({ record: 17245, change: 0, short: 0 });
  });
  it('quick bills: the exact amount, then the next round amounts', () => {
    expect(cashQuick(9265)).toEqual([9265, 9500, 10000]);
    expect(cashQuick(17245)).toEqual([17245, 17500, 18000, 20000]);
    expect(cashQuick(10000)).toEqual([10000]);
  });
});

describe('numbers and dates', () => {
  it('invoice numbers', () => {
    expect(formatNumber('F-', 4, 43)).toBe('F-0043');
    expect(formatNumber('E-', 4, 7)).toBe('E-0007');
    expect(formatNumber('F-', 4, null)).toBe('');
  });
  it('days since issued', () => {
    // instants written in UTC, days counted on the garage's clock (Montréal: UTC-5 in November, UTC-4 in October)
    const now = new Date('2026-11-04T20:00:00Z');                           // 4 Nov, 15 h
    expect(daysSince('2026-11-04T14:00:00Z', now)).toBe(0);                // 4 Nov, 9 h
    expect(daysSince('2026-11-04T04:00:00Z', now)).toBe(1);                // 3 Nov, 23 h (4 Nov in UTC)
    expect(daysSince('2026-10-12T16:00:00Z', now)).toBe(23);               // 12 Oct, noon
    expect(daysSince(null, now)).toBeNull();
  });
});
