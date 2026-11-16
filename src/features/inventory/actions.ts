/* Writing the stock: a move (Entrée, Sortie, Compter), a paid purchase (inventory_buy), an item's sheet. Each returns
   what the server said, so run() / attempt() can say « Gardé sur le téléphone » when it only waits for signal.
   The quantity on screen is never patched here: it is worked out from the rows the phone keeps (domain/stock/onHand). */
import { signal } from '@preact/signals';
import { moveStock, saveInventoryItem, buyStock, type PaidFrom } from '../../data/api';
import { getRow, rowsOf } from '../../data/store';
import type { InventoryItem, InventoryMove } from '../../data/types';

/** the moves sent from this phone since it was opened: while the server's item row is not back, they still count
    (onHand). A signal so the quantity on screen follows when one is added */
export const sentHere = signal<ReadonlySet<string>>(new Set());
function remember(id: string) { sentHere.value = new Set([...sentHere.value, id]); }

/** a stock move (throws only when nothing may be changed, like the owner's preview) */
export async function recordMove(itemId: string, delta: number, reason: 'restock' | 'used' | 'adjust', note: string | null): Promise<string> {
  const id = await moveStock(itemId, delta, reason, note);
  remember(id);
  return id;
}
/** stock bought and paid (Trésorerie or Coffre): the server moves the stock and the money together. The answer is
    returned as is: { queued: true } when it waits for signal (the screen must not say the expense exists yet) */
export async function recordPurchase(itemId: string, qty: number, totalCents: number | null, from: PaidFrom, vendor: string | null, note: string | null) {
  return buyStock(itemId, qty, totalCents, from, vendor, note);
}
/** saves an item's sheet: a new item starts with its first quantity. The id is chosen by the caller (once per filled
    form), so a second tap on « Ajouter l'article » changes the same item instead of making a second one */
export async function saveItem(item: Partial<InventoryItem> & { id: string }, firstQty: number | null): Promise<string> {
  const isNew = !getRow('inventory_items', item.id);
  const { qty: _ignored, ...rest } = item;
  void _ignored;
  const id = await saveInventoryItem(isNew && firstQty ? { ...rest, qty: firstQty } : rest);
  // the first quantity is a move made by saveInventoryItem: remember it, so it still counts when the server answers
  // the new item with its quantity 0 before the move's own answer (the screen showed 0 for a moment)
  if (isNew && firstQty) for (const m of rowsOf<InventoryMove>('inventory_moves')) if (m.item_id === id && !m.updated_at) remember(m.id);
  return id;
}
