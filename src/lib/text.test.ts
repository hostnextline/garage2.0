import { describe, it, expect } from 'vitest';
import { phoneDigits, formatPhone, e164, postalCode, findPostal, provinceOfPostal, splitUnit, civicNumber, cleanVin, vinCheck, vinYear, matches, initials, fold } from './text';

describe('phone numbers', () => {
  it.each([['514-771-4243', '5147714243'], ['+1 (438) 901-6606', '4389016606'], ['1 438 901 6606', '4389016606'], ['438.901.6606', '4389016606']])('%s', (a, b) => expect(phoneDigits(a)).toBe(b));
  it('refuses short or impossible numbers', () => {
    expect(phoneDigits('901-6606')).toBeNull();
    expect(phoneDigits('014 555 1234')).toBeNull();
  });
  it('writes them the Québec way and for texting', () => {
    expect(formatPhone('4389016606')).toBe('438 901-6606');
    expect(e164('438 901-6606')).toBe('+14389016606');
  });
});

describe('postal codes and addresses', () => {
  it('cleans postal codes', () => {
    expect(postalCode('h4p2b5')).toBe('H4P 2B5');
    expect(postalCode('H4P-2B5')).toBe('H4P 2B5');
    expect(postalCode('D4P 2B5')).toBeNull();
    expect(findPostal('180-8255 av. Mountain Sights, Montréal, QC H4P 2B5')).toBe('H4P 2B5');
    expect(provinceOfPostal('H4P 2B5')).toBe('QC');
    expect(provinceOfPostal('K1A 0B1')).toBe('ON');
  });
  it('keeps the apartment or office number', () => {
    expect(splitUnit('180-8255 av. Mountain Sights')).toEqual({ unit: '180', line: '8255 av. Mountain Sights' });
    expect(splitUnit('8255 av. Mountain Sights, app. 3')).toEqual({ unit: '3', line: '8255 av. Mountain Sights' });
    expect(splitUnit('1200 rue Peel bureau 400, Montréal')).toEqual({ unit: '400', line: '1200 rue Peel, Montréal' });
    expect(splitUnit('8255 av. Mountain Sights')).toEqual({ unit: null, line: '8255 av. Mountain Sights' });
    expect(civicNumber('180-8255 av. Mountain Sights')).toBe('8255');
    expect(civicNumber('av. Mountain Sights')).toBeNull();
  });
});

describe('VIN', () => {
  it('cleans common misreads', () => expect(cleanVin('1hgcm82633a0O4352 ')).toBe('1HGCM82633A004352'));
  it('checks the control digit', () => {
    expect(vinCheck('1HGCM82633A004352')).toBe('ok');
    expect(vinCheck('1M8GDM9AXKP042788')).toBe('ok');
    expect(vinCheck('1HGCM82643A004352')).toBe('bad');
    expect(vinCheck('1HGCM826')).toBe('invalid');
  });
  it('reads the model year', () => {
    expect(vinYear('1HGCM82633A004352')).toBe(2003);
    expect(vinYear('2HGFC2F59LH000000')).toBe(2020);
  });
});

describe('search', () => {
  it('ignores accents and order', () => {
    expect(matches('jean tremblay', 'Jean-Marc Trémblay')).toBe(true);
    expect(matches('montreal', '8255 Mountain Sights, Montréal')).toBe(true);
    expect(matches('5551', 'Bob', '514 555-1234')).toBe(true);
    expect(matches('xyz', 'Bob')).toBe(false);
  });
  it('initials', () => { expect(initials('Hassan Jeha')).toBe('HJ'); expect(initials('')).toBe('?'); expect(fold('Éric')).toBe('eric'); });
});
