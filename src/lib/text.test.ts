import { describe, it, expect } from 'vitest';
import { phoneDigits, formatPhone, e164, postalCode, findPostal, provinceOfPostal, splitUnit, civicNumber, isCivicRange, isUnitPart, cleanVin, vinCheck, vinYear,
  matches, initials, fold, firstName, fullName, norm, squash, EMAIL_RE } from './text';

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
  // core-data-05: these are street names, not a unit word glued to a unit
  it.each([
    '4500 avenue Appleton', '2100 rue Logan', '4855 avenue Burton', '75 chemin Bureau', '12 rue Unity', '10 rue Localité',
    '55 rue Burnside', '300 rue des Appalaches', '77 rue Logement', '5 rue Burke, Laval', '1234 rue Apple', '60 rue Unité',
    '2100 rue Logan, Montréal, QC H2L 1Y4', '8 rue Suiteville', '9 boul. Appart', '10 rue Apple Hill', '20 boul. Burlington'
  ])('keeps the street « %s » whole', (a) => expect(splitUnit(a)).toEqual({ unit: null, line: a }));
  it.each([
    ['1200 rue Peel bureau 400, Montréal', '400', '1200 rue Peel, Montréal'],
    ['8255 av. Mountain Sights, app. 3', '3', '8255 av. Mountain Sights'],
    ['50 rue Jarry apt 3B', '3B', '50 rue Jarry'],
    ['50 rue Jarry #12', '12', '50 rue Jarry'],
    ['50 rue Jarry, unité A', 'A', '50 rue Jarry'],
    ['50 rue Jarry, unité A, Montréal', 'A', '50 rue Jarry, Montréal'],
    ['50 rue Jarry app3', '3', '50 rue Jarry'],
    ['100 rue Logan app 4', '4', '100 rue Logan'],
    ['100 rue Logan, local PH2', 'PH2', '100 rue Logan'],
    ['100 rue Logan, appartement 12, Laval', '12', '100 rue Logan, Laval'],
    ['3-1250 rue Graham', '3', '1250 rue Graham'],
    ['10 rue Localité, log. 5', '5', '10 rue Localité'],
    ['8255 av. Mountain Sights, unité 4, Montréal', '4', '8255 av. Mountain Sights, Montréal']
  ])('still keeps the unit of « %s »', (a, unit, line) => expect(splitUnit(a)).toEqual({ unit, line }));
  it('a civic range is one building with two doors, not a unit', () => {
    expect(isCivicRange('4521-4523 rue Fabre')).toBe(true);
    expect(isCivicRange('1250-1252 rue Graham')).toBe(true);
    expect(isCivicRange('12-1250 rue Graham')).toBe(false);
    expect(isCivicRange('1234-1290 rue Saint-Denis')).toBe(false);
    expect(splitUnit('4521-4523 rue Fabre')).toEqual({ unit: null, line: '4521-4523 rue Fabre' });
    expect(civicNumber('4521-4523 rue Fabre')).toBe('4521');
    expect(civicNumber('180-8255 av. Mountain Sights')).toBe('8255');
    expect(civicNumber('2100 rue Logan')).toBe('2100');
    expect(splitUnit('12-14 rue Fabre')).toEqual({ unit: null, line: '12-14 rue Fabre' });
    expect(splitUnit('3-5 rue Fabre')).toEqual({ unit: '3', line: '5 rue Fabre' });
  });
  it('an ordinal street is not a door number', () => {
    expect(civicNumber('58e Avenue, Laval')).toBeNull();
    expect(civicNumber('1re rue, Sainte-Anne')).toBeNull();
    expect(civicNumber('3rd Street')).toBeNull();
    expect(civicNumber('144 58e Avenue')).toBe('144');
    expect(civicNumber('1250A rue Graham')).toBe('1250A');
    expect(civicNumber('3-1250 rue Graham')).toBe('1250');
  });
  it('tells a part of the address that is only a unit', () => {
    expect(isUnitPart('app. 3')).toBe(true);
    expect(isUnitPart(' #12 ')).toBe(true);
    expect(isUnitPart('unité A')).toBe(true);
    expect(isUnitPart('Bureau 400')).toBe(true);
    expect(isUnitPart('Appleton')).toBe(false);
    expect(isUnitPart('Localité')).toBe(false);
    expect(isUnitPart('Logan')).toBe(false);
    expect(isUnitPart('Montréal')).toBe(false);
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
    expect(matches('', 'Bob')).toBe(true);
  });
  it('a phone number is found however it is typed', () => {
    expect(matches('514 555 1234', 'Bob', '514 555-1234')).toBe(true);
    expect(matches('(514) 555-1234', 'Bob', '514 555-1234')).toBe(true);
    expect(matches('5145551234', 'Bob', '514 555-1234')).toBe(true);
    expect(matches('bob 1234', 'Bob', '514 555-1234')).toBe(true);
  });
  // core-data-31: the digits of a mixed query no longer answer alone
  it('the words of a mixed query still count', () => {
    expect(matches('tremblay 4243', 'Bob Gagnon', '514 771-4243')).toBe(false);
    expect(matches('gagnon 4243', 'Bob Gagnon', '514 771-4243')).toBe(true);
    expect(matches('h4p 2b5', 'Bob', '514 425-0000')).toBe(false);
    expect(matches('h4p 2b5', 'Bob', '8255 av. Mountain Sights, H4P 2B5')).toBe(true);
  });
  it('digits are never matched across two fields joined together', () => {
    expect(matches('5551', 'Bob 555', '1234')).toBe(false);
  });
  it('initials', () => { expect(initials('Hassan Jeha')).toBe('HJ'); expect(initials('')).toBe('?'); expect(fold('Éric')).toBe('eric'); });
});

describe('names and folded text', () => {
  it('first name, full name, e-mail', () => {
    expect(firstName('  Hassan Jeha ')).toBe('Hassan');
    expect(firstName(null)).toBe('');
    expect(fullName(' Jean ', null)).toBe('Jean');
    expect(fullName('Jean', 'Tremblay')).toBe('Jean Tremblay');
    expect(EMAIL_RE.test('a@b.ca')).toBe(true);
    expect(EMAIL_RE.test('a@b')).toBe(false);
  });
  it('norm drops apostrophes, squash keeps letters and digits', () => {
    expect(norm('O’Neil')).toBe('oneil');
    expect(norm(null)).toBe('');
    expect(squash('H3P 2C9')).toBe('h3p2c9');
    expect(squash('FLT-001')).toBe('flt001');
  });
});
