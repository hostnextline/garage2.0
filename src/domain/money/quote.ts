/* Estimates: the pure rules (no screen, no store). An estimate needs no customer: a name, a phone and a car written
   on the spot are enough (Hassan's « estimation sur place sans info client »). */
import type { Quote, QuoteItem } from '../../data/types';
import type { TaxRates } from '../../lib/money';
import { addDays, type Day } from '../../lib/dates';
import { linesTotals, cleanLine } from './invoice';

export type QuoteStatus = Quote['status'];

export function quoteTotals(items: QuoteItem[] | null | undefined, rates: Partial<TaxRates> | null | undefined) {
  return linesTotals(items || [], rates, true);
}
/** the items as they are saved (the screen's keys removed; what booking needs kept: service, duration).
    A line typed by hand is not a service of the price list: it is saved as labour, so booking the estimate does not
    count 45 minutes per unit for it (« Valves, qté 4 » is not 3 hours of work). */
export function cleanItems(lines: (QuoteItem & { _k?: string })[]): QuoteItem[] {
  return lines.map((l) => {
    const c = cleanLine(l);
    const kind = c.kind === 'service' && !l.service_id ? 'labour' : c.kind;
    const out: QuoteItem = { description: c.description, qty: c.qty, unit_cents: c.unit_cents, taxable: c.taxable, kind };
    if (l.service_id) out.service_id = l.service_id;
    if (l.duration_min != null) out.duration_min = l.duration_min;
    return out;
  });
}
/** nothing was written yet (an estimate opened by mistake is not kept) */
export function quoteIsEmpty(q: Pick<Quote, 'items' | 'contact_name' | 'contact_phone' | 'vehicle_text' | 'customer_id' | 'vehicle_id' | 'notes'>): boolean {
  return !(q.items || []).length && !q.contact_name?.trim() && !q.contact_phone?.trim() && !q.vehicle_text?.trim() && !q.customer_id && !q.vehicle_id && !q.notes?.trim();
}
/** an estimate opened by mistake and left empty is not kept when its screen closes: only by the person who just made
    it on this phone (someone else opening a fresh one must not delete it under its author), only while it is open */
export function dropWhenLeft(o: { madeHere: boolean; canEdit: boolean; row: Pick<Quote, 'status' | 'deleted_at'> | null | undefined; empty: boolean }): boolean {
  return o.madeHere && o.canEdit && !!o.row && !o.row.deleted_at && o.row.status === 'open' && o.empty;
}
/** past its « valide jusqu'au » while still waiting for an answer */
export function quoteExpired(q: Pick<Quote, 'valid_until' | 'status'>, today: Day): boolean {
  return !!q.valid_until && q.valid_until < today && (q.status === 'open' || q.status === 'sent');
}
const VALID_DAYS = 30;
/** « valide jusqu'au » of a new estimate */
export function defaultValidUntil(today: Day): Day { return addDays(today, VALID_DAYS); }
/** the fields that changed since the server's version: only those are sent (two people on one estimate do not
    overwrite each other's other fields). Null: nothing to send. */
export function changedOnly<T extends Record<string, unknown>>(next: T, base: T): Partial<T> | null {
  const out: Partial<T> = {};
  for (const k of Object.keys(next) as (keyof T)[]) if (JSON.stringify(next[k]) !== JSON.stringify(base[k])) out[k] = next[k];
  return Object.keys(out).length ? out : null;
}
