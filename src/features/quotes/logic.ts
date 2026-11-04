/* Estimates: the pure rules (no screen, no store). An estimate needs no customer: a name, a phone and a car written
   on the spot are enough (Hassan's « estimation sur place sans info client »). */
import type { Quote, QuoteItem } from '../../data/types';
import type { TaxRates } from '../../lib/money';
import { addDays, type Day } from '../../lib/dates';
import { linesTotals, cleanLine } from '../invoices/logic';

export type QuoteStatus = Quote['status'];
export const QUOTE_STATUSES: QuoteStatus[] = ['open', 'sent', 'accepted', 'declined', 'converted'];

export function quoteTotals(items: QuoteItem[] | null | undefined, rates: Partial<TaxRates> | null | undefined) {
  return linesTotals(items || [], rates, true);
}
/** the items as they are saved (the screen's keys removed; what booking needs kept: service, duration) */
export function cleanItems(lines: (QuoteItem & { _k?: string })[]): QuoteItem[] {
  return lines.map((l) => {
    const c = cleanLine(l);
    const out: QuoteItem = { description: c.description, qty: c.qty, unit_cents: c.unit_cents, taxable: c.taxable, kind: c.kind };
    if (l.service_id) out.service_id = l.service_id;
    if (l.duration_min != null) out.duration_min = l.duration_min;
    return out;
  });
}
/** nothing was written yet (an estimate opened by mistake is not kept) */
export function quoteIsEmpty(q: Pick<Quote, 'items' | 'contact_name' | 'contact_phone' | 'vehicle_text' | 'customer_id' | 'vehicle_id' | 'notes'>): boolean {
  return !(q.items || []).length && !q.contact_name?.trim() && !q.contact_phone?.trim() && !q.vehicle_text?.trim() && !q.customer_id && !q.vehicle_id && !q.notes?.trim();
}
/** past its « valide jusqu'au » while still waiting for an answer */
export function quoteExpired(q: Pick<Quote, 'valid_until' | 'status'>, today: Day): boolean {
  return !!q.valid_until && q.valid_until < today && (q.status === 'open' || q.status === 'sent');
}
export const DEFAULT_VALID_DAYS = 30;
export function defaultValidUntil(today: Day): Day { return addDays(today, DEFAULT_VALID_DAYS); }
