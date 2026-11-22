import { describe, it, expect } from 'vitest';
import { findVin, vinScore, vinFromCode } from './vinRead';
import { vinCheck } from '../../lib/text';

describe('reading a VIN in the text of a photo', () => {
  it('finds a clean VIN in the middle of other words', () => {
    expect(findVin('VEHICLE IDENTIFICATION\nVIN 1HGCM82633A004352\nMADE IN USA')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(findVin('VIN: 1HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
  });
  it('fixes the letters a VIN never has (O, Q, I) and a VIN cut by spaces', () => {
    expect(findVin('1HGCM826 33AOO4352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(findVin('NIV 1HGCM826 33A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(findVin('2T1BURHE 0JC0I2345')?.vin.length).toBe(17);
  });
  // these two were « repaired » and returned as sure: now a repair is only offered, to compare with the plate
  it('a look-alike letter repaired with the check digit is only doubtful (customers-b-01)', () => {
    expect(findVin('1HGCM8Z633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: false, why: 'repaired' });
    expect(findVin('1HGCM82633A0043S2')?.ok).toBe(false);
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
  it('a receipt or a registration without a VIN gives no sure VIN', () => {
    expect(findVin('0 TOTAL 114.98\nMERCI ET BONNE JOURNEE')?.ok ?? false).toBe(false);
    expect(findVin('HONDA CIVIC 2019 4 CYL / MASSE 1250\nPROPRIETAIRE TREMBLAY')?.ok ?? false).toBe(false);
  });
  it('two different VINs that both pass: doubtful', () => {
    expect(findVin('1HGCM82633A004352\n11111111111111111')).toMatchObject({ ok: false, why: 'several' });
  });
  it('a real VIN scores higher than a random line of 17 characters', () => {
    expect(vinScore('1HGCM82633A004352')).toBeGreaterThan(vinScore('ABCDEFGHJKLMNPRST'));
  });
});

/* noise: N valid VINs, read with one or two characters wrong, alone or between label lines (seeded, so the same every run) */
describe('a misread VIN is never returned as sure (customers-b-01)', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const LEGAL = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  const LOOK: Record<string, string> = { '0': 'D', D: '0', '1': 'L', L: '1', T: '7', '7': 'T', '5': 'S', S: '5', '8': 'B', B: '8', '2': 'Z', Z: '2', '6': 'G', G: '6', U: 'V', V: 'U' };
  const valid = (): string => {
    for (;;) {
      const s = Array.from({ length: 17 }, () => LEGAL[Math.floor(rand() * LEGAL.length)]);
      for (const c of '0123456789X') { s[8] = c; if (vinCheck(s.join('')) === 'ok') return s.join(''); }
    }
  };
  const misread = (v: string, n: number, lookAlike: boolean): string => {
    const s = v.split('');
    for (let k = 0; k < n;) {
      const i = Math.floor(rand() * 17);
      const next = lookAlike ? LOOK[s[i]] : LEGAL[Math.floor(rand() * LEGAL.length)];
      if (next && next !== s[i]) { s[i] = next; k++; }
    }
    return s.join('');
  };
  const vins = Array.from({ length: 40 }, valid);
  // (a misread that keeps the check sum, « A » read for « 1 », is a valid VIN as read: no reader can tell; every
  // other misread must never come back sure)
  it.each([[1, true], [1, false], [2, true], [2, false]] as const)('%i character(s) misread (look-alike: %s): never a different VIN marked sure', (n, look) => {
    let wrong = 0;
    for (const v of vins) for (let k = 0; k < 10; k++) {
      const read = misread(v, n, look);
      if (vinCheck(read) === 'ok') continue;
      for (const text of [read, `CERTIFICAT D'IMMATRICULATION\nNIV ${read}\nMASSE 1350 KG`]) {
        const r = findVin(text);
        if (r?.ok && r.vin !== v) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });
  it('two characters misread: no more wrong sure VINs than the check digit’s own chance (1 in 11)', () => {
    let wrong = 0, total = 0;
    for (const v of vins) for (let k = 0; k < 10; k++) { total++; const r = findVin(misread(v, 2, false)); if (r?.ok && r.vin !== v) wrong++; }
    expect(wrong / total).toBeLessThan(0.15);
  });
  it('a clean VIN stays sure: alone, among words, cut by one space', () => {
    for (const v of vins) {
      expect(findVin(v)).toEqual({ vin: v, ok: true });
      expect(findVin(`VIN ${v}\nMADE IN CANADA`)).toEqual({ vin: v, ok: true });
      expect(findVin(`${v.slice(0, 8)} ${v.slice(8)}`)).toEqual({ vin: v, ok: true });
    }
  });
});

describe('VIN from a barcode (customers-b-02)', () => {
  it('a field of exactly 17 characters, or 18 with the extra « I »', () => {
    expect(vinFromCode('1HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(vinFromCode('I1HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(vinFromCode('VIN:1HGCM82633A004352;2019')).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(vinFromCode('1HGCM82643A004352')).toEqual({ vin: '1HGCM82643A004352', ok: false });
    expect(vinFromCode('12345')).toBeNull();
  });
  it('a VIN glued inside a longer code is never sure', () => {
    expect(vinFromCode('ABC1231HGCM82633A004352')).toEqual({ vin: '1HGCM82633A004352', ok: false });
  });
  it('a long code with no VIN in it is not taken as one', () => {
    let seed = 3;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
    let sure = 0;
    for (let k = 0; k < 300; k++) {
      const code = Array.from({ length: 48 }, () => chars[Math.floor(rand() * chars.length)]).join('');
      if (vinFromCode(code)?.ok) sure++;
    }
    expect(sure).toBe(0);
  });
});
