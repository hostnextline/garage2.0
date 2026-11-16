import { describe, it, expect } from 'vitest';
import { vinNeeded, carsWithVin, vinPlan } from './vin';

describe('« Le NIV de l’auto » before the work starts', () => {
  const VIN = '1HGCM82633A004352';
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
    // a job with no car: the customer's only car without VIN is this one (jobs-a-06: before, a second file was made)
    expect(vinPlan('JM1BK32F781234567', null, cars)).toEqual({ kind: 'adopt', id: 'v1' });
    expect(vinPlan('JM1BK32F781234567', null, [cars[1]])).toEqual({ kind: 'new' });
    expect(vinPlan(VIN, null, cars)).toEqual({ kind: 'link', id: 'v2' });
    expect(vinPlan(VIN, cars[1], cars)).toEqual({ kind: 'none' });
    expect(vinPlan('JM1BK32F781234567', cars[1], cars)).toEqual({ kind: 'none' });
  });
});

describe('a VIN scanned on a job with no car does not make a second file of the same car (jobs-a-06)', () => {
  const VIN = '1HGCM82633A004352';   // a 2003 (its 10th character)
  it('the customer’s car without VIN that is this one takes the VIN', () => {
    const cars = [{ id: 'golf', vin: null, year: 2003, make: 'Volkswagen', model: 'Golf' }];
    expect(vinPlan(VIN, null, cars)).toEqual({ kind: 'adopt', id: 'golf' });
    expect(vinPlan(VIN, null, cars, { year: 2003, make: 'volkswagen', model: 'GOLF' })).toEqual({ kind: 'adopt', id: 'golf' });
  });
  it('a car that says otherwise (another year, another make) is not taken: a new car', () => {
    expect(vinPlan(VIN, null, [{ id: 'old', vin: null, year: 1998 }])).toEqual({ kind: 'new' });
    expect(vinPlan(VIN, null, [{ id: 'mazda', vin: null, make: 'Mazda' }], { make: 'Honda' })).toEqual({ kind: 'new' });
  });
  it('two cars without VIN that could both be it: nothing is guessed (a new car, as before)', () => {
    expect(vinPlan(VIN, null, [{ id: 'a', vin: null }, { id: 'b', vin: null }])).toEqual({ kind: 'new' });
    // the details tell them apart
    expect(vinPlan(VIN, null, [{ id: 'a', vin: null, make: 'Honda' }, { id: 'b', vin: null, make: 'Mazda' }], { make: 'Honda' })).toEqual({ kind: 'adopt', id: 'a' });
  });
  it('a deleted car is never taken', () => {
    expect(vinPlan(VIN, null, [{ id: 'gone', vin: null, deleted_at: 'x' }])).toEqual({ kind: 'new' });
  });
});
