/* What « La voiture » / « Le NIV de l’auto » sends (jobs-a-38: saveCar had no test): the job's car, the VIN on the right
   car, the visit's km. The server and the toasts are pretended. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  updateJob: vi.fn((..._a: unknown[]) => Promise.resolve()),
  saveVehicle: vi.fn((v: { id?: string }) => Promise.resolve(v.id || 'new-car'))
}));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));

import { upsertLocal, clearAll } from '../../data/store';
import type { Job, Vehicle } from '../../data/types';
import { saveCar } from './CarCheckSheet';
import { vinSkips } from './vinStep';

const VIN = '2HGFC2F59KH512345';   // a 2019 (K)
const JOB = (o: Partial<Job> = {}) => ({ id: 'j1', status: 'on_site', customer_id: 'c1', vehicle_id: null, odometer_km: null, ...o } as unknown as Job);
const CAR = (o: Partial<Vehicle> = {}) => ({ id: 'v1', customer_id: 'c1', vin: null, year: 2019, make: 'Honda', model: 'Civic', deleted_at: null, ...o } as unknown as Vehicle);
beforeEach(() => { clearAll(); api.updateJob.mockClear(); api.saveVehicle.mockClear(); });

describe('saveCar', () => {
  it('a car of the customer picked: it becomes the job’s car', async () => {
    await saveCar(JOB(), null, { km: null, vin: null, pick: 'v2' });
    expect(api.updateJob).toHaveBeenCalledWith('j1', { vehicle_id: 'v2' });
    expect(api.saveVehicle).not.toHaveBeenCalled();
  });
  it('the VIN on the job’s car that has none (only what the file does not say is filled from the VIN)', async () => {
    const car = CAR();
    await saveCar(JOB({ vehicle_id: 'v1' }), car, { km: 91350, vin: VIN, decoded: { make: 'Honda', engine: '2.0 L' } });
    expect(api.saveVehicle).toHaveBeenCalledWith({ engine: '2.0 L', id: 'v1', vin: VIN });
    expect(api.updateJob).toHaveBeenCalledWith('j1', { odometer_km: 91350 });
  });
  it('a job with no car: the customer’s only car without VIN that fits takes it (no second file of the same car)', async () => {
    upsertLocal('vehicles', [CAR()]);
    await saveCar(JOB(), null, { km: null, vin: VIN });
    expect(api.saveVehicle).toHaveBeenCalledWith({ id: 'v1', vin: VIN });
    expect(api.updateJob).toHaveBeenCalledWith('j1', { vehicle_id: 'v1' });
  });
  it('a VIN another car of the customer already has: that car becomes the job’s, nothing is written on the cars', async () => {
    upsertLocal('vehicles', [CAR({ id: 'v3', vin: VIN })]);
    await saveCar(JOB({ vehicle_id: 'v1' }), CAR(), { km: null, vin: VIN });
    expect(api.saveVehicle).not.toHaveBeenCalled();
    expect(api.updateJob).toHaveBeenCalledWith('j1', { vehicle_id: 'v3' });
  });
  it('no car fits: a new car is made from the VIN for the customer', async () => {
    await saveCar(JOB(), null, { km: null, vin: VIN, decoded: { year: 2019, make: 'Honda' } });
    expect(api.saveVehicle).toHaveBeenCalledWith({ year: 2019, make: 'Honda', customer_id: 'c1', vin: VIN });
    expect(api.updateJob).toHaveBeenCalledWith('j1', { vehicle_id: 'new-car' });
  });
  it('the same km as already noted: nothing sent; « NIV illisible »: remembered on this phone only', async () => {
    await saveCar(JOB({ odometer_km: 1000 }), CAR({ vin: VIN }), { km: 1000, vin: null });
    expect(api.updateJob).not.toHaveBeenCalled();
    await saveCar(JOB({ id: 'j9' }), null, { km: null, vin: null, skip: true });
    expect(vinSkips.value).toContain('j9');
    expect(api.updateJob).not.toHaveBeenCalled();
  });
});
