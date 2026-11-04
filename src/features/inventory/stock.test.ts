import { describe, it, expect } from 'vitest';
import { parseQty, formatQty, unitWord, qtyLabel, itemValue, stockValue, isLow, toOrder, moveDelta } from './stock';

const units = (n: number) => (n === 1 ? '1 unité' : `${formatQty(n, 'fr')} unités`);

describe('quantities', () => {
  it.each([['4,5', 4.5], ['4.5', 4.5], ['12', 12], [' 38 ', 38], ['0', 0], ['0,25', 0.25], ['1 000', 1000], [7, 7]])('reads %s', (s, n) => expect(parseQty(s)).toBe(n));
  it.each(['', 'abc', '-3', '1,234', '2.5.1', '1e3'])('refuses %s', (s) => expect(parseQty(s)).toBeNull());
  it('writes them like people do', () => {
    expect(formatQty(4.5, 'fr')).toBe('4,5');
    expect(formatQty(4.5, 'en')).toBe('4.5');
    expect(formatQty(38, 'fr')).toBe('38');
  });
  it('units: symbols stay, French words take the plural', () => {
    expect(unitWord('L', 38, 'fr')).toBe('L');
    expect(unitWord('jeu', 2, 'fr')).toBe('jeux');
    expect(unitWord('jeu', 1, 'fr')).toBe('jeu');
    expect(unitWord('boîte', 3, 'fr')).toBe('boîtes');
    expect(unitWord('pneu', 4, 'fr')).toBe('pneus');
    expect(unitWord('rouleau', 2, 'fr')).toBe('rouleaux');
    expect(unitWord('box', 2, 'en')).toBe('box');
    expect(qtyLabel(6, 'unité', 'fr', units)).toBe('6 unités');
    expect(qtyLabel(1, '', 'fr', units)).toBe('1 unité');
    expect(qtyLabel(4.5, 'L', 'fr', units)).toBe('4,5 L');
    expect(qtyLabel(2, 'jeu', 'fr', units)).toBe('2 jeux');
  });
});

describe('value and what to order', () => {
  it('values the shelf at cost, exact to the cent', () => {
    expect(itemValue({ qty: 38, cost_cents: 650 })).toBe(24700);
    expect(itemValue({ qty: 4.5, cost_cents: 699 })).toBe(3146);     // 3145,5 → 3146
    expect(itemValue({ qty: -2, cost_cents: 650 })).toBe(0);
    expect(itemValue({ qty: 3, cost_cents: null })).toBeNull();
    expect(stockValue([{ qty: 38, cost_cents: 650, active: true }, { qty: 6, cost_cents: 790, active: true }, { qty: 9, cost_cents: 100, active: false }])).toBe(24700 + 4740);
  });
  it('low stock: at or under the minimum, or empty without a minimum', () => {
    expect(isLow({ qty: 12, min_qty: 20, active: true })).toBe(true);
    expect(isLow({ qty: 20, min_qty: 20, active: true })).toBe(true);
    expect(isLow({ qty: 21, min_qty: 20, active: true })).toBe(false);
    expect(isLow({ qty: 0, min_qty: null, active: true })).toBe(true);
    expect(isLow({ qty: 0, min_qty: 5, active: false })).toBe(false);
    expect(toOrder({ qty: 12, min_qty: 20 })).toBe(28);
    expect(toOrder({ qty: 0, min_qty: null })).toBe(1);
  });
  it('moves: entry adds, exit takes away, a count gives the difference', () => {
    expect(moveDelta('in', 24, 12)).toBe(24);
    expect(moveDelta('out', 4.2, 12)).toBe(-4.2);
    expect(moveDelta('count', 35, 38)).toBe(-3);
    expect(moveDelta('count', 12.3, 12.1)).toBe(0.2);
    expect(moveDelta('count', 6, 6)).toBe(0);
  });
});
