/* « Encaisser » and « Rembourser »: what the sheet offers for an invoice as this phone sees it (pure, tested in
   pay.test.ts). A payment already taken on this phone and still waiting for the network is never offered again:
   the sheet says it waits, with its amount. A refund gives back only what was paid too much. */
import type { InvoiceView } from './view';

export type PayMode =
  | 'form'            // the form: method, amount
  | 'waiting'         // nothing left: a payment taken here waits for the network
  | 'draft' | 'void' | 'paid'
  | 'refund-none'     // « Rembourser »: nothing paid too much
  | 'refund-waiting'; // « Rembourser »: the refund taken here waits for the network

/** what the sheet shows, and the amount in play (left to collect, or to give back) */
export function payMode(v: Pick<InvoiceView, 'inv' | 'due' | 'over' | 'waiting'>, refund: boolean): { mode: PayMode; inPlay: number } {
  if (refund) {
    if (v.over > 0) return { mode: 'form', inPlay: v.over };
    return { mode: v.waiting < 0 ? 'refund-waiting' : 'refund-none', inPlay: 0 };
  }
  const s = v.inv.status;
  if (s === 'draft') return { mode: 'draft', inPlay: 0 };
  if (s === 'void') return { mode: 'void', inPlay: 0 };
  if (s === 'issued' && v.due > 0) return { mode: 'form', inPlay: v.due };
  return { mode: v.waiting > 0 ? 'waiting' : 'paid', inPlay: 0 };
}

/** what is wrong with the amount typed, if anything */
export function amountProblem(amount: number | null, inPlay: number): 'amount' | 'tooMuch' | null {
  if (amount == null || amount <= 0) return 'amount';
  if (amount > inPlay) return 'tooMuch';
  return null;
}
