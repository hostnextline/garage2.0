import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streetWords, sameStreet, sameTown, wantedOf, bestPlace, longWords, locate } from './locate';
import { suggestionsOf } from './photon';
import { forgetPlaces } from './places';

/* Photon answers, the way it writes them */
const house = (hn: string, street: string, city: string, pc: string | null, lng: number, lat: number, district = '') => ({
  geometry: { coordinates: [lng, lat] },
  properties: { housenumber: hn, street, city, district, postcode: pc, countrycode: 'CA', state: 'Québec', type: 'house', osm_key: 'place', osm_value: 'house' }
});
const street = (name: string, city: string, pc: string | null, lng: number, lat: number, extent: number[]) => ({
  geometry: { coordinates: [lng, lat] },
  properties: { name, city, postcode: pc, countrycode: 'CA', state: 'Québec', type: 'street', osm_key: 'highway', osm_value: 'residential', extent }
});
const LAVAL_144 = house('144', '58e Avenue', 'Laval', 'H7V 4A2', -73.72509, 45.54571);
const KHALIL_160 = house('160', 'Rue Khalil-Gibran', 'Montréal', 'H4N 1C0', -73.66748, 45.52789);

describe('a street, the same however it is written', () => {
  it('generic words, hyphens, accents and short forms do not count', () => {
    expect(streetWords('rue Khalil-Gibran')).toEqual(['khalil', 'gibran']);
    expect(streetWords('58e Avenue')).toEqual(['58e']);
    expect(streetWords('58ième av.')).toEqual(['58e']);
    expect(streetWords('St-Laurent')).toEqual(['saint', 'laurent']);
    expect(streetWords('Main St')).toEqual(['main']);
    expect(streetWords('ch. de la Côte-des-Neiges')).toEqual(['neiges']);
    expect(streetWords('avenue du Parc')).toEqual(['parc']);
    expect(streetWords('rue Fleury E')).toEqual(['fleury', 'est']);
  });
  it('every typed word must be in the street found', () => {
    expect(sameStreet('khalil gibran', 'Rue Khalil-Gibran')).toBe(true);
    expect(sameStreet('58e av', '58e Avenue')).toBe(true);
    expect(sameStreet('Fleury', 'rue Fleury Est')).toBe(true);
    expect(sameStreet('Fleury Est', 'rue Fleury Ouest')).toBe(false);
    expect(sameStreet('57e Avenue', '58e Avenue')).toBe(false);
    expect(sameStreet('', '58e Avenue')).toBe(false);
  });
  it('towns: short forms and boroughs', () => {
    expect(sameTown('St-Laurent', 'Saint-Laurent')).toBe(true);
    expect(sameTown('Montréal', 'Montreal')).toBe(true);
    expect(sameTown('Montréal-Nord', 'Montréal')).toBe(true);
    expect(sameTown('Laval', 'Montréal')).toBe(false);
    expect(sameTown('', 'Laval')).toBe(false);
  });
});

describe('what the person typed', () => {
  it('door, street, town and the start of the postal code', () => {
    expect(wantedOf('144 58e Avenue, Laval, QC H7V 2A7')).toEqual({ civic: '144', civics: ['144'], street: '58e Avenue', city: 'Laval', fsa: 'H7V' });
    expect(wantedOf('160 khalil gibran')).toEqual({ civic: '160', civics: ['160'], street: 'khalil gibran', city: null, fsa: null });
    expect(wantedOf('3-1250 rue Graham', { postal: 'h3p2c9' })).toMatchObject({ civic: '1250', street: 'rue Graham', fsa: 'H3P' });
    expect(wantedOf('4521-4523 rue Fabre, Montréal')).toMatchObject({ civic: '4521', civics: ['4521', '4523'], street: 'rue Fabre', city: 'Montréal' });
    expect(wantedOf('1250 rue Graham', { city: 'Mont-Royal' }).city).toBe('Mont-Royal');
  });
  it('short words written out for a second try', () => {
    expect(longWords('144 58e av. Laval')).toBe('144 58e avenue Laval');
    expect(longWords('3900 boul. Décarie')).toBe('3900 boulevard Décarie');
    expect(longWords('12 ch. Ste-Foy, St-Laurent')).toBe('12 chemin Sainte-Foy, Saint-Laurent');
  });
});

