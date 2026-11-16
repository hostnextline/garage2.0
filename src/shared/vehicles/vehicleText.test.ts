import { describe, it, expect } from 'vitest';
import { vinFromCode, km, parseKm } from './vehicleText';

describe('VIN from a barcode, kilometres', () => {
  it('finds the VIN in what the camera read', () => {
    expect(vinFromCode('1HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(vinFromCode('I1HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(vinFromCode('VIN:1HGCM82633A004352;2019')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(vinFromCode('1HGCM82643A004352')).toEqual({ vin: '1HGCM82643A004352', ok: false });
    expect(vinFromCode('12345')).toBeNull();
  });
  it('kilometres', () => {
    expect(km(84200, 'fr').replace(/\s/g, ' ')).toBe('84 200 km');
    expect(km(84200, 'en')).toBe('84,200 km');
    expect(parseKm('84 200')).toBe(84200);
    expect(parseKm('84,200 km')).toBe(84200);
    expect(parseKm('')).toBeNull();
    expect(Number.isNaN(parseKm('beaucoup'))).toBe(true);
  });
});
