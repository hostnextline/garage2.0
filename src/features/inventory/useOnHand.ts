/* The quantity on hand for the inventory screens: the item's row, plus the moves and purchases it does not count yet
   (domain/stock/onHand). The purchases waiting to be sent live in the outbox on the phone (not in a table), so they are
   read again each time the outbox changes. */
import { useEffect, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { rowsOf } from '../../data/store';
import { net, outboxList } from '../../data/sync';
import type { InventoryItem, InventoryMove } from '../../data/types';
import { onHand, waitingBuys } from '../../domain/stock/onHand';
import { sentHere } from './actions';

/** the purchases waiting in the outbox, per item (read again when the outbox or the signal changes) */
function useWaitingBuys(): Map<string, number> {
  const [buys, setBuys] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let seq = 0;
    const stop = effect(() => {
      const { pending, online } = net.value;
      const mine = ++seq;
      // nothing waits: no need to open the outbox
      if (!pending) { setBuys((b) => (b.size ? new Map() : b)); return; }
      // (outboxList never fails: a broken local copy reads as an empty outbox)
      void outboxList().then((entries) => { if (mine === seq) setBuys(waitingBuys(entries, online)); });
    });
    return () => { seq++; stop(); };
  }, []);
  return buys;
}

/** a function giving the quantity on hand of an item; the screen re-renders when a move, the sent set or the outbox changes */
export function useOnHand(): (item: InventoryItem) => number {
  const buys = useWaitingBuys();
  const sent = sentHere.value;
  // only the moves still waiting or sent from here can be missing from an item's row: a handful, even with a long
  // history, so hundreds of rows stay fast
  const open = rowsOf<InventoryMove>('inventory_moves').filter((m) => !m.updated_at || sent.has(m.id));
  return (item) => onHand(item, open, sent, buys.get(item.id) ?? 0);
}
/** the item as the screens show it: its quantity on hand in place of the row's (value, « À commander », the count) */
export function useShownItems(): (items: InventoryItem[]) => InventoryItem[] {
  const qty = useOnHand();
  return (items) => items.map((i) => {
    const q = qty(i);
    return q === Number(i.qty) ? i : { ...i, qty: q };
  });
}
