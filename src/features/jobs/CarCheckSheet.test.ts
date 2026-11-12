import { describe, it, expect } from 'vitest';
import { carErrors } from './CarCheckSheet';

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
