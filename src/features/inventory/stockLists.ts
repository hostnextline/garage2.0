/* How « Inventaire » sorts the stock on screen: the search and the category, « À commander » (most urgent first),
   « En stock », the switched-off items, the categories offered. Pure (tested in stockLists.test.ts); the items carry
   their quantity on hand. */
import type { InventoryItem } from '../../data/types';
import { matches } from '../../lib/text';
import { isLow } from '../../domain/stock/stock';

export interface StockLists {
  /** every item at or under its minimum (before the search): the count in the summary and the « Plus » badge */
  lowAll: InventoryItem[];
  low: InventoryItem[];
  rest: InventoryItem[];
  off: InventoryItem[];
  offCount: number;
  activeCount: number;
  cats: string[];
}

/** search: name, part number, category, supplier, notes; accents and case ignored; every word must be found */
export const found = (i: InventoryItem, q: string) => matches(q, i.name, i.sku, i.category, i.supplier, i.notes);
/** the lower the share of its minimum that is left, the more urgent */
const urgency = (i: InventoryItem) => (i.min_qty ? Number(i.qty) / Number(i.min_qty) : Number(i.qty));

export function stockLists(all: InventoryItem[], q: string, cat: string): StockLists {
  const keep = (i: InventoryItem) => (!cat || (i.category || '').trim() === cat) && found(i, q);
  const lowAll = all.filter(isLow);
  const lowIds = new Set(lowAll.map((i) => i.id));
  return {
    lowAll,
    low: lowAll.filter(keep).sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name, 'fr')),
    rest: all.filter((i) => i.active && !lowIds.has(i.id) && keep(i)),
    off: all.filter((i) => !i.active && keep(i)),
    offCount: all.filter((i) => !i.active).length,
    activeCount: all.filter((i) => i.active).length,
    cats: [...new Set(all.map((i) => (i.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))
  };
}
