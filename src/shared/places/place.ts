/* The place an address field gives back (a customer's, a job's, a truck's start), and what is saved from it.
   Pure: the field, the forms and the locator share these rules. */
import { postalCode } from '../../lib/text';
import { cityOf } from './address';

export interface PlaceValue { address: string; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null; city?: string | null }
export const EMPTY_PLACE: PlaceValue = { address: '', unit: null, postal_code: null, lat: null, lng: null, city: null };

/** the place to save on a customer or a job: the city read from the address when the map service did not give it. A postal code
    that is not one (« H3P », « 12345 ») is never written: the field shows it in red, and saving it would carry it into
    the file, the exports and the directions (customers-a-18). */
export function placeFields(v: PlaceValue): { address: string | null; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null; city: string | null } {
  const address = v.address.trim() || null;
  return {
    address,
    unit: v.unit?.trim() || null,
    postal_code: postalCode(v.postal_code),
    lat: address ? v.lat : null,
    lng: address ? v.lng : null,
    city: v.city || cityOf(address)
  };
}
