import { describe, it, expect } from 'vitest';
import { carErrors, carRow, carIsEmpty, yearOk, withChoice, withMode, EMPTY_CAR, type AddDraft } from './carDraft';
import { typedVin, vinState, vinSavable } from './vin';
import { lang } from '../../lib/i18n';

lang.value = 'fr';
const civic: AddDraft = { year: '2019', make: 'Honda', model: 'Civic', vin: '', extra: {} };

describe('the car form’s rules', () => {
  it('a year the database takes', () => {
    expect(yearOk('2019')).toBe(true);
    expect(yearOk('1949')).toBe(false);
    expect(yearOk('19')).toBe(false);
    expect(yearOk(String(new Date().getFullYear() + 3))).toBe(false);
  });
  it('empty, and what is wrong', () => {
    expect(carIsEmpty(EMPTY_CAR)).toBe(true);
    expect(carIsEmpty({ ...EMPTY_CAR, vin: '1HG' })).toBe(false);
    expect(carErrors({ ...EMPTY_CAR, make: 'Honda' }, 'ymm').model).toBeTruthy();
    expect(carErrors({ ...EMPTY_CAR, vin: '1HGCM' }, 'vin').vin).toBeTruthy();
    expect(carErrors(EMPTY_CAR, 'vin').vin).toBeTruthy();
    expect(carErrors(civic, 'ymm')).toEqual({ year: null, model: null, vin: null });
  });
  it('the row saved', () => {
    expect(carRow({ ...civic, extra: { trim: 'LX' }, lastOil: '2020-01-01' }, 'C1')).toEqual({ trim: 'LX', customer_id: 'C1', year: 2019, make: 'Honda', model: 'Civic', vin: null, last_oil_on: '2020-01-01' });
    expect(carRow({ ...civic, lastOil: '2999-01-01' }, 'C1')).not.toHaveProperty('last_oil_on');
  });
});

describe('a VIN typed then left behind is not sent (customers-b-07)', () => {
  it('going back to « Année, marque, modèle » takes the VIN and its decoding out; year, make, model stay', () => {
    const d: AddDraft = { ...civic, vin: '1HGCM', extra: { trim: 'EX', engine: '2.0 L' } };
    const after = { ...d, ...withMode(d, 'ymm') };
    expect(carRow(after, 'C1')).toMatchObject({ vin: null, make: 'Honda', model: 'Civic' });
    expect(carRow(after, 'C1')).not.toHaveProperty('trim');
    expect(withMode(d, 'vin')).toBeNull();
    expect(withMode(civic, 'ymm')).toBeNull();
  });
});

describe('another model chosen drops the first engine (customers-b-13)', () => {
  const withEngine: AddDraft = { ...civic, extra: { engine: '1.5 L 4 cyl. turbo (L15B7)', displacement: 1.5, fuel: 'essence', cylinders: 4 } };
  it('another model without an engine: no engine', () => {
    expect(withChoice(withEngine, { year: '2019', make: 'Honda', model: 'Accord', engine: null })).toEqual({ year: '2019', make: 'Honda', model: 'Accord', extra: {} });
  });
  it('another model with its engine: only the new engine', () => {
    const e = { displacement: 2, cylinders: 4, fuel: 'essence', engine: '2.0 L 4 cyl. turbo' };
    expect(withChoice(withEngine, { year: '2019', make: 'Honda', model: 'Accord', engine: e }).extra).toEqual(e);
  });
  it('the same car (another year, or the engine step skipped): the engine stays', () => {
    expect(withChoice(withEngine, { year: '2020', make: 'Honda', model: 'Civic' }).extra).toEqual(withEngine.extra);
  });
});

describe('the VIN box', () => {
  it('what it says', () => {
    expect(vinState('')).toBe('empty');
    expect(vinState('1HGCM82633A004352')).toBe('ok');
    expect(vinState('1HGCM82643A004352')).toBe('bad');
    expect(vinState('1HGCM826334')).toBe('old');
    expect(vinState('1HG')).toBe('short');
    expect(vinSavable('1HG')).toBe(false);
    expect(vinSavable('')).toBe(true);
  });
  it('what it keeps: cut at 17, never searched (customers-b-02)', () => {
    expect(typedVin('1hgcm82633a004352')).toBe('1HGCM82633A004352');
    // an 18th character typed by mistake: cut, never a shifted VIN shown valid
    expect(typedVin('21HGCM82633A004352')).toBe('21HGCM82633A00435');
    // the door-jamb « I » loses itself, not the last character
    expect(typedVin('I1HGCM82633A004352')).toBe('1HGCM82633A004352');
    expect(typedVin('VIN: 1HGCM82633A004352')).toBe('1HGCM82633A004352');
    expect(typedVin('1HGCM 826')).toBe('1HGCM826');
    expect(typedVin('1HGOQ')).toBe('1HG01');
  });
});
