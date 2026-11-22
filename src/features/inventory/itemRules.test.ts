import { describe, it, expect } from 'vitest';
import { formOf, checkItem, itemPatch, firstQty } from './itemRules';
import type { InventoryItem } from '../../data/types';

const oil = { id: 'i', name: 'Huile 5W-30', sku: null, category: 'Huile', unit: 'L', qty: 38, min_qty: 20, cost_cents: 650, price_cents: 1200, supplier: 'Lordco', notes: null, active: true, pool: 'garage' } as unknown as InventoryItem;

describe('the item sheet', () => {
  it('sends only what the person changed: a cost set by a purchase meanwhile is not written back', () => {
    // the sheet was opened at 650 ¢; a purchase sets the cost to 1000 ¢; the person changes the minimum only
    const now = { ...oil, cost_cents: 1000 };
    expect(itemPatch(now, { min: '25' }, 'fr', 'garage')).toEqual({ min_qty: 25 });
    // the field shows the row as it is now
    expect(formOf(now, 'fr').cost).toBe(1000);
  });
  it('a field typed back to the same value is no change; an emptied field is', () => {
    expect(itemPatch(oil, { min: '20,00', name: 'Huile 5W-30 ' }, 'fr', 'garage')).toEqual({});
    expect(itemPatch(oil, { supplier: '' }, 'fr', 'garage')).toEqual({ supplier: null });
  });
  it('a new item sends every field, its stock, and never a selling price for the Coffre', () => {
    const f = { name: 'Filtre', min: '2', price: 900, first: '6' };
    expect(itemPatch(null, f, 'fr', 'coffre')).toMatchObject({ name: 'Filtre', unit: 'unité', min_qty: 2, price_cents: null, pool: 'coffre', active: true });
    expect(firstQty({ ...formOf(null, 'fr'), ...f })).toBe(6);
  });
  it('in English a minimum of 1 000 reads back (it was written « 1,000 » and refused)', () => {
    const big = { ...oil, min_qty: 1000 };
    expect(formOf(big, 'en').min).toBe('1000');
    expect(checkItem(formOf(big, 'en'), false)).toEqual({});
  });
  it('what is wrong', () => {
    expect(checkItem({ ...formOf(null, 'fr'), name: ' ', min: 'x', first: '-1' }, true)).toEqual({ name: 'errName', min: 'errNumber', first: 'errNumber' });
  });
});
