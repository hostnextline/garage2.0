import { describe, it, expect } from 'vitest';
import sample from './__fixtures__/tomtom-geocode.json';
import { tomtomSuggestions, tomtomSuggestion, fullSide } from './tomtom';
import { bestPlace, wantedOf } from './locate';

/* the fixture: TomTom's own answers (2026-11-19) for « 8255 av mountain si », « 1401 legendre o » and « boulevard
   saint-martin ouest laval », put in one list, with a city, a crossing and an address in another country added */
describe('TomTom answer → addresses, written as the garage writes them', () => {
  const list = tomtomSuggestions(sample, '8255 av mountain si');
  it('the door: the Québec way, with its position; the postal code is never written in the address', () => {
    expect(list[0].place).toEqual({ address: '8255 av. Mountain Sights, Montréal, QC', unit: null, postal_code: 'H4P 2B5', lat: 45.5005053, lng: -73.6577429, city: 'Montréal' });
    expect(list[0].label).toBe('8255 av. Mountain Sights');
    expect(list[0].sub).toBe('Montréal, QC');
    expect(list[0].exact).toBe(true);
    expect(list[0].house).toBe('8255');
    expect(list[0].areas).toEqual(expect.arrayContaining(['Montréal', 'Snowdon']));
  });
  it('the doors first; the same street once; no city, no crossing, no other country', () => {
    // the two pieces of av. Mountain Sights are the door already there; the two pieces of the boulevard are one street
    expect(list.map((s) => s.exact)).toEqual([true, true, true, false]);
    const addresses = list.map((s) => s.place.address);
    expect(addresses.filter((a) => a.includes('Mountain Sights') && !a.startsWith('8255 av. Mountain Sights, Montréal'))).toHaveLength(0);
    expect(addresses.some((a) => a.includes('Plattsburgh'))).toBe(false);
    expect(addresses.some((a) => a === 'Laval, QC')).toBe(false);
    expect(addresses.some((a) => a.includes('&'))).toBe(false);
  });
  it('the side of a street is written out (« Rue Legendre O » → « rue Legendre Ouest »)', () => {
    const centrale = list.find((s) => s.house === '1401' && s.street.includes('Ouest'))!;
    expect(centrale.place.address).toBe('1401 rue Legendre Ouest, Montréal, QC');
    expect(centrale.place.lat).toBeCloseTo(45.53137, 4);
    expect(fullSide('Boulevard Henri-Bourassa E')).toBe('Boulevard Henri-Bourassa Est');
    expect(fullSide('Rue Saint-Jacques O')).toBe('Rue Saint-Jacques Ouest');
    expect(fullSide('Rue Principale N')).toBe('Rue Principale Nord');
    expect(fullSide('Rue Saint-Denis')).toBe('Rue Saint-Denis');
    expect(fullSide('Rue Notre-Dame Ouest')).toBe('Rue Notre-Dame Ouest');
  });
  it('a street NAMED by a letter keeps its name: a side comes only after a real name (review F12)', () => {
    expect(fullSide('Rue E')).toBe('Rue E');
    expect(fullSide('Avenue S')).toBe('Avenue S');
    expect(fullSide('Avenue O')).toBe('Avenue O');
    expect(fullSide('1re Rue N')).toBe('1re Rue N');
    expect(fullSide('Chemin du Rang S')).toBe('Chemin du Rang S');
    expect(fullSide('Rue Constructor E')).toBe('Rue Constructor Est');   // a word that is also an object's property name
    // in an answer: « Rue E » in Saint-Lin is written « rue E », never « rue Est »
    const e = tomtomSuggestions({ results: [{ type: 'Point Address', address: { streetNumber: '12', streetName: 'Rue E', municipality: 'Saint-Lin–Laurentides', countrySubdivisionCode: 'QC', countryCode: 'CA' }, position: { lat: 45.85, lon: -73.76 } }] }, '12 rue e')[0];
    expect(e.place.address).toBe('12 rue E, Saint-Lin–Laurentides, QC');
  });
  it('a door placed along its block (« Address Range ») is a door; its code is the area only', () => {
    const range = list.find((s) => s.street === 'rue Légendre Est')!;
    expect(range.exact).toBe(true);
    expect(range.place.postal_code).toBe('H2M');
    expect(range.place.lat).toBeCloseTo(45.5606, 3);
  });
  it('a street without the door: the typed number, and NO position (a piece of a street says nothing of where the door is)', () => {
    const piece = tomtomSuggestion(sample.results[1], '8200')!;
    expect(piece.place.address).toBe('8200 av. Mountain Sights, Montréal, QC');
    expect(piece.exact).toBe(false);
    expect(piece.place.lat).toBeNull();
    expect(piece.place.lng).toBeNull();
    const laval = tomtomSuggestions(sample, '3500 boulevard saint-martin ouest laval').find((s) => s.street === 'boul. Saint-Martin Ouest')!;
    expect(laval.place.address).toBe('3500 boul. Saint-Martin Ouest, Laval, QC');
    expect(laval.place.lat).toBeNull();
    expect(laval.place.postal_code).toBe('H7S');   // the area, which helps recognise the town
  });
  it('the locator takes TomTom’s door for a whole address typed, as it does Photon’s', () => {
    const typed = '1401 rue Legendre Ouest, Montréal';
    const best = bestPlace(tomtomSuggestions(sample, typed).filter((s) => s.place.lat != null), wantedOf(typed));
    expect(best.quality).toBe('door');
    expect(best.place?.place.address).toBe('1401 rue Legendre Ouest, Montréal, QC');
  });
  it('nothing usable: an empty list, never an error', () => {
    expect(tomtomSuggestions(null, 'x')).toEqual([]);
    expect(tomtomSuggestions({ results: [{ type: 'Point Address', address: {} }] }, 'x')).toEqual([]);
    expect(tomtomSuggestion({ type: 'Point Address', address: { streetName: 'Rue X', countryCode: 'CA' }, position: { lat: 45, lon: -73 } })).toBeNull();   // a door with no number
  });
});
