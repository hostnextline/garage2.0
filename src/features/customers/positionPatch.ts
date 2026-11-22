/* What « Chercher » writes on a customer's file once a place is chosen: the position, and the town when the file has
   none. Never the postal code of the answer: OpenStreetMap's are often wrong in Canada (CLAUDE.md « Postal codes »),
   only a code the person typed is saved. Pure, tested in positionPatch.test.ts. */
import type { Customer } from '../../data/types';
import type { Suggestion } from '../../shared/places/photon';

export function positionPatch(c: Pick<Customer, 'id' | 'city'>, s: Pick<Suggestion, 'place'>): Partial<Customer> {
  return { id: c.id, lat: s.place.lat, lng: s.place.lng, ...(c.city ? {} : { city: s.place.city ?? null }) };
}
