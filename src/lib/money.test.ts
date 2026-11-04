import { describe, it, expect } from 'vitest';
import { totals, parseMoney, money, moneyInput, roundCents, QC_TAXES } from './money';

describe('taxes TPS/TVQ', () => {
  it('computes the promo at 199,99 $ like the price sign says', () => {
    const t = totals([{ qty: 1, unitCents: 19999 }]);
    expect(t.subtotal).toBe(19999);
    expect(t.tps).toBe(1000);   // 9,9995 → 10,00
    expect(t.tvq).toBe(1995);   // 19,949 → 19,95
    expect(t.total).toBe(22994);
  });
  it('200 $ gives 229,95 $ taxes included (the number quoted to Hassan)', () => {
    expect(totals([{ qty: 1, unitCents: 20000 }]).total).toBe(22995);
  });
  it('taxes only the taxable lines', () => {
    const t = totals([{ qty: 1, unitCents: 10000 }, { qty: 1, unitCents: 5000, taxable: false }]);
    expect(t.subtotal).toBe(15000);
    expect(t.taxable).toBe(10000);
    expect(t.tps).toBe(500);
    expect(t.tvq).toBe(998);
    expect(t.total).toBe(16498);
  });
  it('no taxes when the business is not registered', () => {
    const t = totals([{ qty: 2, unitCents: 7999 }], { ...QC_TAXES, enabled: false });
    expect(t.total).toBe(15998);
    expect(t.tps + t.tvq).toBe(0);
  });
  it('a discount line lowers the taxable amount', () => {
    const t = totals([{ qty: 1, unitCents: 11999 }, { qty: 1, unitCents: -2000 }]);
    expect(t.taxable).toBe(9999);
    expect(t.total).toBe(9999 + 500 + 997);
  });
  it('quantities with decimals (0,5 h of labour) round to the cent', () => {
    expect(totals([{ qty: 1.5, unitCents: 9999 }]).subtotal).toBe(14999); // 149,985 → 149,99
  });
  it('rounds half away from zero', () => {
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
  });
});

describe('reading an amount typed by a person', () => {
  it.each([
    ['59,99', 5999], ['59.99', 5999], ['59', 5900], ['59 $', 5900], ['$59.99', 5999], ['1 234,50', 123450],
    ['1,234.50', 123450], ['1.234,50', 123450], ['0,5', 50], ['-20', -2000], ['  79,99 $ ', 7999]
  ])('%s → %i', (s, c) => expect(parseMoney(s)).toBe(c));
  it.each(['', 'abc', '12,345,6', '5..9'])('refuses %s', (s) => expect(parseMoney(s)).toBeNull());
});

describe('showing an amount', () => {
  it('French Québec: 59,99 $', () => expect(money(5999, 'fr').replace(/\s/g, ' ')).toBe('59,99 $'));
  it('English Canada: $59.99', () => expect(money(5999, 'en')).toBe('$59.99'));
  it('whole amounts can drop the cents', () => expect(money(20000, 'fr', { whole: true }).replace(/\s/g, ' ')).toBe('200 $'));
  it('input format', () => { expect(moneyInput(5999, 'fr')).toBe('59,99'); expect(moneyInput(5999, 'en')).toBe('59.99'); });
});
