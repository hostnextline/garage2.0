/* The background locator (src/shared/customers/locator.ts) with TomTom's key: a customer and their appointment saved
   without a position, TomTom knowing only the street. The real locator, lookup and search; the phone's data, the saves
   and the two map services pretended (review F1). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signal } from '@preact/signals';
import type { Customer, Job } from '../../data/types';

const env = vi.hoisted(() => ({ key: 'KEY' }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), get TOMTOM_KEY() { return env.key; } }));
const data = vi.hoisted(() => ({ jobs: [] as unknown[], customers: [] as unknown[] }));
vi.mock('../../data/select', async (orig) => {
  const { signal: sig } = await import('@preact/signals');
  return { ...(await orig<typeof import('../../data/select')>()), allJobs: sig(data.jobs), customersList: sig(data.customers) };
});
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), saveCustomer: vi.fn(async () => 'c1'), updateJob: vi.fn(async () => undefined) }));
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<typeof import('../../data/auth')>()), preview: signal(false) }));

import { today } from '../../lib/dates';
import * as api from '../../data/api';
import { forgetPlaces } from './places';

const TT_STREET = { results: [{ type: 'Street', address: { streetName: 'Avenue Mountain Sights', municipality: 'Montréal', neighbourhood: 'Snowdon', countrySubdivisionCode: 'QC', postalCode: 'H4P', countryCode: 'CA' }, position: { lat: 45.4974127, lon: -73.6538718 } }] };
const PH_8200 = { features: [{ geometry: { coordinates: [-73.6577, 45.5005] }, properties: { housenumber: '8200', street: 'Avenue Mountain Sights', city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H4P 2B5', osm_key: 'building', type: 'house' } }] };

afterEach(() => { vi.unstubAllGlobals(); forgetPlaces(); });

describe('the background locator, TomTom knowing only the street', () => {
  it('finds Photon’s door and saves it on the customer and the appointment', async () => {
    data.customers.push({ id: 'c1', address: '8200 av. Mountain Sights, Montréal', lat: null, lng: null, postal_code: null, city: 'Montréal', deleted_at: null } as unknown as Customer);
    data.jobs.push({ id: 'j1', number: 1, customer_id: 'c1', day: today(), status: 'booked', address: null, lat: null, lng: null, postal_code: null, deleted_at: null } as unknown as Job);
    const hosts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const tt = new URL(url).hostname === 'api.tomtom.com';
      hosts.push(tt ? 'tomtom' : 'photon');
      return { ok: true, status: 200, json: async () => (tt ? TT_STREET : PH_8200) };
    }));
    const { locateMissing } = await import('../customers/locator');
    const run = await locateMissing({ force: true });
    expect(run).toMatchObject({ found: 1, missing: 0, offline: false });
    expect(api.saveCustomer).toHaveBeenCalledWith({ id: 'c1', lat: 45.5005, lng: -73.6577 });
    expect(api.updateJob).toHaveBeenCalledWith('j1', { lat: 45.5005, lng: -73.6577 });
    expect(hosts).toEqual(['tomtom', 'photon']);
  });
});

/* Photon down while TomTom works (review-places R6, the locator's half): TomTom's answer is only a street, Photon (needed
   for the door) answers 503. « Not now » is not « no network »: the round goes on to the next address, and none is marked
   as tried (asked again at the next round, not in 6 hours). */
describe('the background locator while Photon is down and TomTom answers (review-places R6)', () => {
  const PH_DOOR = (n: string) => ({ features: [{ geometry: { coordinates: [-73.6577, 45.5005 + (n === '8210' ? 0.001 : 0)] }, properties: { housenumber: n, street: 'Avenue Mountain Sights', city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H4P 2B5', osm_key: 'building', type: 'house' } }] });
  it('goes on to the next address, marks neither as tried, and the next round finds both', async () => {
    data.customers.length = 0;
    data.jobs.length = 0;
    localStorage.removeItem('his.locate.tried');
    vi.mocked(api.saveCustomer).mockClear();
    data.customers.push({ id: 'c2', address: '8200 av. Mountain Sights, Montréal', lat: null, lng: null, postal_code: null, city: 'Montréal', deleted_at: null } as unknown as Customer);
    data.customers.push({ id: 'c3', address: '8210 av. Mountain Sights, Montréal', lat: null, lng: null, postal_code: null, city: 'Montréal', deleted_at: null } as unknown as Customer);
    let photonUp = false;
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url);
      const tt = u.hostname === 'api.tomtom.com';
      const q = decodeURIComponent(tt ? u.pathname : u.searchParams.get('q') || '');
      const door = q.includes('8210') ? '8210' : '8200';
      asked.push(`${tt ? 'tomtom' : 'photon'} ${door}`);
      if (tt) return { ok: true, status: 200, json: async () => TT_STREET };
      if (!photonUp) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => PH_DOOR(door) };
    }));
    const { locateMissing } = await import('../customers/locator');
    const first = await locateMissing();                               // a background round: not « force »
    expect(first).toMatchObject({ found: 0, offline: false });
    expect(asked.some((a) => a.endsWith('8210'))).toBe(true);          // the round did not stop at the first address
    expect(Object.keys(JSON.parse(localStorage.getItem('his.locate.tried') || '{}'))).toEqual([]);
    expect(api.saveCustomer).not.toHaveBeenCalled();
    photonUp = true;
    const second = await locateMissing();                              // the next round (not forced) asks them again
    expect(second).toMatchObject({ found: 2, offline: false });
    expect(api.saveCustomer).toHaveBeenCalledWith({ id: 'c2', lat: 45.5005, lng: -73.6577 });
    expect(api.saveCustomer).toHaveBeenCalledWith({ id: 'c3', lat: 45.5015, lng: -73.6577 });
  }, 20_000);
});
