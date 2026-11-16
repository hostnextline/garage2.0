import { describe, it, expect } from 'vitest';
import type { Invoice } from '../../data/types';
import { payMode, amountProblem } from './pay';

const v = (status: Invoice['status'], due: number, over = 0, waiting = 0) => ({ inv: { status } as Invoice, due, over, waiting });

describe('what « Encaisser » offers', () => {
  it('the form for what is left to collect', () => {
    expect(payMode(v('issued', 11498), false)).toEqual({ mode: 'form', inPlay: 11498 });
  });
  it('a payment taken here and still waiting for the network: no second payment for the same balance', () => {
    expect(payMode(v('issued', 0, 0, 11498), false)).toEqual({ mode: 'waiting', inPlay: 0 });
    // a part waits: only the rest is offered
    expect(payMode(v('issued', 4498, 0, 7000), false)).toEqual({ mode: 'form', inPlay: 4498 });
  });
  it('a draft, a cancelled or a paid invoice: nothing to collect', () => {
    expect(payMode(v('draft', 1000), false).mode).toBe('draft');
    expect(payMode(v('void', 0), false).mode).toBe('void');
    expect(payMode(v('paid', 0), false).mode).toBe('paid');
  });
  it('« Rembourser »: only what was paid too much', () => {
    expect(payMode(v('paid', 0, 2755), true)).toEqual({ mode: 'form', inPlay: 2755 });
    expect(payMode(v('paid', 0, 0), true).mode).toBe('refund-none');
    expect(payMode(v('paid', 0, 0, -2755), true).mode).toBe('refund-waiting');
  });
  it('the amount typed', () => {
    expect(amountProblem(null, 100)).toBe('amount');
    expect(amountProblem(0, 100)).toBe('amount');
    expect(amountProblem(101, 100)).toBe('tooMuch');
    expect(amountProblem(100, 100)).toBeNull();
  });
});
