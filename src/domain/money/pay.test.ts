import { describe, it, expect } from 'vitest';
import type { Invoice } from '../../data/types';
import { payMode, mayRefund, amountProblem } from './pay';

const v = (status: Invoice['status'], due: number, over = 0, waitingIn = 0, waitingOut = 0) => ({ inv: { status } as Invoice, due, over, waitingIn, waitingOut });

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
    expect(payMode(v('paid', 0, 0, 0, -2755), true).mode).toBe('refund-waiting');
  });
  it('a payment and a refund both waiting are told apart, never added up (review inv-r4)', () => {
    // a refund waits beside a payment: the refund sheet says the refund waits (the sum, 0, used to say « Rien à rembourser »)
    expect(payMode(v('paid', 0, 0, 2755, -2755), true).mode).toBe('refund-waiting');
    // a payment waits beside a bigger refund: « Encaisser » says the payment waits (the sum, < 0, used to say « Payée »)
    expect(payMode(v('issued', 0, 0, 1000, -3000), false).mode).toBe('waiting');
    // only a payment waits: « Rien à rembourser »
    expect(payMode(v('paid', 0, 0, 1000, 0), true).mode).toBe('refund-none');
  });
  it('a cancelled invoice (or a draft) takes no refund: the server refuses it (review inv-r4)', () => {
    expect(payMode(v('void', 0, 3000), true)).toEqual({ mode: 'void', inPlay: 0 });
    expect(payMode(v('draft', 0, 3000), true)).toEqual({ mode: 'draft', inPlay: 0 });
    expect(mayRefund({ inv: { status: 'void' } as Invoice, over: 3000, finishing: false })).toBe(false);
    expect(mayRefund({ inv: { status: 'paid' } as Invoice, over: 3000, finishing: false })).toBe(true);
    expect(mayRefund({ inv: { status: 'issued' } as Invoice, over: 3000, finishing: false })).toBe(true);
    expect(mayRefund({ inv: { status: 'paid' } as Invoice, over: 3000, finishing: true })).toBe(false);
    expect(mayRefund({ inv: { status: 'paid' } as Invoice, over: 0, finishing: false })).toBe(false);
  });
  it('the amount typed', () => {
    expect(amountProblem(null, 100)).toBe('amount');
    expect(amountProblem(0, 100)).toBe('amount');
    expect(amountProblem(101, 100)).toBe('tooMuch');
    expect(amountProblem(100, 100)).toBeNull();
  });
});
