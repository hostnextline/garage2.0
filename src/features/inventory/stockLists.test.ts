import { describe, it, expect } from 'vitest';
import { stockLists } from './stockLists';
import type { InventoryItem } from '../../data/types';

const it_ = (id: string, name: string, qty: number, min: number | null, extra: Partial<InventoryItem> = {}) => ({ id, name, qty, min_qty: min, category: null, sku: null, supplier: null, notes: null, active: true, ...extra }) as unknown as InventoryItem;

describe('« Inventaire » lists', () => {
  const all = [
    it_('a', 'Huile 5W-30', 12, 20, { category: 'Huile' }), it_('b', 'Filtre PH7317', 1, 10, { category: 'Filtres', sku: 'PH7317' }),
    it_('c', 'Lave-glace', 30, 5, { category: 'Fluides' }), it_('d', 'Vieux filtre', 0, null, { active: false }), it_('e', 'Chiffons', 0, null)
  ];
  it('« À commander » most urgent first, the rest in stock, the switched-off apart (the Coffre gets the same rule)', () => {
    const s = stockLists(all, '', '');
    expect(s.low.map((i) => i.id)).toEqual(['e', 'b', 'a']);
    expect(s.rest.map((i) => i.id)).toEqual(['c']);
    expect(s.off.map((i) => i.id)).toEqual(['d']);
    expect([s.offCount, s.activeCount, s.lowAll.length]).toEqual([1, 4, 3]);
    expect(s.cats).toEqual(['Filtres', 'Fluides', 'Huile']);
  });
  it('search (accents and case ignored, every word) and category; the count of « À commander » stays whole', () => {
    expect(stockLists(all, 'filtre ph', '').low.map((i) => i.id)).toEqual(['b']);
    expect(stockLists(all, 'lave glace', '').rest.map((i) => i.id)).toEqual(['c']);
    const huile = stockLists(all, '', 'Huile');
    expect(huile.low.map((i) => i.id)).toEqual(['a']);
    expect(huile.lowAll).toHaveLength(3);
  });
});
