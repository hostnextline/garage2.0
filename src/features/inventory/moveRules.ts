/* The rules of the move form (Entrée, Sortie, Compter), apart from the drawing: what was typed is checked, the change it
   makes, and the line under the quantity. Pure (tested in moveRules.test.ts). */
import type { PaidFrom } from '../../data/api';
import { moveDelta, parseQty, round2, type MoveKind } from '../../domain/stock/stock';

export type MoveCheck =
  | { ok: false; field: 'qty'; error: 'errQty' | 'errZero' }
  | { ok: false; field: 'price'; error: 'needPrice' }
  | { ok: true; same: true }
  | { ok: true; same: false; delta: number; paid: boolean };

/** what « Ajouter au stock » / « Retirer du stock » / « Enregistrer le compte » will do with what was typed;
    `cur` is the quantity on hand (a count sends the difference with it) */
export function checkMove(mode: MoveKind, text: string, cur: number, from: PaidFrom, price: number | null): MoveCheck {
  const amount = parseQty(text);
  if (amount == null) return { ok: false, field: 'qty', error: 'errQty' };
  if (mode !== 'count' && amount <= 0) return { ok: false, field: 'qty', error: 'errZero' };
  const delta = moveDelta(mode, amount, cur);
  if (delta === 0) return { ok: true, same: true };
  const paid = mode === 'in' && from !== 'none';
  if (paid && !(price && price > 0)) return { ok: false, field: 'price', error: 'needPrice' };
  return { ok: true, same: false, delta, paid };
}

export type MoveHint = { kind: 'negative'; after: number } | { kind: 'same' } | { kind: 'diff'; delta: number } | { kind: 'after'; after: number } | null;
/** the line under the quantity while it is typed: what will be left, or the difference a count makes */
export function moveHint(mode: MoveKind | null, text: string, cur: number): MoveHint {
  const amount = parseQty(text);
  if (!mode || amount == null) return null;
  const delta = moveDelta(mode, amount, cur);
  const after = round2(cur + delta);
  if (after < 0) return { kind: 'negative', after };
  if (mode === 'count') return delta === 0 ? { kind: 'same' } : { kind: 'diff', delta };
  return { kind: 'after', after };
}
