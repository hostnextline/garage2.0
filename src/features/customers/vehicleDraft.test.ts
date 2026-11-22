import { describe, it, expect } from 'vitest';
import { draftOf, patchOf, diffOf, specLinkPatch, vinFill, decodedDraft } from './vehicleDraft';
import type { Vehicle } from '../../data/types';

const car = (o: Partial<Vehicle> = {}) => ({ id: 'v1', customer_id: 'c1', year: 2019, make: 'Honda', model: 'Civic', trim: null, engine: null, displacement: null, cylinders: null,
  fuel: null, drive: null, vin: null, plate: null, odometer_km: null, color: null, tire_size: null, notes: null, last_oil_on: null, spec_key: null, ...o }) as unknown as Vehicle;

describe('the car’s edit sheet', () => {
  it('a draft saved untouched changes nothing; plate and tires in capitals', () => {
    const v = car({ displacement: 2, plate: 'fhx 4821' });
    expect(diffOf(patchOf(draftOf(v)), patchOf(draftOf(v)))).toEqual({});
    expect(patchOf({ ...draftOf(v), plate: ' fhx  4821 ', tire_size: '225/45r17' })).toMatchObject({ plate: 'FHX 4821', tire_size: '225/45R17' });
  });
  it('a last oil change in the future is not kept', () => {
    expect(patchOf({ ...draftOf(car()), lastOil: '2099-01-01' }, '2026-11-15').last_oil_on).toBeNull();
  });
});

describe('the « Fiche technique » link (customers-b-14)', () => {
  const linked = car({ spec_key: 'honda|civic|2019' });
  it('learning the displacement of the same car keeps the sheet', () => {
    expect(specLinkPatch(linked, { displacement: 2 })).toEqual({});
  });
  it('another model, year, or another displacement than the known one unlinks it', () => {
    expect(specLinkPatch(linked, { model: 'Accord' })).toEqual({ spec_key: null });
    expect(specLinkPatch(linked, { year: 2020 })).toEqual({ spec_key: null });
    expect(specLinkPatch(car({ spec_key: 'honda|civic|2019|2.0', displacement: 2 }), { displacement: 1.5 })).toEqual({ spec_key: null });
    // a car whose displacement was learned after its sheet was linked still unlinks when its model changes
    expect(specLinkPatch(car({ spec_key: 'honda|civic|2019', displacement: 2 }), { model: 'Accord' })).toEqual({ spec_key: null });
  });
  it('nothing to do without a linked sheet', () => {
    expect(specLinkPatch(car(), { model: 'Accord' })).toEqual({});
  });
});

describe('a VIN reading', () => {
  it('fills only what the car does not say yet (customers-b-10)', () => {
    expect(vinFill(car({ trim: 'LX' }), { year: 2020, make: 'Honda', trim: 'EX', fuel: 'essence' })).toEqual({ fuel: 'essence' });
  });
  it('in the edit sheet, only the fields the reading gave (customers-b-12)', () => {
    expect(decodedDraft({ make: 'Honda', displacement: 2 })).toEqual({ make: 'Honda', displacement: '2.0' });
  });
});
