import { describe, it, expect } from 'vitest';
import { findVin, vinScore } from './vinScan';
import { vinCheck } from '../../lib/text';

describe('reading a VIN in the text of a photo', () => {
  it('finds a clean VIN in the middle of other words', () => {
    expect(findVin('VEHICLE IDENTIFICATION\nVIN 1HGCM82633A004352\nMADE IN USA')).toEqual({ vin: '1HGCM82633A004352', ok: true });
  });
  it('fixes the letters a VIN never has (O, Q, I) and a VIN cut by spaces', () => {
    expect(findVin('1HGCM826 33AOO4352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(findVin('2T1BURHE 0JC0I2345')?.vin.length).toBe(17);
  });
  it('repairs look-alike letters with the check digit (Z for 2, S for 5)', () => {
    expect(findVin('1HGCM8Z633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(findVin('1HGCM82633A0043S2')).toEqual({ vin: '1HGCM82633A004352', ok: true });
  });
  it('keeps a reading whose check digit does not match as doubtful', () => {
    const r = findVin('WVWZZZ1JZXW000001');
    expect(r?.vin).toBe('WVWZZZ1JZXW000001');
    expect(r?.ok).toBe(vinCheck('WVWZZZ1JZXW000001') === 'ok');
  });
  it('finds nothing without 17 characters in a row', () => {
    expect(findVin('TOTAL 45,67 $\nMERCI')).toBeNull();
    expect(findVin('')).toBeNull();
  });
  it('a real VIN scores higher than a random line of 17 characters', () => {
    expect(vinScore('1HGCM82633A004352')).toBeGreaterThan(vinScore('ABCDEFGHJKLMNPRST'));
  });
});
