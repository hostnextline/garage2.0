import { describe, it, expect } from 'vitest';
import { checkMove, moveHint } from './moveRules';

describe('the move form', () => {
  it('checks what was typed in the old order: a quantity, more than zero, the same count, then the price paid', () => {
    expect(checkMove('in', 'abc', 10, 'none', null)).toEqual({ ok: false, field: 'qty', error: 'errQty' });
    expect(checkMove('out', '0', 10, 'none', null)).toEqual({ ok: false, field: 'qty', error: 'errZero' });
    expect(checkMove('count', '10', 10, 'none', null)).toEqual({ ok: true, same: true });
    expect(checkMove('count', '0', 10, 'none', null)).toEqual({ ok: true, same: false, delta: -10, paid: false });
    expect(checkMove('in', '24', 10, 'treasury', null)).toEqual({ ok: false, field: 'price', error: 'needPrice' });
    expect(checkMove('in', '24', 10, 'treasury', 24000)).toEqual({ ok: true, same: false, delta: 24, paid: true });
    expect(checkMove('out', '4,5', 10, 'treasury', null)).toEqual({ ok: true, same: false, delta: -4.5, paid: false });
  });
  it('the line under the quantity', () => {
    expect(moveHint('out', '12', 10)).toEqual({ kind: 'negative', after: -2 });
    expect(moveHint('in', '2', 10)).toEqual({ kind: 'after', after: 12 });
    expect(moveHint('count', '7', 10)).toEqual({ kind: 'diff', delta: -3 });
    expect(moveHint('count', '10', 10)).toEqual({ kind: 'same' });
    expect(moveHint('in', '', 10)).toBeNull();
    expect(moveHint(null, '2', 10)).toBeNull();
  });
});
