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

/** what the sheet shows, and the amount in play (left to collect, or to give back). The payments and the refunds
    waiting are told apart (a payment waiting beside a refund waiting does not cancel it out). Nothing is taken on a
    draft or a cancelled invoice, a refund neither (the server refuses both). */
export function payMode(v: Pick<InvoiceView, 'inv' | 'due' | 'over' | 'waitingIn' | 'waitingOut'>, refund: boolean): { mode: PayMode; inPlay: number } {
  const s = v.inv.status;
  if (s === 'draft') return { mode: 'draft', inPlay: 0 };
  if (s === 'void') return { mode: 'void', inPlay: 0 };
  if (refund) {
    if (v.over > 0) return { mode: 'form', inPlay: v.over };
    return { mode: v.waitingOut < 0 ? 'refund-waiting' : 'refund-none', inPlay: 0 };
  }
  if (s === 'issued' && v.due > 0) return { mode: 'form', inPlay: v.due };
  return { mode: v.waitingIn > 0 ? 'waiting' : 'paid', inPlay: 0 };
}
/** « Inscrire le remboursement » is offered: money to give back on an invoice that may still take a payment */
export function mayRefund(v: Pick<InvoiceView, 'inv' | 'over' | 'finishing'>): boolean {
  return v.over > 0 && !v.finishing && (v.inv.status === 'issued' || v.inv.status === 'paid');
}

/** « Annuler la facture » is held by money still on it: payments that do not add up to zero (a payment and its refund
    do not hold it: the server's invoice_void accepts them), or a payment taken on this phone that has not reached the
    server (it would land on a cancelled invoice and be refused) */
export function holdsMoney(pays: { amount_cents: number }[], waiting: { cents: number }[]): boolean {
  return waiting.length > 0 || pays.reduce((n, p) => n + Number(p.amount_cents || 0), 0) !== 0;
}

/** what is wrong with the amount typed, if anything */
export function amountProblem(amount: number | null, inPlay: number): 'amount' | 'tooMuch' | null {
  if (amount == null || amount <= 0) return 'amount';
  if (amount > inPlay) return 'tooMuch';
  return null;
}
