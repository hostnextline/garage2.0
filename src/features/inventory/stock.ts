/* Stock: quantities (2 decimals at most, like the database), units, value at cost, what to order, and the moves.
   The server changes an item's quantity itself when a move is saved (a trigger), but only the move comes back to the
   phone: the quantity on screen is moved at once here, then the item is read again from the server once the move
   has left the phone (or was refused), so the screen never keeps a wrong count. */
import { effect } from '@preact/signals';
import { roundCents, type Cents } from '../../lib/money';
import { moveStock, saveInventoryItem } from '../../data/api';
import { getRow, patchLocal } from '../../data/store';
import { net, refetch } from '../../data/sync';
import type { InventoryItem } from '../../data/types';
import { keepAfterSave } from '../treasury/data';

export type MoveKind = 'in' | 'out' | 'count';

/** "4,5" / "4.5" / "12" → 4.5 / 12 ; null when it is not a quantity (negative, more than 2 decimals, text) */
export function parseQty(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 9999999999 ? n : null;
}
export const round2 = (n: number) => Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;

const nf = new Map<string, Intl.NumberFormat>();
export function formatQty(n: number | null | undefined, lang: string): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const k = lang;
  let f = nf.get(k);
  if (!f) { f = new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 2 }); nf.set(k, f); }
  return f.format(Number(n));
}
const SYMBOL = /^(?:l|ml|kg|g|lb|lbs|oz|m|cm|mm|pi|po|gal|qt|pt|%)$/i;
const DEFAULT_UNIT = /^(?:unite|unité|unites|unités|unit|units|u|pc|pcs|pièce|piece|pieces|pièces)?$/i;
/** the unit written after a quantity: symbols stay (L, kg), French words take the plural (2 jeux, 3 boîtes) */
export function unitWord(unit: string | null | undefined, n: number, lang: string): string {
  const u = String(unit || '').trim();
  if (!u || SYMBOL.test(u) || lang === 'en' || Math.abs(n) < 2) return u;
  if (/[sxz]$/i.test(u)) return u;
  if (/(?:eau|au|eu)$/i.test(u) && !/^(?:pneu|bleu)$/i.test(u)) return u + 'x';
  return u + 's';
}
/** "38 L", "6 unités", "2 jeux" ; `units` is the plural word for items counted one by one (« unités ») */
export function qtyLabel(n: number | null | undefined, unit: string | null | undefined, lang: string, units: (n: number) => string): string {
  const q = Number(n ?? 0);
  if (DEFAULT_UNIT.test(String(unit || '').trim())) return units(q);
  return `${formatQty(q, lang)} ${unitWord(unit, q, lang)}`.trim();
}

/** the value of what is on the shelf, at cost (nothing for a negative count) */
export function itemValue(i: Pick<InventoryItem, 'qty' | 'cost_cents'>): Cents | null {
  if (i.cost_cents == null) return null;
  return roundCents(Math.max(0, Number(i.qty)) * Number(i.cost_cents));
}
export function stockValue(items: Pick<InventoryItem, 'qty' | 'cost_cents' | 'active'>[]): Cents {
  return items.filter((i) => i.active !== false).reduce((n, i) => n + (itemValue(i) ?? 0), 0);
}
/** the same rule as the lowStock selector: at or under the minimum (or empty when there is no minimum) */
export function isLow(i: Pick<InventoryItem, 'qty' | 'min_qty' | 'active'>): boolean {
  return i.active !== false && (i.min_qty != null ? Number(i.qty) <= Number(i.min_qty) : Number(i.qty) <= 0);
}
/** how much to buy to get back above the minimum: at least the minimum again, never less than 1 */
export function toOrder(i: Pick<InventoryItem, 'qty' | 'min_qty'>): number {
  const min = Number(i.min_qty ?? 0);
  return Math.max(1, Math.ceil(min * 2 - Math.max(0, Number(i.qty))));
}
/** the change a move makes: an entry adds, an exit takes away, a count sets the real quantity */
export function moveDelta(kind: MoveKind, amount: number, current: number): number {
  if (kind === 'in') return round2(amount);
  if (kind === 'out') return round2(-amount);
  return round2(amount - Number(current));
}
export const REASON: Record<MoveKind, 'restock' | 'used' | 'adjust'> = { in: 'restock', out: 'used', count: 'adjust' };

/* ---------- writing ---------- */
const settling = new Set<string>();
/** reads the item again from the server once nothing waits to be sent (the server's count is the truth) */
function settle(itemId: string) {
  if (settling.has(itemId)) return;
  settling.add(itemId);
  setTimeout(() => {
    let done = false;
    let stop: (() => void) | undefined;
    stop = effect(() => {
      const n = net.value;
      if (done || n.pending > 0 || n.sending) return;
      done = true;
      // after this run: `stop` is set by then
      queueMicrotask(() => { stop?.(); settling.delete(itemId); void refetch('inventory_items', itemId); });
    });
  }, 30);
}
function showQty(itemId: string, delta: number) {
  const cur = getRow<InventoryItem>('inventory_items', itemId);
  if (cur) patchLocal('inventory_items', itemId, { qty: round2(Number(cur.qty) + delta) });
}
/** a stock move (throws only when nothing may be changed, like the owner's preview) */
export async function recordMove(itemId: string, delta: number, reason: 'restock' | 'used' | 'adjust' | 'return', note: string | null): Promise<string> {
  const id = await moveStock(itemId, delta, reason, note);
  showQty(itemId, delta);
  settle(itemId);
  keepAfterSave('inventory_moves', id);
  return id;
}
/** saves an item's sheet; a new item starts with its first quantity */
export async function saveItem(item: Partial<InventoryItem>, firstQty: number | null): Promise<string> {
  const isNew = !(item.id && getRow('inventory_items', item.id));
  const { qty: _ignored, ...rest } = item;
  void _ignored;
  const id = await saveInventoryItem(isNew && firstQty ? { ...rest, qty: firstQty } : rest);
  if (isNew && firstQty) { showQty(id, firstQty); settle(id); }
  return id;
}
