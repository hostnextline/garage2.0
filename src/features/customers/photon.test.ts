import { describe, it, expect } from 'vitest';
import sample from './__fixtures__/photon-graham.json';
import { suggestionsOf, suggestionOf, streetName, provinceCode, photonUrl, photonQuery } from './photon';

describe('Photon answer → addresses', () => {
  const list = suggestionsOf(sample, '1250 rue graham');
  it('writes the address the Québec way, with the position', () => {
    expect(list[0].place).toEqual({ address: '1250 rue Graham, Mont-Royal, QC H3P 2C9', unit: null, postal_code: 'H3P 2C9', lat: 45.5205372, lng: -73.6489153, city: 'Mont-Royal' });
    expect(list[0].label).toBe('1250 rue Graham');
    expect(list[0].sub).toBe('Mont-Royal, QC H3P 2C9');
    expect(list[0].exact).toBe(true);
  });
  it('keeps one copy of the same address, leaves out other countries and whole cities', () => {
    const addresses = list.map((s) => s.place.address);
    expect(addresses.filter((a) => a.startsWith('1250 rue Graham'))).toHaveLength(1);
    expect(addresses.some((a) => a.includes('Paris'))).toBe(false);
    expect(addresses.some((a) => a === 'Mont-Royal, QC')).toBe(false);
  });
  it('a business shows its name, and its address is kept without the name', () => {
    const g = list.find((s) => s.label === 'Garage Royalmount')!;
    expect(g.place.address).toBe('5600 av. Royalmount, Mont-Royal, QC H4P 2T1');
    expect(g.sub).toBe('5600 av. Royalmount, Mont-Royal, QC H4P 2T1');
  });
  it('a street without the door: the typed number, the position only when the street is short', () => {
    const short = suggestionOf(sample.features[1], '1250')!;
    expect(short.place.address).toBe('1250 rue Graham, Mont-Royal, QC');
    expect(short.exact).toBe(false);
    expect(short.place.lat).toBeCloseTo(45.5219);
    const long = suggestionOf(sample.features[2], '3900')!;
    expect(long.place.address).toBe('3900 boul. Décarie, Montréal, QC');
    expect(long.place.lat).toBeNull();
    expect(long.place.lng).toBeNull();
  });
  it('exact doors come first', () => {
    expect(list.map((s) => s.exact)).toEqual([...list.map((s) => s.exact)].sort((a, b) => Number(b) - Number(a)));
  });
  it('a broken answer gives nothing (no throw)', () => {
    expect(suggestionsOf(null, 'x')).toEqual([]);
    expect(suggestionsOf({ features: 'nope' }, 'x')).toEqual([]);
    expect(suggestionOf({ geometry: null, properties: null })).toBeNull();
  });
});

describe('address words', () => {
  it('street types', () => {
    expect(streetName('Rue Graham')).toBe('rue Graham');
    expect(streetName('Boulevard Décarie')).toBe('boul. Décarie');
    expect(streetName('Avenue Mountain Sights')).toBe('av. Mountain Sights');
    expect(streetName('Chemin de la Côte-des-Neiges')).toBe('ch. de la Côte-des-Neiges');
    expect(streetName('Montée Saint-François')).toBe('montée Saint-François');
    expect(streetName('Main Street')).toBe('Main Street');
  });
  it('provinces', () => {
    expect(provinceCode('Québec')).toBe('QC');
    expect(provinceCode('Ontario')).toBe('ON');
    expect(provinceCode(null, 'K1A 0B1')).toBe('ON');
    expect(provinceCode('', '')).toBeNull();
  });
  it('the question sent to Photon', () => {
    expect(photonUrl('1250 rue Graham')).toBe('https://photon.komoot.io/api/?q=1250%20rue%20Graham&lang=fr&limit=5&lat=45.50&lon=-73.65');
    expect(photonQuery('1250 rue Graham, Mont-Royal, QC H3P 2C9')).toBe('1250 rue Graham, Mont-Royal, QC');
    expect(photonQuery('  700  rue Lebeau h4n1r3 ')).toBe('700 rue Lebeau');
  });
});
