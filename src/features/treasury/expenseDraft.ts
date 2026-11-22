/* The expense form's rules, without the screen: what is saved comes from here, so every rule is tested
   (expenseDraft.test.ts).
   - The total paid is the truth (it is printed on the receipt), unless the person types the price before taxes: the
     field typed last is the anchor and the others are worked out from it.
   - A field left WITHOUT a change changes nothing. The money field reports its value again when it is left; acting on
     that report re-split a total from the rates (taxes the receipt never showed, bug 03), moved the anchor to a subtotal
     that held the leftover cent (the total changed by a cent, bug 04), or marked the amounts as typed by the person, so
     the receipt reader then left them empty (bug 05).
   - What the reader proposes fills only what the person has not typed, and its message says what was really filled. */
import { addDays, isValidDay, type Day } from '../../lib/dates';
import type { Cents, TaxRates } from '../../lib/money';
import type { Expense } from '../../data/types';
import { guessCategory, splitFromSubtotal, splitFromTotal, type ReceiptGuess } from './receipt';

export type Anchor = 'total' | 'subtotal';
export interface Draft {
  day: string; vendor: string; category: string; description: string;
  total: Cents | null; subtotal: Cents | null; tps: Cents | null; tvq: Cents | null; taxed: boolean; anchor: Anchor;
  method: string | null; truck_id: string | null; receipt_id: string | null;
}
export type AmountField = 'total' | 'subtotal' | 'tps' | 'tvq';
/** the fields a receipt can fill; 'amounts' stands for the four amounts and the taxes switch */
export type ReadField = 'vendor' | 'day' | 'category' | 'amounts';

/** a new expense (today, taxed when the garage charges taxes) or the one being changed */
export function freshDraft(e: Expense | null | undefined, today: Day, taxedByDefault = true): Draft {
  if (e) {
    return {
      day: e.day, vendor: e.vendor || '', category: e.category || '', description: e.description || '',
      total: e.total_cents, subtotal: e.subtotal_cents, tps: e.tps_cents, tvq: e.tvq_cents,
      taxed: (e.tps_cents || 0) + (e.tvq_cents || 0) !== 0 || e.subtotal_cents !== e.total_cents, anchor: 'total',
      method: e.method || null, truck_id: e.truck_id || null, receipt_id: e.receipt_id || null
    };
  }
  return { day: today, vendor: '', category: '', description: '', total: null, subtotal: null, tps: null, tvq: null, taxed: taxedByDefault, anchor: 'total', method: null, truck_id: null, receipt_id: null };
}

export function withTotal(d: Draft, total: Cents | null, rates: TaxRates): Draft {
  if (total == null) return { ...d, total: null, subtotal: null, tps: d.taxed ? null : 0, tvq: d.taxed ? null : 0, anchor: 'total' };
  if (!d.taxed) return { ...d, total, subtotal: total, tps: 0, tvq: 0, anchor: 'total' };
  return { ...d, ...splitFromTotal(total, rates), anchor: 'total' };
}
export function withSubtotal(d: Draft, subtotal: Cents | null, rates: TaxRates): Draft {
  if (subtotal == null) return { ...d, subtotal: null, total: null, tps: d.taxed ? null : 0, tvq: d.taxed ? null : 0, anchor: 'subtotal' };
  if (!d.taxed) return { ...d, subtotal, total: subtotal, tps: 0, tvq: 0, anchor: 'subtotal' };
  return { ...d, ...splitFromSubtotal(subtotal, rates), anchor: 'subtotal' };
}
/** a tax typed by hand: the other side of the anchor follows (the anchor itself never moves) */
function withTax(d: Draft, key: 'tps' | 'tvq', v: Cents | null): Draft {
  const n = { ...d, [key]: v };
  if (n.anchor === 'subtotal') { if (n.subtotal != null) n.total = n.subtotal + (n.tps ?? 0) + (n.tvq ?? 0); }
  else if (n.total != null) n.subtotal = n.total - (n.tps ?? 0) - (n.tvq ?? 0);
  return n;
}
export function withTaxed(d: Draft, taxed: boolean, rates: TaxRates): Draft {
  const n = { ...d, taxed };
  return n.anchor === 'subtotal' ? withSubtotal(n, n.subtotal, rates) : withTotal(n, n.total, rates);
}

/** an amount field reported `cents`: the new draft, or null when it is the value the draft already holds (the field
    was only left, or passed through with Tab). The caller then does nothing at all: no new split, no « typed » mark. */
export function typedAmount(d: Draft, field: AmountField, cents: Cents | null, rates: TaxRates): Draft | null {
  if (d[field] === cents) return null;
  if (field === 'total') return withTotal(d, cents, rates);
  if (field === 'subtotal') return withSubtotal(d, cents, rates);
  return withTax(d, field, cents);
}

