/* Addresses from TomTom (its Geocoding service), written the same Québec way as Photon's (photon.ts): « 1250 rue Graham,
   Mont-Royal, QC », with the position for the planner and the map. Asked first when the app has TomTom's key (places.ts);
   Photon is asked too when TomTom does not have the door typed (places.ts). Pure. */
import { postalCode, fold } from '../../lib/text';
import { tomtomResults, type TomtomResult } from '../../lib/tomtom';
import { civicOf } from './address';
import { streetName, provinceCode, GENERIC, placeKey, type Suggestion } from './photon';

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '');
/* TomTom shortens the side of a street (« Rue Legendre O »): written out, as the garage writes its addresses. A letter
   is a side only after a real name: « Rue E », « Avenue S » (streets named by a letter, in some Québec towns) and
   « 1re Rue N » stay as TomTom wrote them (review F12); a side left short still reads right, a name made into a side
   would not. */
const SIDE: Record<string, string> = { O: 'Ouest', E: 'Est', N: 'Nord', S: 'Sud' };
export function fullSide(street: string): string {
  const m = /^(.*\S)\s+([OENS])$/.exec(street.trim());
  if (!m) return street;
  const before = fold(m[1].split(/\s+/).pop() || '');
  return Object.prototype.hasOwnProperty.call(GENERIC, before) ? street : `${m[1]} ${SIDE[m[2]]}`;
}

/** one TomTom answer → a suggestion; null when it is not a place where a car can be (a city, a crossing, another country) */
export function tomtomSuggestion(r: TomtomResult, typedCivic: string | null = null): Suggestion | null {
  const a = r.address || {};
  const cc = str(a.countryCode).toUpperCase();
  if (cc && cc !== 'CA') return null;
  const type = str(r.type);
  const isStreet = type === 'Street';
  if (!isStreet && type !== 'Point Address' && type !== 'Address Range') return null;
  const rawStreet = str(a.streetName);
  if (!rawStreet) return null;
  const street = streetName(fullSide(rawStreet));
  const house = isStreet ? '' : str(a.streetNumber);
  const civic = house || (isStreet ? typedCivic || '' : '');
  if (!civic && !isStreet) return null;
  const city = str(a.municipality) || str(a.localName) || str(a.municipalitySubdivision) || null;
  // the whole code when TomTom has it for this door; else the first 3 characters (the area), which is all a street or a
  // door range (« Address Range ») has. Never written in the address. The team app never saves a suggestion's code
  // (addressEdit.ts picked); the customer's booking page sends a whole code only, never the area (book-state.ts placeOf).
  // The area helps locate.ts recognise the town
  const pc = postalCode(str(a.extendedPostalCode)) || (/^[A-Z]\d[A-Z]$/i.test(str(a.postalCode)) ? str(a.postalCode).toUpperCase() : null);
  const prov = provinceCode(str(a.countrySubdivisionCode) || str(a.countrySubdivision) || str(a.countrySubdivisionName), postalCode(str(a.extendedPostalCode)));
  const line = civic ? `${civic} ${street}` : street;
  const tail = [city, prov].filter(Boolean).join(', ');
  const lat = Number(r.position?.lat), lng = Number(r.position?.lon);
  // the street only (TomTom does not know that door): no position. TomTom answers a street one piece at a time, each with
  // its own point, and says nothing of how long the whole street is: the point of a piece may be kilometres from the door.
  // The position stays to be found (the locator, or the person choosing a door), never guessed.
  const pos = house && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  return {
    place: { address: tail ? `${line}, ${tail}` : line, unit: null, postal_code: pc, lat: pos?.lat ?? null, lng: pos?.lng ?? null, city },
    label: line,
    sub: tail,
    exact: !!house,
    key: placeKey(line, city),
    house,
    street,
    areas: [str(a.municipality), str(a.municipalitySubdivision), str(a.neighbourhood), str(a.localName), str(a.countrySecondarySubdivision)].filter(Boolean)
  };
}

/** TomTom's answer → suggestions, the same address only once; `query` gives the door number when TomTom only knows the street */
export function tomtomSuggestions(json: unknown, query: string): Suggestion[] {
  const civic = civicOf(query);
  const all = tomtomResults(json).map((r) => tomtomSuggestion(r, civic)).filter((s): s is Suggestion => !!s);
  // the exact door first, then the streets; the same door in the same city only once
  all.sort((a, b) => Number(b.exact) - Number(a.exact));
  const seen = new Set<string>();
  return all.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
}
