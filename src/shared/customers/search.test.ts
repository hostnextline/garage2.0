import { describe, it, expect } from 'vitest';
import { searchDoc, docMatches, rank, searchList, draftFromQuery, isNumberQuery, cap } from './search';

const julie = { first_name: 'Julie', last_name: 'Tremblay', company: null, phone: '514 555-0141', email: 'julie.t@example.com', address: '1250 rue Graham, Mont-Royal, QC', unit: null, city: 'Mont-Royal', postal_code: 'H3P 2C9' };
const emilie = { first_name: 'Émilie', last_name: 'Côté', company: null, phone: '(514) 555-0125', email: null, address: '700 rue Lebeau, Saint-Laurent, QC', unit: '3', city: 'Saint-Laurent', postal_code: 'H4N 1R3' };
const flotte = { first_name: null, last_name: null, company: 'Livraisons Express Laval', phone: '+1 450 555 0150', email: null, address: '3000 boul. Industriel, Laval, QC', unit: null, city: 'Laval', postal_code: 'H7L 4P8' };
const civic = { year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', plate: 'FHX 4821', vin: '2HGFC2F59KH512345', color: 'Gris' };
const transit = { year: 2022, make: 'Ford', model: 'Transit', trim: null, plate: 'FLT-001', vin: null, color: null };

const dJulie = searchDoc(julie, [civic]);
const dEmilie = searchDoc(emilie);
const dFlotte = searchDoc(flotte, [transit]);

describe('finding a customer', () => {
  it('reads phone digits in any format', () => {
    for (const q of ['5145550141', '514 555-0141', '(514) 555-0141', '+1 514 555 0141', '1-514-555-0141', '555-0141', '0141'])
      expect(docMatches(dJulie, q), q).toBe(true);
    expect(docMatches(dFlotte, '4505550150')).toBe(true);
    expect(docMatches(dJulie, '4505550150')).toBe(false);
  });
  it('never matches digits glued across two fields', () => {
    // phone ends in 0141, the address starts with 1250: "4112" is in neither
    expect(docMatches(dJulie, '4112')).toBe(false);
    expect(docMatches(dJulie, '01411250')).toBe(false);
  });
  it('ignores accents, case and word order', () => {
    expect(docMatches(dEmilie, 'emilie cote')).toBe(true);
    expect(docMatches(dEmilie, 'CÔTÉ Émilie')).toBe(true);
    expect(docMatches(dJulie, 'tremblay ju')).toBe(true);
    expect(docMatches(dJulie, 'tremblay marc')).toBe(false);
  });
  it('finds the company, the street, the postal code, the plate, the VIN and the car', () => {
    expect(docMatches(dFlotte, 'livraisons laval')).toBe(true);
    expect(docMatches(dJulie, 'graham')).toBe(true);
    expect(docMatches(dJulie, '1250')).toBe(true);
    expect(docMatches(dJulie, 'h3p 2c9')).toBe(true);
    expect(docMatches(dJulie, 'H3P2C9')).toBe(true);
    expect(docMatches(dJulie, 'fhx4821')).toBe(true);
    expect(docMatches(dFlotte, 'flt 001')).toBe(true);
    expect(docMatches(dFlotte, 'FLT001')).toBe(true);
    expect(docMatches(dJulie, '512345')).toBe(true);
    expect(docMatches(dJulie, 'civic 2019')).toBe(true);
    expect(docMatches(dJulie, 'honda julie')).toBe(true);
    expect(docMatches(dJulie, 'julie.t@')).toBe(true);
  });
  it('a word and a phone number together must both be found', () => {
    expect(docMatches(dJulie, 'julie 0141')).toBe(true);
    expect(docMatches(dEmilie, 'julie 0125')).toBe(false);
  });
  it('puts the name that starts with what was typed first', () => {
    expect(rank(dJulie, 'jul')).toBe(0);
    expect(rank(dJulie, 'trem')).toBe(0);
    expect(rank(dJulie, 'graham')).toBe(1);
    expect(rank(dJulie, '514 555')).toBe(0);
    const julien = { ...emilie, first_name: 'Marc', last_name: 'Gagnon', address: '12 rue Julien, Laval' };
    const list = [julien, julie];
    const docs = new Map<unknown, ReturnType<typeof searchDoc>>([[julien, searchDoc(julien)], [julie, dJulie]]);
    expect(searchList(list, 'juli', (x) => docs.get(x), () => 0)[0]).toBe(julie);
  });
  it('tells a number from words', () => {
    expect(isNumberQuery('514 555-0141')).toBe(true);
    expect(isNumberQuery('(514)')).toBe(true);
    expect(isNumberQuery('h3p')).toBe(false);
    expect(isNumberQuery('julie')).toBe(false);
  });
});

describe('a new customer from what was typed', () => {
  it('a phone number goes to the phone, words to the name', () => {
    expect(draftFromQuery('514 555-0199')).toEqual({ first_name: '', last_name: '', phone: '514 555-0199' });
    expect(draftFromQuery('julie tremblay')).toEqual({ first_name: 'Julie', last_name: 'Tremblay', phone: '' });
    expect(draftFromQuery('marc-andré de la fontaine 438 555 0177')).toEqual({ first_name: 'Marc-André', last_name: 'De La Fontaine', phone: '438 555 0177' });
    expect(draftFromQuery('McDonald')).toEqual({ first_name: 'McDonald', last_name: '', phone: '' });
  });
  it('capitalises names typed in lower case only', () => {
    expect(cap('émilie')).toBe('Émilie');
    expect(cap("o'neil")).toBe("O'Neil");
    expect(cap('DeSousa')).toBe('DeSousa');
  });
});
