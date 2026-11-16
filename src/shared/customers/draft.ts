/* A customer's file as it is being typed (the new customer page, « Modifier », the picker's short sheet, booking's new
   caller): the draft, what is saved from it, what changed, what is refused. Pure (no drawing), tested in draft.test.ts. */
import { t } from '../../lib/i18n';
import { phoneDigits, formatPhone, EMAIL_RE } from '../../lib/text';
import type { Customer, Lang } from '../../data/types';
import { placeFields, EMPTY_PLACE, type PlaceValue } from '../places/AddressField';
import { cap } from './search';

export interface Draft {
  first_name: string; last_name: string; company: string; phone: string; email: string; lang: Lang;
  place: PlaceValue; notes: string; sms_ok: boolean; card_on_file: boolean;
}
export function emptyDraft(o: Partial<Draft> = {}): Draft {
  return { first_name: '', last_name: '', company: '', phone: '', email: '', lang: 'fr', place: { ...EMPTY_PLACE }, notes: '', sms_ok: true, card_on_file: false, ...o };
}
export function draftOf(c: Customer): Draft {
  return {
    first_name: c.first_name || '', last_name: c.last_name || '', company: c.company || '', phone: c.phone || '', email: c.email || '',
    lang: c.lang === 'en' ? 'en' : 'fr', notes: c.notes || '', sms_ok: c.sms_ok !== false, card_on_file: !!c.card_on_file,
    place: { address: c.address || '', unit: c.unit, postal_code: c.postal_code, lat: c.lat, lng: c.lng, city: c.city }
  };
}
/** what is saved: names written with capitals when typed in lower case, the phone written the Québec way */
export function customerPatch(d: Draft): Partial<Customer> {
  const name = (s: string) => (s.trim() ? cap(s.trim().replace(/\s+/g, ' ')) : null);
  return {
    first_name: name(d.first_name), last_name: name(d.last_name), company: d.company.trim() || null,
    phone: d.phone.trim() ? formatPhone(d.phone) : null, email: d.email.trim() || null, lang: d.lang,
    ...placeFields(d.place), notes: d.notes.trim() || null, sms_ok: d.sms_ok, card_on_file: d.card_on_file
  };
}
/** only the fields that changed (two people may change the same file at the same time) */
export function changed(before: Partial<Customer>, after: Partial<Customer>): Partial<Customer> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) if ((before as Record<string, unknown>)[k] !== v) out[k] = v;
  return out as Partial<Customer>;
}
const PLACE_KEYS = ['address', 'unit', 'postal_code', 'lat', 'lng'] as const;
/** the change moves the customer somewhere else (another door, unit, postal code or position) */
export function movesAddress(diff: Partial<Customer>): boolean { return PLACE_KEYS.some((k) => k in diff); }

export interface DraftErrors { name?: string; phone?: string; email?: string }
/** what is refused. `storedPhone`: the number already on the file; it is only checked when it was changed, so a number
    saved by the online booking or an import (an extension, 7 digits) does not block a change of the notes */
export function checkDraft(d: Draft, storedPhone?: string | null): DraftErrors {
  const e: DraftErrors = {};
  if (!d.first_name.trim() && !d.last_name.trim() && !d.company.trim()) e.name = t('customers.form.errors.name');
  const phoneTouched = storedPhone === undefined || d.phone.trim() !== (storedPhone || '').trim();
  if (d.phone.trim() && phoneTouched && !phoneDigits(d.phone)) e.phone = t('customers.form.errors.phone');
  if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) e.email = t('customers.form.errors.email');
  return e;
}
export const hasErrors = (e: DraftErrors) => Object.values(e).some(Boolean);
