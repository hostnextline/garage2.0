import { describe, it, expect } from 'vitest';
import { totals, parseMoney, setMoneyLang, money, moneyInput, roundCents, QC_TAXES, lineWorth } from './money';

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
  it.each(['', 'abc', '12,345,6', '5..9', ',', '-', '$'])('refuses %s', (s) => expect(parseMoney(s)).toBeNull());
  // core-data-20 / x-money-24: one separator then exactly three digits is a slip, not thousands
  it.each(['59,999', '0,125', '12.345', '1.000', '0,995', '-59,999'])('refuses %s (three decimals are not thousands)', (s) => expect(parseMoney(s)).toBeNull());
  it('in English, a comma before three digits still means thousands', () => {
    expect(parseMoney('1,000', 'en')).toBe(100000);
    expect(parseMoney('$1,250', 'en')).toBe(125000);
    expect(parseMoney('1.000', 'en')).toBeNull();
    expect(parseMoney('59,999', 'fr')).toBeNull();
  });
  it('without lib/i18n loaded (the customer page), an amount without a language is read the French way', () => {
    expect(parseMoney('59,999')).toBeNull();
    expect(parseMoney('1,000')).toBeNull();
    expect(parseMoney('1,000', 'en')).toBe(100000);
  });
  it('setMoneyLang changes the default; anything but « en » is French', () => {
    setMoneyLang('en');
    expect(parseMoney('1,000')).toBe(100000);
    setMoneyLang('es');
    expect(parseMoney('1,000')).toBeNull();
    setMoneyLang('fr');
  });
  it('several thousand groups, or a group with decimals, are still thousands', () => {
    expect(parseMoney('1,234,567')).toBe(123456700);
    expect(parseMoney('1.234.567,89')).toBe(123456789);
    expect(parseMoney('1 000')).toBe(100000);
    expect(parseMoney('1 000,00 $')).toBe(100000);
  });
  it('a missing whole part or missing cents are read the way a person means them', () => {
    expect(parseMoney(',50')).toBe(50);
    expect(parseMoney('.5')).toBe(50);
    expect(parseMoney('5,')).toBe(500);
    expect(parseMoney('-,25')).toBe(-25);
  });
  it('refuses an amount the database cannot hold', () => {
    expect(parseMoney('21474836,47')).toBe(2147483647);
    expect(parseMoney('21474836,48')).toBeNull();
    expect(parseMoney('99999999999')).toBeNull();
  });
});

describe('showing an amount', () => {
  it('French Québec: 59,99 $', () => expect(money(5999, 'fr').replace(/\s/g, ' ')).toBe('59,99 $'));
  it('English Canada: $59.99', () => expect(money(5999, 'en')).toBe('$59.99'));
  it('whole amounts can drop the cents', () => expect(money(20000, 'fr', { whole: true }).replace(/\s/g, ' ')).toBe('200 $'));
  it('input format', () => { expect(moneyInput(5999, 'fr')).toBe('59,99'); expect(moneyInput(5999, 'en')).toBe('59.99'); });
});

/* x-money-06: one TS rule for « what a line is worth », the database's (invoice_totals: round(qty × unit), a discount
   always down, any other line keeps its sign) */
describe('lineWorth: a line counted like the database counts it', () => {
  it.each([
    [{ qty: 1, unit_cents: 5999 }, 5999],
    [{ qty: 2, unit_cents: 5999 }, 11998],
    [{ qty: 1.15, unit_cents: 1000 }, 1150],        // 1,15 × 1000 is 1149,999… for a computer
    [{ qty: 2.5, unit_cents: 333 }, 833],           // half a cent goes up
    [{ qty: 0.5, unit_cents: 1 }, 1],
    [{ qty: 0.5, unit_cents: -1 }, -1],             // and a negative half goes down (away from zero), like Postgres
    [{ qty: 1.33, unit_cents: 7500 }, 9975],
    [{ qty: '1.5', unit_cents: '2000' }, 3000],     // numbers kept as text in JSON
    [{ qty: null, unit_cents: 4500 }, 4500],        // no quantity = 1 (coalesce(qty, 1))
    [{ unit_cents: null }, 0],
    [{ qty: 'abc', unit_cents: 100 }, 0],
    [{ qty: 1, unit_cents: 0.5 }, 1],               // a price that is not whole cents is rounded at the end
  ])('%o is worth %i', (l, cents) => expect(lineWorth(l)).toBe(cents));
  it('a discount counts down whatever sign it was stored with (editor: positive, « Changer le prix »: negative)', () => {
    expect(lineWorth({ qty: 1, unit_cents: 2000, kind: 'discount' })).toBe(-2000);
    expect(lineWorth({ qty: 1, unit_cents: -2000, kind: 'discount' })).toBe(-2000);
    expect(lineWorth({ qty: 2, unit_cents: 1250, kind: 'discount' })).toBe(-2500);
  });
  it('a credit typed as a negative price on another line stays a credit', () => {
    expect(lineWorth({ qty: 1, unit_cents: -1500, kind: 'service' })).toBe(-1500);
    expect(lineWorth({ qty: 1, unit_cents: -1500 })).toBe(-1500);
  });
  it('never answers -0', () => {
    expect(Object.is(lineWorth({ qty: 1, unit_cents: 0, kind: 'discount' }), 0)).toBe(true);
    expect(Object.is(lineWorth({ qty: 0.001, unit_cents: -1 }), 0)).toBe(true);
  });
  it('gives the same totals as before for ordinary lines (lineTotal / totals unchanged)', () => {
    const lines = [{ qty: 1, unit_cents: 19999 }, { qty: 2, unit_cents: 1250 }, { qty: 1, unit_cents: 1000, kind: 'discount' }];
    const t = totals(lines.map((l) => ({ qty: 1, unitCents: lineWorth(l) })));
    expect(t.subtotal).toBe(19999 + 2500 - 1000);
    expect(t).toEqual(totals([{ qty: 1, unitCents: 19999 }, { qty: 2, unitCents: 1250 }, { qty: 1, unitCents: -1000 }]));
  });
});
