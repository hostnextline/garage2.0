import { describe, it, expect } from 'vitest';
import { splitPasted, cityOf, oneLine, directionsUrl, isCivicRange } from './address';
import { vinFromCode, km, parseKm } from './vehicleText';

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
