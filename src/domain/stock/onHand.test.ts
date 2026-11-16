import { describe, it, expect } from 'vitest';
import { onHand, laterThan, waitingBuys, type QtyMove } from './onHand';
import { moveDelta } from './stock';

const item = (qty: number, updated_at: string | null = '2026-11-15T10:00:00.000100+00:00') => ({ id: 'i', qty, updated_at });
const move = (id: string, delta: number, updated_at: string | null): QtyMove => ({ id, item_id: 'i', delta, updated_at, deleted_at: null });

describe('the quantity on hand while moves wait', () => {
  it('a move still on the phone counts, and still counts after the app is opened again offline (it is kept on the phone)', () => {
    // server 10; no signal, the mechanic counts 6: −4 waits on the phone
    const waiting = [move('m1', moveDelta('count', 6, onHand(item(10), [], new Set())), null)];
    expect(waiting[0].delta).toBe(-4);
    // the app is closed and opened again: the item row says 10, the move is read back from the phone's copy
    expect(onHand(item(10), waiting, new Set())).toBe(6);
    // he counts 6 again: nothing to send (the old screen said 10 and sent another −4: the server ended at 2)
    expect(moveDelta('count', 6, onHand(item(10), waiting, new Set()))).toBe(0);
  });
  it('a move confirmed before the item row comes back still counts; once the row is back it is not counted twice', () => {
    const sent = new Set(['m1']);
    const confirmed = [move('m1', -4, '2026-11-15T10:05:00.000200+00:00')];
    expect(onHand(item(10), confirmed, sent)).toBe(6);
    // the server's item row, stamped by the trigger after the move
    expect(onHand(item(6, '2026-11-15T10:05:00.000300+00:00'), confirmed, sent)).toBe(6);
    // a move of another phone arrives with its item row already counting it
    expect(onHand(item(10), [move('x', -2, '2026-11-15T10:06:00+00:00')], sent)).toBe(10);
  });
  it('a paid purchase answered with the item row is counted once (the old screen added it again: 38 + 24 = 86)', () => {
    // inventory_buy answered: the item row (62) and its move come back together, nothing waits
    const rows = [move('b1', 24, '2026-11-15T10:00:00.000050+00:00')];
    expect(onHand(item(62), rows, new Set())).toBe(62);
  });
  it('a purchase waiting in the outbox counts until it is sent', () => {
    const entries = [
      { kind: 'rpc', rpc: 'inventory_buy', args: { p_item: 'i', p_qty: 24 }, state: 'pending', tries: 1 },
      { kind: 'rpc', rpc: 'inventory_buy', args: { p_item: 'i', p_qty: 2 }, state: 'failed', tries: 3 },
      { kind: 'rpc', rpc: 'job_step', args: { p_item: 'i', p_qty: 5 }, state: 'pending', tries: 1 }
    ];
    expect(waitingBuys(entries, true).get('i')).toBe(24);
    expect(onHand(item(38), [], new Set(), waitingBuys(entries, true).get('i'))).toBe(62);
    // being sent the first time with signal: its answer brings the row, so it is not counted meanwhile
    expect(waitingBuys([{ ...entries[0], tries: 0 }], true).size).toBe(0);
    expect(waitingBuys([{ ...entries[0], tries: 0 }], false).get('i')).toBe(24);
  });
  it('server times compared to the microsecond, in both ways the server writes them', () => {
    expect(laterThan('2026-11-15T10:00:00.000200+00:00', '2026-11-15T10:00:00.000100+00:00')).toBe(true);
    expect(laterThan('2026-11-15 10:00:00.0001+00', '2026-11-15T10:00:00.0002+00:00')).toBe(false);
    expect(laterThan('2026-11-15T10:00:01Z', null)).toBe(true);
    expect(laterThan(null, '2026-11-15T10:00:01Z')).toBe(false);
  });
});
