/* A customer's file got another address: which coming appointments still go to the old one. Every appointment keeps its
   own copy of the address (booking copies it; « Modifier le rendez-vous » can put another one), so a corrected file
   does not move them by itself, and the truck would go to the old door. Only appointments still booked (not on the
   road, not started) and still at the file's OLD address (or with no address of their own) are offered; one booked at
   another address on purpose stays where it is. Pure, tested in followAddress.test.ts. */
import type { Customer, Job } from '../../data/types';
import { addrKey } from '../../shared/customers/positions';

export function jobsAtOldAddress(jobs: Job[], customerId: string, old: Pick<Customer, 'address'>, today: string): Job[] {
  const oldKey = addrKey(old.address);
  return jobs.filter((j) => j.customer_id === customerId && !j.deleted_at && j.status === 'booked' && j.day >= today
    && (j.address?.trim() ? !!oldKey && addrKey(j.address) === oldKey : true));
}
/** what the appointments take from the file's new address */
export function addressPatch(c: Partial<Customer>) {
  return { address: c.address ?? null, unit: c.unit ?? null, postal_code: c.postal_code ?? null, lat: c.lat ?? null, lng: c.lng ?? null };
}
