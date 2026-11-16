import { describe, it, expect, afterEach } from 'vitest';
import { upsertLocal, clearAll } from '../../data/store';
import { dayOf } from './deviceDay';
import { placeNewStop } from './preview';

afterEach(() => clearAll());

describe('a day of the team from the phone’s copy', () => {
  // booking-b-19: « Voir sur la carte » with no vehicle said put the new stop on the vehicle where it adds the least,
  // switched off ones included (« Arrêt 1 sur 1 » of a vehicle nobody drives)
  it('a vehicle switched off that holds nothing that day is not in it; the new stop never goes there', () => {
    upsertLocal('settings', [{ id: '1', booking: { home: { label: 'Centrale', lat: 45.53, lng: -73.65 } } }], { force: true });
    upsertLocal('trucks', [
      { id: 'ON', name: 'Camion', active: true, sort: 0, start: { lat: 45.40, lng: -73.90, label: 'Loin', address: '' } },
      { id: 'OFF', name: 'Vieux', active: false, sort: 1, start: { lat: 45.60, lng: -73.55, label: 'Près', address: '' } }
    ], { force: true });
    const d = dayOf('2026-11-20');
    expect(d.trucks.map((x) => x.id)).toEqual(['ON']);
    expect(placeNewStop(d, { day: '2026-11-20', block: 'am', truckId: null, lat: 45.6, lng: -73.55, name: '', address: '' }).truckId).toBe('ON');
  });
  it('one switched off that still holds an appointment that day stays (its stop is drawn); the one moved is left out', () => {
    upsertLocal('trucks', [{ id: 'OFF', name: 'Vieux', active: false, sort: 1 }], { force: true });
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira' }], { force: true });
    upsertLocal('jobs', [
      { id: 'J1', customer_id: 'C1', day: '2026-11-20', block: 'am', status: 'booked', truck_id: 'OFF', duration_min: 60, number: 1 },
      { id: 'J2', customer_id: 'C1', day: '2026-11-20', block: 'pm', status: 'booked', truck_id: 'OFF', duration_min: 60, number: 2 }
    ], { force: true });
    const d = dayOf('2026-11-20', 'J2');
    expect(d.trucks.map((x) => x.id)).toEqual(['OFF']);
    expect(d.jobs.map((j) => j.id)).toEqual(['J1']);
  });
});
