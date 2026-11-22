/* Is TomTom's answer the door typed (then Photon is not asked), and two answers in one list (review F1). */
import { describe, it, expect } from 'vitest';
import sample from './__fixtures__/tomtom-geocode.json';
import { tomtomSuggestions } from './tomtom';
import { suggestionsOf } from './photon';
import { isTypedDoor, mergePlaces, wantedOf } from './match';

const PHOTON_8200 = { geometry: { coordinates: [-73.6577, 45.5005] }, properties: { housenumber: '8200', street: 'Avenue Mountain Sights', city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H4P 2B5', osm_key: 'building', type: 'house' } };
const tt = (q: string) => tomtomSuggestions(sample, q);

describe('the door typed, in TomTom’s answer', () => {
  it('the same door number, on the street typed, near the garage: yes', () => {
    const door = tt('8255 av mountain sights')[0];
    expect(isTypedDoor(door, wantedOf('8255 av mountain sights'))).toBe(true);
    // the last word still being typed
    expect(isTypedDoor(door, wantedOf('8255 av mountain si'))).toBe(true);
  });
  it('a street without the door (no position), another door number, another street: no', () => {
    const street = tt('8200 av mountain sights').find((s) => !s.exact && s.street.includes('Mountain'))!;
    expect(street.place.lat).toBeNull();
    expect(isTypedDoor(street, wantedOf('8200 av mountain sights'))).toBe(false);
    const door = tt('8255 av mountain sights')[0];
    expect(isTypedDoor(door, wantedOf('8200 av mountain sights'))).toBe(false);
    expect(isTypedDoor(door, wantedOf('8255 boul decarie'))).toBe(false);
    expect(isTypedDoor(door, wantedOf('av mountain sights'))).toBe(false);   // no door typed: nothing to be sure of
  });
  it('a town typed: the door must be in it (or in the postal code typed)', () => {
    const door = tt('8255 av mountain sights')[0];
    expect(isTypedDoor(door, wantedOf('8255 av mountain sights, Montréal'))).toBe(true);
    // a borough TomTom does not name (its answer says Montréal, Snowdon): Photon is asked too
    expect(isTypedDoor(door, wantedOf('8255 av mountain sights, Côte-des-Neiges'))).toBe(false);
    expect(isTypedDoor(door, wantedOf('8255 av mountain sights, Côte-des-Neiges', { postal: 'H4P 2B5' }))).toBe(true);
    expect(isTypedDoor(door, wantedOf('8255 av mountain sights, Laval'))).toBe(false);
  });
});

describe('TomTom’s answer and Photon’s in one list', () => {
  it('a TomTom street without a position never hides Photon’s door at the same address', () => {
    const street = tt('8200 av mountain sights').filter((s) => !s.exact && s.street.includes('Mountain'));
    const photon = suggestionsOf({ features: [PHOTON_8200] }, '8200 av mountain sights');
    expect(street[0].key).toBe(photon[0].key);                  // the same address: « 8200 av. mountain sights|montreal »
    const both = mergePlaces(street, photon);
    expect(both).toHaveLength(1);
    expect(both[0].place).toMatchObject({ address: '8200 av. Mountain Sights, Montréal, QC', lat: 45.5005, lng: -73.6577 });
    expect(both[0].exact).toBe(true);
    // with the town names of both (TomTom's district helps the town typed)
    expect(both[0].areas).toEqual(expect.arrayContaining(['Montréal', 'Snowdon']));
  });
  it('the same door from both: TomTom’s is kept; TomTom’s first among equals; doors before streets', () => {
    const t = tt('8255 av mountain si');
    const p = suggestionsOf({ features: [PHOTON_8200, { ...PHOTON_8200, properties: { ...PHOTON_8200.properties, housenumber: '8255' } }] }, '8200');
    const both = mergePlaces(t, p);
    const door8255 = both.filter((s) => s.house === '8255');
    expect(door8255).toHaveLength(1);
    expect(door8255[0].place.lat).toBe(45.5005053);             // TomTom's position, not Photon's
    expect(both.map((s) => s.exact)).toEqual([true, true, true, true, false]);
    // TomTom's three doors, then Photon's new one, then TomTom's street
    expect(both.map((s) => s.house)).toEqual(['8255', '1401', '1401', '8200', '']);
  });
  it('the door typed comes first, before a TomTom door of another street (review-places R3)', () => {
    const decarie = tomtomSuggestions({ results: [{ type: 'Point Address', address: { streetNumber: '8200', streetName: 'Boulevard Décarie', municipality: 'Montréal', countrySubdivisionCode: 'QC', extendedPostalCode: 'H4P 2P5', countryCode: 'CA' }, position: { lat: 45.4963, lon: -73.6602 } }] }, '8200 av mountain sights');
    const photon = suggestionsOf({ features: [PHOTON_8200] }, '8200 av mountain sights');
    expect(mergePlaces(decarie, photon, wantedOf('8200 av mountain sights')).map((s) => s.label)).toEqual(['8200 av. Mountain Sights', '8200 boul. Décarie']);
    // nothing typed to compare with: as before (TomTom's first among equals)
    expect(mergePlaces(decarie, photon).map((s) => s.label)).toEqual(['8200 boul. Décarie', '8200 av. Mountain Sights']);
  });
  it('one list alone stays as it was', () => {
    const t = tt('8255 av mountain si');
    expect(mergePlaces(t, [])).toEqual(t);
  });
});

/* ---------- the same door spelled a little differently by the two services (review-places R8) ---------- */
const ttDoor = (n: string, street: string, lat: number, lon: number) => ({ type: 'Point Address', address: { streetNumber: n, streetName: street, municipality: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H2S', extendedPostalCode: 'H2S 1Z2', countryCode: 'CA' }, position: { lat, lon } });
const phDoor = (n: string, street: string, lng: number, lat: number) => ({ geometry: { coordinates: [lng, lat] }, properties: { housenumber: n, street, city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H2S 1Z2', osm_key: 'building', type: 'house' } });

describe('the same door from TomTom and Photon, spelled a little differently: one line (review-places R8)', () => {
  it('an apostrophe ’ or \' (« Rue de l’Église »): one line, TomTom’s', () => {
    const t = tomtomSuggestions({ results: [ttDoor('25', "Rue de l'Église", 45.47, -73.58)] }, '25 rue de l eglise');
    const p = suggestionsOf({ features: [phDoor('25', 'Rue de l’Église', -73.5801, 45.4701)] }, '25 rue de l eglise');
    const both = mergePlaces(t, p);
    expect(both).toHaveLength(1);
    expect(both[0].place.lat).toBe(45.47);
  });
  it('a hyphen or a space (« Jean Talon E » / « Jean-Talon Est »): one line', () => {
    const t = tomtomSuggestions({ results: [ttDoor('5000', 'Rue Jean Talon E', 45.55, -73.6)] }, '5000 jean-talon');
    const p = suggestionsOf({ features: [phDoor('5000', 'Rue Jean-Talon Est', -73.6001, 45.5501)] }, '5000 jean-talon');
    expect(mergePlaces(t, p)).toHaveLength(1);
    // inside one service's answer too (Photon gives both spellings)
    expect(suggestionsOf({ features: [phDoor('25', "Rue de l'Église", -73.58, 45.47), phDoor('25', 'Rue de l’Église', -73.5801, 45.4701)] }, '25 rue de l eglise')).toHaveLength(1);
  });
  it('two different addresses still stay two: another street type, another door, another town', () => {
    const t = tomtomSuggestions({ results: [ttDoor('100', 'Rue Principale', 45.5, -73.6)] }, '100 principale');
    const av = suggestionsOf({ features: [phDoor('100', 'Avenue Principale', -73.61, 45.51)] }, '100 principale');
    expect(mergePlaces(t, av)).toHaveLength(2);
    const other = suggestionsOf({ features: [phDoor('1000', 'Rue Principale', -73.61, 45.51)] }, '100 principale');
    expect(mergePlaces(t, other)).toHaveLength(2);
    const laval = suggestionsOf({ features: [{ ...phDoor('100', 'Rue Principale', -73.71, 45.56), properties: { ...phDoor('100', 'Rue Principale', -73.71, 45.56).properties, city: 'Laval' } }] }, '100 principale');
    expect(mergePlaces(t, laval)).toHaveLength(2);
  });
});

describe('a postal area alone after a comma is not the town (final-critic P1)', () => {
  it('« 8200 av mountain sights, H4P »: no town; a real town after it is still read', () => {
    expect(wantedOf('8200 av mountain sights, H4P').city).toBeNull();
    expect(wantedOf('8200 av mountain sights, h4p, Montréal').city).toBe('Montréal');
    expect(wantedOf('144 58e Avenue, Laval').city).toBe('Laval');
  });
});

describe('mergePlaces: the same key but not one place (final-off L2)', () => {
  it('two answers 2 km apart under one key both stay (each its own key); near: joined as before', () => {
    const s = (lat: number, key = 'k') => ({ key, label: 'x', sub: '', exact: true, house: '1', street: 's', areas: [], place: { address: 'x', unit: null, postal_code: null, city: 'Montréal', lat, lng: -73.6 } }) as never;
    const far = mergePlaces([s(45.5)], [s(45.52)]);
    expect(far).toHaveLength(2);
    expect(new Set(far.map((x: { key: string }) => x.key)).size).toBe(2);
    expect(mergePlaces([s(45.5)], [s(45.5005)])).toHaveLength(1);
  });
});