describe('the one answer that fits', () => {
  it('the same door, street and town: taken (the screenshot address)', () => {
    const r = bestPlace(suggestionsOf({ features: [LAVAL_144] }, '144 58e Avenue'), wantedOf('144 58e Avenue, Laval, QC H7V 2A7'));
    expect(r.quality).toBe('door');
    expect(r.place?.place).toMatchObject({ lat: 45.54571, lng: -73.72509, city: 'Laval' });
  });
  it('no town typed: the only door near the garage is taken', () => {
    const r = bestPlace(suggestionsOf({ features: [KHALIL_160] }, '160 khalil gibran'), wantedOf('160 khalil gibran'));
    expect(r.quality).toBe('door');
  });
  it('a wrong town with the right postal code still fits; a wrong town and postal code does not', () => {
    const list = suggestionsOf({ features: [LAVAL_144] }, '144 58e Avenue');
    expect(bestPlace(list, wantedOf('144 58e Avenue, Montréal, H7V 2A7')).quality).toBe('door');
    expect(bestPlace(list, wantedOf('144 58e Avenue, Montréal, H1A 1A1')).place).toBeNull();
  });
  it('another door number or another street: nothing taken', () => {
    const list = suggestionsOf({ features: [LAVAL_144] }, '146 58e Avenue');
    expect(bestPlace(list, wantedOf('146 58e Avenue, Laval')).place).toBeNull();
    expect(bestPlace(suggestionsOf({ features: [LAVAL_144] }, '144 57e Avenue'), wantedOf('144 57e Avenue, Laval')).place).toBeNull();
  });
  it('the same address in two towns and no town typed: the person chooses', () => {
    const two = suggestionsOf({ features: [house('100', 'Rue Principale', 'Granby', 'J2G 2V2', -72.73, 45.40), house('100', 'Rue Principale', 'Saint-Sauveur', 'J0R 1R0', -74.17, 45.89)] }, '100 rue principale');
    const r = bestPlace(two, wantedOf('100 rue Principale'), { lat: 45.5, lng: -73.65, km: 200 });
    expect(r.place).toBeNull();
    expect(r.choices).toHaveLength(2);
    expect(bestPlace(two, wantedOf('100 rue Principale, Granby')).place?.place.city).toBe('Granby');
  });
  it('far from the garage with no town typed: not taken', () => {
    const far = suggestionsOf({ features: [house('160', 'Rue Khalil-Gibran', 'Québec', 'G1K 1A1', -71.2, 46.8)] }, '160 khalil gibran');
    expect(bestPlace(far, wantedOf('160 khalil gibran')).place).toBeNull();
  });
  it('only the street, short, in the typed town: its middle is taken (approximate)', () => {
    const list = suggestionsOf({ features: [street('Rue Sauvé', 'Laval', 'H7V 1A1', -73.72, 45.55, [-73.725, 45.552, -73.715, 45.548])] }, '25 rue Sauvé');
    const r = bestPlace(list, wantedOf('25 rue Sauvé, Laval'));
    expect(r.quality).toBe('street');
    expect(bestPlace(list, wantedOf('25 rue Sauvé')).place).toBeNull();
  });
  it('a duplex: either door number fits', () => {
    const list = suggestionsOf({ features: [house('4523', 'Rue Fabre', 'Montréal', 'H2J 3V5', -73.58, 45.53)] }, '4521 rue fabre');
    expect(bestPlace(list, wantedOf('4521-4523 rue Fabre, Montréal')).quality).toBe('door');
  });
});

describe('locate: asks again with other words, never throws', () => {
  const answers: Record<string, unknown> = {};
  beforeEach(() => {
    forgetPlaces();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)![1]);
      return { ok: true, json: async () => answers[q] ?? { features: [] } };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(answers)) delete answers[k]; });

  it('the address as typed', async () => {
    answers['144 58e Avenue, Laval, QC'] = { features: [LAVAL_144] };
    const r = await locate('144 58e Avenue, Laval, QC', { postal: 'H7V 2A7' });
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.place.place.lat).toBeCloseTo(45.54571);
  });
  it('the short words written out', async () => {
    answers['144 58e avenue, Laval'] = { features: [LAVAL_144] };
    expect((await locate('144 58e av., Laval')).status).toBe('found');
  });
  it('without the town (checked on the answer)', async () => {
    answers['160 khalil gibran'] = { features: [KHALIL_160] };
    expect((await locate('160 khalil gibran, St-Laurent', { postal: 'H4N 1C0' })).status).toBe('found');
  });
  it('nothing fits; no network', async () => {
    expect((await locate('99 rue Imaginaire, Laval')).status).toBe('none');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    forgetPlaces();
    expect((await locate('144 58e Avenue, Laval')).status).toBe('offline');
    expect((await locate('')).status).toBe('none');
  });
});

describe('asking again', () => {
  afterEach(() => { vi.unstubAllGlobals(); forgetPlaces(); });
  it('an empty answer is not kept; « Trouver » asks again even a kept answer', async () => {
    let knows = false, calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return { ok: true, json: async () => ({ features: knows ? [KHALIL_160] : [] }) }; }));
    expect((await locate('160 khalil gibran')).status).toBe('none');
    knows = true;
    expect((await locate('160 khalil gibran')).status).toBe('found');       // the empty answer was not kept
    const before = calls;
    expect((await locate('160 khalil gibran')).status).toBe('found');       // kept: no new question
    expect(calls).toBe(before);
    knows = false;
    expect((await locate('160 khalil gibran', { fresh: true })).status).toBe('none');   // asked again
  });
});
