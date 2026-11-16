/* « Itinéraire »: Google Maps' directions to the job. Pure (tested in directions.test.ts).
   The words of the address are the destination (Google shows them, the mechanic recognises them); a position only when
   there is no address at all. */
import type { Job, Customer } from '../../data/types';

export function destinationOf(j: Pick<Job, 'address' | 'lat' | 'lng'>, c: Pick<Customer, 'address' | 'lat' | 'lng'> | null | undefined): string {
  const addr = (j.address || c?.address || '').trim();
  if (addr) return addr;
  const lat = j.lat ?? c?.lat, lng = j.lng ?? c?.lng;
  return lat != null && lng != null ? `${lat},${lng}` : '';
}
export function mapsHref(j: Pick<Job, 'address' | 'lat' | 'lng'>, c: Pick<Customer, 'address' | 'lat' | 'lng'> | null | undefined): string | null {
  const dest = destinationOf(j, c);
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving` : null;
}
