import { describe, it, expect } from 'vitest';
import { splitPasted, cityOf, oneLine, directionsUrl, isCivicRange, unitApart, civicOf } from './address';
import { wantedOf } from './locate';

describe('a pasted address', () => {
  it('keeps the unit apart', () => {
    expect(splitPasted('180-8255 av. Mountain Sights')).toEqual({ line: '8255 av. Mountain Sights', unit: '180', postal: null });
    expect(splitPasted('8255 av. Mountain Sights, app. 3, Montréal')).toEqual({ line: '8255 av. Mountain Sights, Montréal', unit: '3', postal: null });
    expect(splitPasted('1200 rue Peel, bureau 400, Montréal, QC H3B 2T6')).toEqual({ line: '1200 rue Peel, Montréal, QC H3B 2T6', unit: '400', postal: 'H3B 2T6' });
    expect(splitPasted('4800 ch. de la Côte-des-Neiges #12')).toEqual({ line: '4800 ch. de la Côte-des-Neiges', unit: '12', postal: null });
  });
  it('joins an address pasted on two lines and finds the postal code', () => {
    expect(splitPasted('180-8255 av. Mountain Sights\nMontréal, QC  h4p 2b5\n')).toEqual({ line: '8255 av. Mountain Sights, Montréal, QC h4p 2b5', unit: '180', postal: 'H4P 2B5' });
  });
  it('a duplex with two door numbers is not a unit', () => {
    expect(splitPasted('4521-4523 rue Fabre, Montréal')).toEqual({ line: '4521-4523 rue Fabre, Montréal', unit: null, postal: null });
    expect(splitPasted('101-4521 rue Fabre')).toEqual({ line: '4521 rue Fabre', unit: '101', postal: null });
    expect(isCivicRange('1250-1252 rue Graham')).toBe(true);
    expect(isCivicRange('12-1250 rue Graham')).toBe(false);
  });
  it('an address without a unit stays as it is', () => {
    expect(splitPasted('1250 rue Graham, Mont-Royal')).toEqual({ line: '1250 rue Graham, Mont-Royal', unit: null, postal: null });
  });
});

describe('the unit is never cut out of a street name (customers-a-02)', () => {
  const streets = ['1650 rue Logan, Montréal', '4500 avenue Appleton', '75 chemin Bureau', '55 rue Burnside', '4855 avenue Burton',
    '12 rue Unity', '10 rue Localité', '300 rue des Appalaches', '77 rue Logement', '5 rue Burke, Laval', '1234 rue Apple',
    '60 rue Unité', '20 Apple Hill', '2100 rue Logan, Montréal, QC H2L 1Y4', '9 rue Principale, Burlington'];
  it.each(streets)('%s keeps its street', (s) => {
    expect(unitApart(s)).toEqual({ unit: null, line: s });
    expect(splitPasted(s).unit).toBeNull();
  });
  it('the real units still go apart', () => {
    expect(unitApart('1200 rue Peel bureau 400, Montréal')).toEqual({ unit: '400', line: '1200 rue Peel, Montréal' });
    expect(unitApart('8255 av. Mountain Sights, app. 3')).toEqual({ unit: '3', line: '8255 av. Mountain Sights' });
    expect(unitApart('8255 av. Mountain Sights apt 3B')).toEqual({ unit: '3B', line: '8255 av. Mountain Sights' });
    expect(unitApart('8255 av. Mountain Sights app3')).toEqual({ unit: '3', line: '8255 av. Mountain Sights' });
    expect(unitApart('8255 av. Mountain Sights #12')).toEqual({ unit: '12', line: '8255 av. Mountain Sights' });
    expect(unitApart('8255 av. Mountain Sights, unité A')).toEqual({ unit: 'A', line: '8255 av. Mountain Sights' });
    expect(unitApart('8255 av. Mountain Sights, unité 4, Montréal')).toEqual({ unit: '4', line: '8255 av. Mountain Sights, Montréal' });
    expect(unitApart('100 rue Logan app 4')).toEqual({ unit: '4', line: '100 rue Logan' });
    expect(unitApart('3-1250 rue Graham')).toEqual({ unit: '3', line: '1250 rue Graham' });
  });
  it('the street of « rue Logan » is looked up whole', () => {
    expect(wantedOf('2100 rue Logan, Montréal').street).toBe('rue Logan');
    expect(wantedOf('1650 rue Logan, Montréal').civic).toBe('1650');
  });
});

describe('small misreadings (customers-a-20)', () => {
  it('a two-digit duplex is not a unit', () => {
    expect(unitApart('12-14 rue Fabre')).toEqual({ unit: null, line: '12-14 rue Fabre' });
    expect(wantedOf('12-14 rue Fabre').civics).toEqual(['12', '14']);
  });
  it('an ordinal street is not a door number', () => {
    expect(civicOf('58e Avenue, Laval')).toBeNull();
    expect(civicOf('1re rue, Sainte-Anne')).toBeNull();
    expect(wantedOf('58e Avenue, Laval').street).toBe('58e Avenue');
    expect(civicOf('144 58e Avenue')).toBe('144');
    expect(civicOf('1250A rue Graham')).toBe('1250A');
    expect(civicOf('3-1250 rue Graham')).toBe('1250');
    expect(civicOf('4521-4523 rue Fabre')).toBe('4521');
  });
  it('the province is not part of the city', () => {
    expect(cityOf(splitPasted('1650 rue X\nMontréal QC H2L 3C1').line)).toBe('Montréal');
    expect(cityOf('1650 rue X, Laval Québec')).toBe('Laval');
  });
});

describe('reading and showing an address', () => {
  it('the city', () => {
    expect(cityOf('1250 rue Graham, Mont-Royal, QC H3P 2C9')).toBe('Mont-Royal');
    expect(cityOf('3000 boul. Industriel, Laval, QC')).toBe('Laval');
    expect(cityOf('8255 av. Mountain Sights, app. 3, Montréal')).toBe('Montréal');
    expect(cityOf('1250 rue Graham')).toBeNull();
  });
  it('on one line: the unit before the door, the postal code once', () => {
    expect(oneLine({ address: '1250 rue Graham, Mont-Royal, QC', unit: '3', postal_code: 'H3P 2C9' })).toBe('3-1250 rue Graham, Mont-Royal, QC H3P 2C9');
    expect(oneLine({ address: '1250 rue Graham, Mont-Royal, QC H3P 2C9', unit: null, postal_code: 'H3P 2C9' })).toBe('1250 rue Graham, Mont-Royal, QC H3P 2C9');
    expect(oneLine({ address: 'Stationnement Costco', unit: '2', postal_code: null }, 'unit')).toBe('Stationnement Costco, unit 2');
    expect(oneLine({ address: '', unit: '2' })).toBe('');
  });
  it('directions: the position first, else the address', () => {
    expect(directionsUrl({ lat: 45.52, lng: -73.64, address: 'x' })).toBe('https://www.google.com/maps/dir/?api=1&destination=45.52,-73.64');
    expect(directionsUrl({ lat: null, lng: null, address: '1250 rue Graham, Mont-Royal', unit: '3', postal_code: 'H3P 2C9' })).toBe('https://www.google.com/maps/dir/?api=1&destination=1250%20rue%20Graham%2C%20Mont-Royal%20H3P%202C9');
    expect(directionsUrl({ lat: null, lng: null, address: '' })).toBeNull();
  });
});
