/* The rules of an item's sheet (« Fiche »), apart from the drawing. The form keeps only what the person changed: the
   other fields follow the item's row, so a purchase that sets the cost, or a name changed on another phone meanwhile,
   is never written back with the old value; and only the changed fields are sent. Pure (tested in itemRules.test.ts). */
import type { InventoryItem } from '../../data/types';
import { editQty, parseQty } from '../../domain/stock/stock';

export interface ItemForm { name: string; sku: string; category: string; unit: string; min: string; cost: number | null; price: number | null; supplier: string; notes: string; active: boolean; first: string }

/** the sheet as the item's row says it (an empty sheet for a new item) */
export function formOf(item: InventoryItem | null | undefined, lang: string): ItemForm {
  return {
    name: item?.name || '', sku: item?.sku || '', category: item?.category || '', unit: item?.unit || '',
    min: item?.min_qty != null ? editQty(Number(item.min_qty), lang) : '', cost: item?.cost_cents ?? null, price: item?.price_cents ?? null,
    supplier: item?.supplier || '', notes: item?.notes || '', active: item ? item.active : true, first: ''
  };
}

/** the words keys of what is wrong (empty when the sheet can be saved) */
export function checkItem(f: ItemForm, isNew: boolean): Partial<Record<'name' | 'min' | 'first', 'errName' | 'errNumber'>> {
  const e: Partial<Record<'name' | 'min' | 'first', 'errName' | 'errNumber'>> = {};
  if (!f.name.trim()) e.name = 'errName';
  if (f.min.trim() && parseQty(f.min) == null) e.min = 'errNumber';
  if (isNew && f.first.trim() && parseQty(f.first) == null) e.first = 'errNumber';
  return e;
}

/** the row fields of the whole sheet (a Coffre item never has a selling price) */
function rowOf(f: ItemForm, coffre: boolean): Partial<InventoryItem> {
  return {
    name: f.name.trim(), sku: f.sku.trim() || null, category: f.category.trim() || null, unit: f.unit.trim() || 'unité',
    min_qty: f.min.trim() ? parseQty(f.min) : null, cost_cents: f.cost, price_cents: coffre ? null : f.price,
    supplier: f.supplier.trim() || null, notes: f.notes.trim() || null, active: f.active
  };
}
const FIELD_OF: Record<string, keyof ItemForm> = {
  name: 'name', sku: 'sku', category: 'category', unit: 'unit', min_qty: 'min', cost_cents: 'cost', price_cents: 'price', supplier: 'supplier', notes: 'notes', active: 'active'
};
/** what to send: for a new item every field (and its stock), for an item already there only the fields the person
    touched whose value really changed (« 4,50 » for a minimum of 4.5 is no change) */
export function itemPatch(item: InventoryItem | null | undefined, edited: Partial<ItemForm>, lang: string, pool: 'garage' | 'coffre'): Partial<InventoryItem> {
  const coffre = (item?.pool ?? pool) === 'coffre';
  const base = formOf(item, lang);
  const next = rowOf({ ...base, ...edited }, coffre);
  if (!item) return { ...next, pool: coffre ? 'coffre' : 'garage' };
  const before = rowOf(base, coffre);
  const out: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(FIELD_OF)) {
    const key = k as keyof InventoryItem;
    if (field in edited && next[key] !== before[key]) out[k] = next[key];
  }
  return out as Partial<InventoryItem>;
}
/** the first quantity of a new item (null when none was typed) */
export function firstQty(f: Pick<ItemForm, 'first'>): number | null {
  return f.first.trim() ? parseQty(f.first) : null;
}
