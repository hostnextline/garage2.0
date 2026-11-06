import { describe, it, expect } from 'vitest';
import { missingPositions, jobPlace, addrKey } from './locator';
import type { Customer, Job } from '../data/types';

const cust = (id: string, address: string | null, lat: number | null = null, extra: Partial<Customer> = {}) =>
  ({ id, address, lat, lng: lat == null ? null : -73.6, postal_code: null, city: null, deleted_at: null, ...extra }) as unknown as Customer;
const job = (id: string, customer_id: string | null, day: string, extra: Partial<Job> = {}) =>
  ({ id, number: Number(id.replace(/\D/g, '')) || 1, customer_id, day, status: 'booked', address: null, lat: null, lng: null, postal_code: null, deleted_at: null, ...extra }) as unknown as Job;

describe('the positions still missing', () => {
  const TODAY = '2026-11-07';
  it('the real case: two appointments of tomorrow typed without a choice, one already placed', () => {
    const customers = [cust('c3', '144 58e Avenue, Laval, QC', null, { postal_code: 'H7V 2A7' }), cust('c4', '160 khalil gibran'), cust('c5', '3500 rue Fleury Est, Montréal, QC H1H 2V1', 45.57)];
    const jobs = [
      job('j1003', 'c3', TODAY, { address: '144 58e Avenue, Laval, QC' }),
      job('j1004', 'c4', TODAY, { address: '160 khalil gibran' }),
      job('j1005', 'c5', TODAY, { address: '3500 rue Fleury Est, Montréal, QC H1H 2V1', lat: 45.57, lng: -73.6 })
    ];
    const tasks = missingPositions(jobs, customers, TODAY);
    expect(tasks.map((t) => [t.address, t.customerId, t.jobIds])).toEqual([
      ['144 58e Avenue, Laval, QC', 'c3', ['j1003']],
      ['160 khalil gibran', 'c4', ['j1004']]
    ]);
    expect(tasks[0].postal).toBe('H7V 2A7');
  });
  it('appointments first (nearest day first), then customers; one lookup per address', () => {
    const customers = [cust('a', '1 rue A, Laval'), cust('b', '2 rue B, Laval'), cust('z', '9 rue Z, Laval')];
    const jobs = [job('j2', 'b', '2026-11-09'), job('j1', 'a', '2026-11-08'), job('j3', 'a', '2026-11-10')];
    const tasks = missingPositions(jobs, customers, TODAY);
    expect(tasks.map((t) => t.customerId)).toEqual(['a', 'b', 'z']);
    expect(tasks[0].jobIds).toEqual(['j1', 'j3']);
  });
  it('left out: past, done, cancelled or deleted appointments; customers with a position; no address', () => {
    const customers = [cust('a', '1 rue A, Laval', 45.5), cust('b', null), cust('c', '3 rue C, Laval', null, { deleted_at: 'x' } as Partial<Customer>)];
    const jobs = [
      job('j1', 'a', TODAY),                                   // uses the customer's known position
      job('j2', 'b', TODAY),                                   // no address anywhere
      job('j3', 'x', '2026-11-01', { address: '5 rue E, Laval' }),
      job('j4', 'x', TODAY, { address: '6 rue F, Laval', status: 'done' }),
      job('j5', 'x', TODAY, { address: '7 rue G, Laval', status: 'cancelled' }),
      job('j6', 'x', TODAY, { address: '8 rue H, Laval', deleted_at: 'x' } as Partial<Job>)
    ];
    expect(missingPositions(jobs, customers, TODAY)).toEqual([]);
  });
  it('an appointment somewhere else than home is looked up on its own', () => {
    const customers = [cust('a', '1 rue A, Laval', 45.5)];
    const t = missingPositions([job('j1', 'a', TODAY, { address: '22 rue du Travail, Montréal' })], customers, TODAY);
    expect(t).toEqual([expect.objectContaining({ address: '22 rue du Travail, Montréal', customerId: null, jobIds: ['j1'] })]);
  });
  it('« Chercher » keeps only what was asked', () => {
    const customers = [cust('a', '1 rue A, Laval'), cust('b', '2 rue B, Laval')];
    const jobs = [job('j1', 'a', TODAY), job('j2', 'b', TODAY)];
    expect(missingPositions(jobs, customers, TODAY, { jobs: ['j2'] }).map((t) => t.jobIds)).toEqual([['j2']]);
    expect(missingPositions(jobs, customers, TODAY, { customers: ['a'] }).map((t) => t.customerId)).toEqual(['a']);
  });
  it('where an appointment is', () => {
    const c = cust('a', '1 rue A, Laval', null, { postal_code: 'H7V 1A1', city: 'Laval' });
    expect(jobPlace(job('j', 'a', TODAY), c)).toMatchObject({ address: '1 rue A, Laval', postal: 'H7V 1A1', city: 'Laval', home: true });
    expect(jobPlace(job('j', 'a', TODAY, { address: '1, rue A, LAVAL' }), c).home).toBe(true);
    expect(jobPlace(job('j', 'a', TODAY, { address: '5 rue B' }), c)).toMatchObject({ address: '5 rue B', home: false });
    expect(addrKey(' 144, 58e Avenue — Laval ')).toBe('144 58e avenue laval');
  });
});
