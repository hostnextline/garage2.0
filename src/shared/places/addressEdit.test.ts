import { describe, it, expect } from 'vitest';
import { sameDoor, detailsFit, typed, pasted, picked, left, located } from './addressEdit';
import { EMPTY_PLACE, placeFields, type PlaceValue } from './place';
import type { Suggestion } from './photon';

const sugg = (address: string, lat = 45.5, lng = -73.6, exact = true): Suggestion => ({
  place: { address, unit: null, postal_code: 'H9Z 9Z9', lat, lng, city: address.split(',')[1]?.trim() || null },
  label: address.split(',')[0], sub: '', exact, key: address, house: address.split(' ')[0], street: address.split(',')[0].replace(/^\d+\s*/, ''), areas: []
});
const graham: PlaceValue = { address: '1250 rue Graham', unit: '3', postal_code: 'H3P 2C9', lat: 45.52, lng: -73.64, city: 'Mont-Royal' };

describe('the same door', () => {
  it('a typo, a street type or a town added is still the same door', () => {
    expect(sameDoor('1250 rue Graham', '1250 rue Graham, Mont-Royal, QC')).toBe(true);
    expect(sameDoor('1250 rue Grahm', '1250 rue Graham')).toBe(true);
    expect(sameDoor('160 khalil gibran', '160 rue Khalil-Gibran, Montréal')).toBe(true);
  });
  it('another door or another street is not', () => {
    expect(sameDoor('1250 rue Graham', '700 rue Lebeau')).toBe(false);
    expect(sameDoor('1250 rue Graham', '1252 rue Graham')).toBe(false);
    expect(sameDoor('1250 rue Graham', '1250 rue Lebeau')).toBe(false);
  });
  it('details written before any address fit the address to come', () => {
    expect(detailsFit('', '700 rue Lebeau')).toBe(true);
  });
});

describe('the old unit and postal code do not follow a new address (customers-a-03)', () => {
  it('choosing a suggestion for another street clears them', () => {
    const v = typed(graham, '700 rue Lebeau');
    const out = picked(v, sugg('700 rue Lebeau, Saint-Laurent, QC'), graham.address);
    expect(out).toMatchObject({ address: '700 rue Lebeau, Saint-Laurent, QC', unit: null, postal_code: null, lat: 45.5 });
  });
  it('choosing the same door keeps them (never Photon’s postal code)', () => {
    const v = typed(graham, '1250 rue Graham');
    const out = picked(v, sugg('1250 rue Graham, Mont-Royal, QC'), graham.address);
    expect(out).toMatchObject({ unit: '3', postal_code: 'H3P 2C9' });
  });
  it('pasting another address clears them, but keeps what it brings', () => {
    expect(pasted(graham, '700 rue Lebeau', graham.address)).toMatchObject({ address: '700 rue Lebeau', unit: null, postal_code: null, lat: null });
    expect(pasted(graham, '5-700 rue Lebeau H4N 1R3', graham.address)).toMatchObject({ address: '700 rue Lebeau H4N 1R3', unit: '5', postal_code: 'H4N 1R3' });
  });
  it('typing another address and leaving clears them; a code typed in the address stays', () => {
    expect(left(typed(graham, '700 rue Lebeau'), graham.address, false)).toMatchObject({ unit: null, postal_code: null });
    expect(left(typed(graham, '700 rue Lebeau H4N 1R3'), graham.address, false)).toMatchObject({ unit: null, postal_code: 'H4N 1R3' });
  });
  it('a unit typed after the change is written for the new address (the anchor moved)', () => {
    const v = { ...typed(graham, '700 rue Lebeau'), unit: '8' };
    expect(left(v, '700 rue Lebeau', false)).toMatchObject({ unit: '8' });
  });
});

describe('the unit typed with the address', () => {
  it('is kept when a suggestion is chosen (customers-a-08)', () => {
    const v = typed(EMPTY_PLACE, '3-1250 rue graham');
    expect(picked(v, sugg('1250 rue Graham, Mont-Royal, QC'), '')).toMatchObject({ address: '1250 rue Graham, Mont-Royal, QC', unit: '3' });
  });
  it('goes to its own box when the field is left', () => {
    expect(left(typed(EMPTY_PLACE, '3-1250 rue Graham'), '', false)).toMatchObject({ address: '1250 rue Graham', unit: '3' });
  });
  it('a chosen address is never cut again (customers-a-02)', () => {
    const v = { ...EMPTY_PLACE, address: '1650 rue Logan, Montréal, QC', lat: 45.5, lng: -73.5 };
    expect(left(v, '', true)).toBe(v);
    expect(left({ ...v, lat: null, lng: null }, '', false).address).toBe('1650 rue Logan, Montréal, QC');
  });
});

describe('typing and the position found', () => {
  it('typing forgets the position and takes a postal code typed inside', () => {
    expect(typed(graham, '1250 rue Graham H3P 2C9')).toMatchObject({ lat: null, lng: null, city: null, postal_code: 'H3P 2C9' });
  });
  it('the position found keeps the address as typed', () => {
    const v = typed(EMPTY_PLACE, '160 khalil gibran');
    expect(located(v, sugg('160 rue Khalil-Gibran, Montréal', 45.527, -73.6))).toMatchObject({ address: '160 khalil gibran', lat: 45.527, city: 'Montréal', postal_code: null });
  });
});

describe('what is saved', () => {
  it('a postal code that is not one is not saved (customers-a-18)', () => {
    expect(placeFields({ ...graham, postal_code: 'H3P' }).postal_code).toBeNull();
    expect(placeFields({ ...graham, postal_code: '12345' }).postal_code).toBeNull();
    expect(placeFields({ ...graham, postal_code: 'h3p2c9' }).postal_code).toBe('H3P 2C9');
  });
  it('no position without an address; the city from the address', () => {
    expect(placeFields({ ...EMPTY_PLACE, lat: 1, lng: 2 })).toMatchObject({ address: null, lat: null, lng: null });
    expect(placeFields({ ...EMPTY_PLACE, address: '1 rue X, Laval' }).city).toBe('Laval');
  });
});
