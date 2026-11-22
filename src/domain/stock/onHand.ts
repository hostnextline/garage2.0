/* The quantity on hand, as the person must see it while moves wait to be sent.
   The server changes an item's quantity itself when a move is saved (a trigger), so the item row the phone holds can be
   behind: a move still on the phone (no signal), or one just confirmed while the item row is not back yet. Instead of
   patching the quantity in memory (lost at the next start, and counted twice when the server's row arrives first),
   the number is worked out each time from what the phone keeps:
   - a move not yet confirmed by the server (no updated_at): its change is added;
   - a move sent from this phone that the server confirmed AFTER the item row we hold was written: added too (the
     trigger stamps the item after the move, so a fresh item row is always later than the moves it counts);
   - a purchase (inventory_buy) still waiting in the outbox: its quantity is added.
   « Compter » uses this number, so counting the same shelf twice offline sends the difference once.
   Pure (tested in onHand.test.ts). */
import { round2 } from './stock';

/* a server time to the microsecond: « 2026-11-15T10:00:00.123456+00:00 » (a Date keeps only the milliseconds, and two
   writes of one transaction can share a millisecond). [milliseconds, microseconds left] or null */
function stampOf(s: string | null | undefined): [number, number] | null {
  if (!s) return null;
  const ms = Date.parse(String(s).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  if (!Number.isFinite(ms)) return null;
  const frac = /\.(\d+)/.exec(String(s))?.[1] || '';
  return [ms, Number((frac + '000000').slice(3, 6))];
}
/** true when the time `a` is strictly after `b` (unknown times are never after) */
export function laterThan(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = stampOf(a), y = stampOf(b);
  if (!x) return false;
  if (!y) return true;
  return x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
}

/* the fields read (rows the server has not confirmed carry no updated_at) */
export interface QtyMove { id: string; item_id: string; delta: number; updated_at?: string | null; deleted_at?: string | null }
export interface QtyItem { id: string; qty: number; updated_at?: string | null }

/** the moves of an item that its row does not count yet */
export function movesNotCounted(item: Pick<QtyItem, 'id' | 'updated_at'>, moves: QtyMove[], sentHere: ReadonlySet<string>): QtyMove[] {
  return moves.filter((m) => m.item_id === item.id && !m.deleted_at && (!m.updated_at || (sentHere.has(m.id) && laterThan(m.updated_at, item.updated_at))));
}
/** the quantity on hand: the item's row, plus the moves it does not count yet, plus the purchases still waiting */
export function onHand(item: QtyItem, moves: QtyMove[], sentHere: ReadonlySet<string>, waitingBuys = 0): number {
  const add = movesNotCounted(item, moves, sentHere).reduce((n, m) => n + Number(m.delta || 0), 0);
  return round2(Number(item.qty || 0) + add + waitingBuys);
}

/** a purchase waiting in the outbox (the entry's shape, as data/local keeps it) */
export interface WaitingEntry { kind: string; rpc?: string; args?: Record<string, unknown>; state: string; tries: number }
/** the quantity each item gets from purchases still waiting to be sent. A purchase being sent for the first time while
    the phone has signal is not counted: its answer brings the item row in a moment (counting it would show it twice) */
export function waitingBuys(entries: WaitingEntry[], online: boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== 'rpc' || e.rpc !== 'inventory_buy' || e.state !== 'pending') continue;
    if (online && !(e.tries > 0)) continue;
    const item = String(e.args?.p_item ?? '');
    const qty = Number(e.args?.p_qty);
    if (item && Number.isFinite(qty)) out.set(item, round2((out.get(item) ?? 0) + qty));
  }
  return out;
}
