import { describe, it, expect } from 'vitest';
import { missingPositions, placeTargets } from './positions';
import type { Customer, Job } from '../../data/types';

const cust = (id: string, address: string | null, lat: number | null = null) =>
  ({ id, address, lat, lng: lat == null ? null : -73.6, postal_code: null, city: null, deleted_at: null }) as unknown as Customer;
const job = (id: string, customer_id: string, extra: Partial<Job> = {}) =>
  ({ id, number: 1, customer_id, day: '2026-11-20', status: 'booked', address: null, lat: null, lng: null, postal_code: null, deleted_at: null, ...extra }) as unknown as Job;

describe('a position found in the background, written only where it still belongs (app-shell-13)', () => {
  const before = [cust('c1', '160 khalil gibran')];
  const jobs = [job('j1', 'c1', { address: '160 khalil gibran' })];
  const [task] = missingPositions(jobs, before, '2026-11-15');
  it('the customer and the appointment still at that address, still without a position, take it', () => {
    expect(placeTargets(task, before, jobs)).toEqual({ customerId: 'c1', jobIds: ['j1'] });
  });
  it('the address was corrected during the run: the old address’s position is not written on the new one', () => {
    const now = [cust('c1', '700 rue Lebeau, Saint-Laurent')];
    const movedJobs = [job('j1', 'c1', { address: '700 rue Lebeau, Saint-Laurent' })];
    expect(placeTargets(task, now, movedJobs)).toEqual({ customerId: null, jobIds: [] });
  });
  it('a position found meanwhile (« Chercher », a suggestion chosen) is kept', () => {
    expect(placeTargets(task, [cust('c1', '160 khalil gibran', 45.5)], [job('j1', 'c1', { address: '160 khalil gibran', lat: 45.5, lng: -73.6 })])).toEqual({ customerId: null, jobIds: [] });
  });
  it('an appointment with no address of its own follows its customer’s address', () => {
    const own = [job('j2', 'c1')];
    const [t2] = missingPositions(own, before, '2026-11-15');
    expect(placeTargets(t2, before, own)).toEqual({ customerId: 'c1', jobIds: ['j2'] });
    expect(placeTargets(t2, [cust('c1', 'ailleurs 12')], own)).toEqual({ customerId: null, jobIds: [] });
  });
});
