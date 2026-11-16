import { describe, it, expect } from 'vitest';
import { jobsAtOldAddress, addressPatch } from './followAddress';
import type { Job } from '../../data/types';

const job = (id: string, o: Partial<Job> = {}) => ({ id, customer_id: 'c1', day: '2026-11-20', status: 'booked', address: '1250 rue Graham, Mont-Royal', deleted_at: null, ...o }) as Job;

describe('the appointments that follow a new address (customers-a-04)', () => {
  const old = { address: '1250 Rue Graham, Mont-Royal' };
  it('only the coming booked ones still at the old address (or with none of their own)', () => {
    const jobs = [job('a'), job('b', { address: null }), job('c', { address: '700 rue Lebeau' }), job('d', { status: 'en_route' }), job('e', { status: 'done' }),
      job('f', { day: '2026-11-01' }), job('g', { customer_id: 'c2' }), job('h', { deleted_at: '2026-11-10' })];
    expect(jobsAtOldAddress(jobs, 'c1', old, '2026-11-15').map((j) => j.id)).toEqual(['a', 'b']);
  });
  it('a file that had no address: only appointments without one of their own', () => {
    expect(jobsAtOldAddress([job('a'), job('b', { address: '' })], 'c1', { address: null }, '2026-11-15').map((j) => j.id)).toEqual(['b']);
  });
  it('the appointment takes the whole new place', () => {
    expect(addressPatch({ address: '700 rue Lebeau', unit: null, postal_code: 'H4N 1S2', lat: 45.5, lng: -73.7, city: 'Saint-Laurent' }))
      .toEqual({ address: '700 rue Lebeau', unit: null, postal_code: 'H4N 1S2', lat: 45.5, lng: -73.7 });
  });
});