/** what the form refuses, as the key of the words that explain it */
export type DraftError = 'day' | 'total' | 'category' | 'sum';
export const ERROR_WORDS: Record<DraftError, string> = {
  day: 'treasury.form.errDay', total: 'treasury.form.errTotal', category: 'treasury.form.errCategory', sum: 'treasury.form.errSum'
};
export const FUTURE_DAY_WORDS = 'treasury.form.errDayFuture';
/** the problems of a draft, each with the words to show (empty = it can be saved). `today` is the device's day. */
export function checkDraft(d: Draft, today: Day): Partial<Record<DraftError, string>> {
  const e: Partial<Record<DraftError, string>> = {};
  if (!isValidDay(d.day)) e.day = ERROR_WORDS.day;
  // the date input's max is only a hint: a typed year 2062 would put the expense in no period the screen offers.
  // One day of grace, for a phone set to another time zone.
  else if (d.day > addDays(today, 1)) e.day = FUTURE_DAY_WORDS;
  if (d.total == null || d.total <= 0) e.total = ERROR_WORDS.total;
  if (!d.category.trim()) e.category = ERROR_WORDS.category;
  if (!e.total && d.taxed && (d.subtotal == null || d.tps == null || d.tvq == null || d.subtotal < 0 || d.subtotal + d.tps + d.tvq !== d.total)) e.sum = ERROR_WORDS.sum;
  return e;
}

/** the expense row to save from a valid draft */
export function draftAmounts(d: Draft): { subtotal_cents: Cents; tps_cents: Cents; tvq_cents: Cents; total_cents: Cents } {
  return { subtotal_cents: d.taxed ? d.subtotal! : d.total!, tps_cents: d.taxed ? d.tps! : 0, tvq_cents: d.taxed ? d.tvq! : 0, total_cents: d.total! };
}

export type ReadMessage = 'read' | 'partial' | 'nothing';
export interface ReceiptFill { draft: Draft; filled: Set<ReadField>; message: ReadMessage }
/** puts what the reader found into the fields the person has not typed (`typed`), and says what happened */
export function applyReceipt(
  d0: Draft, g: ReceiptGuess & { consistent: boolean }, typed: ReadonlySet<ReadField>,
  o: { categories: string[]; history: { vendor: string | null; category: string }[]; rates: TaxRates; taxedByDefault: boolean }
): ReceiptFill {
  let d = { ...d0 };
  const filled = new Set<ReadField>();
  if (!typed.has('vendor') && g.vendor) { d.vendor = g.vendor; filled.add('vendor'); }
  if (!typed.has('day') && g.day) { d.day = g.day; filled.add('day'); }
  if (!typed.has('category') && !d.category) {
    const c = guessCategory(d.vendor, o.categories, o.history);
    if (c) { d.category = c; filled.add('category'); }
  }
  if (!typed.has('amounts')) {
    const next = receiptAmounts(d, g, o.rates, o.taxedByDefault);
    if (next) { d = next; filled.add('amounts'); }
  }
  const found = g.total != null || g.subtotal != null || !!g.vendor || !!g.day;
  // « Reçu lu » only when the amounts on screen are the receipt's own and add up; otherwise ask to check and complete
  const message: ReadMessage = !found ? 'nothing' : filled.has('amounts') && g.consistent ? 'read' : 'partial';
  return { draft: d, filled, message };
}
function receiptAmounts(d: Draft, g: ReceiptGuess & { consistent: boolean }, rates: TaxRates, taxedByDefault: boolean): Draft | null {
  if (g.consistent && g.total != null) {
    return { ...d, total: g.total, subtotal: g.subtotal, tps: g.tps, tvq: g.tvq, taxed: (g.tps ?? 0) + (g.tvq ?? 0) > 0, anchor: 'total' };
  }
  // the taxes printed are what was really paid (a tip, or a line the reader missed, makes the total bigger than
  // subtotal + taxes): keep them, and the rest of the total is the part before taxes
  if (g.total != null && g.tps != null && g.tvq != null && g.total - g.tps - g.tvq >= 0) {
    return { ...d, total: g.total, tps: g.tps, tvq: g.tvq, subtotal: g.total - g.tps - g.tvq, taxed: g.tps + g.tvq > 0, anchor: 'total' };
  }
  if (g.total != null) return withTotal({ ...d, taxed: taxedByDefault }, g.total, rates);
  if (g.subtotal != null) return withSubtotal({ ...d, taxed: taxedByDefault }, g.subtotal, rates);
  return null;
}
