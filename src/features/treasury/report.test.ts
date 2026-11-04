import { describe, it, expect } from 'vitest';
import { normalizeReport } from './report';

describe('the treasury report from the server', () => {
  it('keeps the numbers, sorts categories and methods by amount', () => {
    const r = normalizeReport({
      from: '2026-11-01', to: '2026-11-30',
      revenue: { subtotal: 107376, tps: 5369, tvq: 10711, total: 123456, count: 1 },
      expenses: { subtotal: '8498', tps: 425, tvq: 848, total: 9771, count: 1 },
      by_category: [{ category: 'Carburant', total: 100, subtotal: 87, n: 1 }, { category: 'Pièces', total: 9771, subtotal: 8498, n: 1 }],
      collected: [{ method: 'debit', total: 100, n: 1 }, { method: 'credit', total: 500, n: 2 }],
      profit: 98878, tps_to_remit: 4944, tvq_to_remit: 9863
    }, '2026-11-01', '2026-11-30');
    expect(r.expenses.subtotal).toBe(8498);
    expect(r.by_category.map((c) => c.category)).toEqual(['Pièces', 'Carburant']);
    expect(r.collected.map((c) => c.method)).toEqual(['credit', 'debit']);
    expect(r.profit).toBe(98878);
  });
  it('an empty or broken answer gives zeros, never a crash', () => {
    const r = normalizeReport(null, '2026-11-01', '2026-11-30');
    expect(r).toMatchObject({ from: '2026-11-01', to: '2026-11-30', profit: 0, tps_to_remit: 0, by_category: [], collected: [] });
    expect(normalizeReport({ revenue: { subtotal: 1000, tps: 50, tvq: 100 }, expenses: { subtotal: 300, tps: 15, tvq: 30 } }, 'a', 'b'))
      .toMatchObject({ profit: 700, tps_to_remit: 35, tvq_to_remit: 70 });
  });
});
