import { describe, it, expect } from 'vitest';
import { carErrors, vinPlan } from './CarCheckSheet';
import { vinNeeded, carsWithVin } from './vinStep';

describe('« La voiture » at arrival: what it accepts', () => {
  it('needs the km or the VIN', () => expect(carErrors({ km: '', vin: '' }).empty).toBe(true));
  it('takes a km written the person’s way', () => {
    expect(carErrors({ km: '91 350', vin: '' })).toEqual({ km: null, vin: null, empty: false });
    expect(carErrors({ km: '91,350 km', vin: '' }).km).toBeNull();
  });
  it('refuses a km that is not a number or too big', () => {
    expect(carErrors({ km: 'abc', vin: '' }).km).not.toBeNull();
    expect(carErrors({ km: '4000000', vin: '' }).km).not.toBeNull();
  });
  it('takes a VIN alone, refuses a VIN too short', () => {
    expect(carErrors({ km: '', vin: '1HGCM82633A004352' })).toEqual({ km: null, vin: null, empty: false });
    expect(carErrors({ km: '', vin: '1HGCM8' }).vin).not.toBeNull();
  });
});

describe('« Le NIV de l’auto » before the work starts', () => {
  const VIN = '1HGCM82633A004352';
  it('the sheet needs the VIN itself (a km alone is not enough)', () => {
    expect(carErrors({ km: '91 350', vin: '' }, true).empty).toBe(true);
    expect(carErrors({ km: '', vin: VIN }, true)).toEqual({ km: null, vin: null, empty: false });
  });
  it('needed once on site, for a job with no car or a car without VIN; not after « NIV illisible »', () => {
    const j = { id: 'j1', status: 'on_site' as const, vehicle_id: 'v1' };
    expect(vinNeeded(j, { vin: null }, [])).toBe(true);
    expect(vinNeeded({ ...j, vehicle_id: null }, null, [])).toBe(true);
    expect(vinNeeded(j, { vin: VIN, deleted_at: '2026-11-01' }, [])).toBe(true);
    expect(vinNeeded(j, { vin: VIN }, [])).toBe(false);
    expect(vinNeeded(j, { vin: null }, ['j1'])).toBe(false);
    for (const status of ['booked', 'en_route', 'done', 'cancelled', 'no_show'] as const) expect(vinNeeded({ ...j, status }, { vin: null }, [])).toBe(false);
  });
  it('the cars to pick: the customer’s other cars that have a VIN', () => {
    const cars = [{ id: 'v1', vin: null }, { id: 'v2', vin: VIN }, { id: 'v3', vin: 'JM1BK32F781234567', deleted_at: '2026-11-01' }, { id: 'v4', vin: '2HGFC2F59KH512345' }];
    expect(carsWithVin(cars, 'v1').map((c) => c.id)).toEqual(['v2', 'v4']);
    expect(carsWithVin(cars, 'v2').map((c) => c.id)).toEqual(['v4']);
  });
  it('a VIN given: the customer’s car that has it becomes the job’s car; else it goes on the job’s car; else a new car', () => {
    const cars = [{ id: 'v1', vin: null }, { id: 'v2', vin: VIN }];
    expect(vinPlan(VIN.toLowerCase(), cars[0], cars)).toEqual({ kind: 'link', id: 'v2' });
    expect(vinPlan('JM1BK32F781234567', cars[0], cars)).toEqual({ kind: 'set', id: 'v1' });
    expect(vinPlan('JM1BK32F781234567', null, cars)).toEqual({ kind: 'new' });
    expect(vinPlan(VIN, null, cars)).toEqual({ kind: 'link', id: 'v2' });
    expect(vinPlan(VIN, cars[1], cars)).toEqual({ kind: 'none' });
    expect(vinPlan('JM1BK32F781234567', cars[1], cars)).toEqual({ kind: 'none' });
  });
});
