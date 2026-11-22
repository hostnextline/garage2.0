/* The estimate as its editor holds it, and back to the row that is saved. */
import type { Quote, Lang } from '../../data/types';
import { cleanItems } from '../../domain/money/quote';
import { withKeys, type EditLine } from '../../domain/money/editLines';

export interface QV {
  items: EditLine[]; customer_id: string | null; vehicle_id: string | null; contact_name: string; contact_phone: string; vehicle_text: string;
  notes: string; valid_until: string; lang: Lang;
}
export const fromQuote = (q: Quote): QV => ({
  items: withKeys(q.items), customer_id: q.customer_id ?? null, vehicle_id: q.vehicle_id ?? null, contact_name: q.contact_name || '', contact_phone: q.contact_phone || '',
  vehicle_text: q.vehicle_text || '', notes: q.notes || '', valid_until: q.valid_until || '', lang: q.lang === 'en' ? 'en' : 'fr'
});
export const toPatch = (v: QV) => ({
  items: cleanItems(v.items), customer_id: v.customer_id, vehicle_id: v.customer_id ? v.vehicle_id : null, contact_name: v.contact_name.trim() || null,
  contact_phone: v.contact_phone.trim() || null, vehicle_text: v.vehicle_text.trim() || null, notes: v.notes.trim() || null, valid_until: v.valid_until || null, lang: v.lang
}) satisfies Partial<Quote>;
export const quoteSig = (v: QV) => JSON.stringify(toPatch(v));
