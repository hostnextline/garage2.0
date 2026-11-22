/* The position of an address without asking anyone: the right door, in the right town, or nothing.
   Used when the person leaves the address field without choosing a suggestion, by « Chercher » / « Trouver », by the
   saves (withPosition.ts, which hurries), by the customer's booking page and by the locator that fills in the
   positions still missing (src/shared/customers/locator.ts).
   The map services (places.ts: TomTom with the app's key, Photon with it or alone) are asked with the address as typed,
   then with the short words written out (av. → avenue, St- → Saint-), then without the town; every answer is checked
   against what was typed: the same door number, the same street, and the town or the postal code (its first three
   characters) when they were given. Two different places that both fit are not chosen: the person picks (« Laquelle
   est la bonne ? »). */
import { splitPasted } from './address';
import { photonQuery, metres, type Suggestion } from './photon';
import { searchPlaces } from './places';
import { streetWords, sameStreet, sameTown, wantedOf, digits, AREA, type Wanted } from './match';

// what was typed and how a street or a town compares now live in match.ts (places.ts uses them too); said here as well
export { streetWords, sameStreet, sameTown, wantedOf, type Wanted } from './match';

const near = (a: Suggestion, b: Suggestion) =>
  a.place.lat != null && b.place.lat != null && metres(a.place.lat, a.place.lng!, b.place.lat, b.place.lng!) < 250;

const SIDES = new Set(['est', 'ouest', 'nord', 'sud']);
/** the side words of a street (« Sherbrooke Ouest » → ouest; « E » and « West » count too) */
const sidesOf = (street: string) => streetWords(street).filter((x) => SIDES.has(x));

export interface Best { place: Suggestion | null; quality: 'door' | 'street' | null; choices: Suggestion[] }
/** the one answer that fits what was typed; none when nothing fits or when two different places fit */
export function bestPlace(cands: Suggestion[], w: Wanted, area = AREA): Best {
  const inArea = (s: Suggestion) => !!w.city || !!w.fsa || metres(s.place.lat!, s.place.lng!, area.lat, area.lng) <= area.km * 1000;
  const withPos = cands.filter((s) => s.place.lat != null && s.place.lng != null && inArea(s));
  const streetOk = (s: Suggestion) => !w.street || sameStreet(w.street, s.street);
  const townOk = (s: Suggestion) => !!w.city && s.areas.some((a) => sameTown(a, w.city));
  const fsaOk = (s: Suggestion) => !!w.fsa && (s.place.postal_code || '').toUpperCase().startsWith(w.fsa);
  // a town or a postal code was given: one of them must agree (a wrong town with the right postal code still fits)
  const placeOk = (s: Suggestion) => (!w.city && !w.fsa) || townOk(s) || fsaOk(s);
  // « rue Sherbrooke » typed, only « Sherbrooke Ouest » answered: the other side may be 10 km away. A side the person did
  // not type is sure only when the postal code they typed agrees; otherwise they choose (customers-a-12)
  const typedSides = sidesOf(w.street);
  const sideOk = (s: Suggestion) => sidesOf(s.street).every((d) => typedSides.includes(d)) || fsaOk(s);
  const pick = (list: Suggestion[]): Suggestion | null => (list.length && list.every((s) => near(s, list[0])) ? list[0] : null);

  const doors = withPos.filter((s) => s.exact && w.civics.some((c) => digits(c) === digits(s.house)) && streetOk(s));
  const fitting = doors.filter(placeOk);
  const door = pick(fitting.every(sideOk) ? fitting : []);
  if (door) return { place: door, quality: 'door', choices: fitting };
  if (fitting.length) return { place: null, quality: null, choices: fitting };
  // only the street (its middle, when the street is short): only in the town or postal code that was typed
  if (w.city || w.fsa) {
    const streets = withPos.filter((s) => !s.exact && streetOk(s) && (townOk(s) || fsaOk(s)));
    const street = pick(streets.every(sideOk) ? streets : []);
    if (street) return { place: street, quality: 'street', choices: streets };
  }
  return { place: null, quality: null, choices: doors.length ? doors : cands.filter((s) => s.place.lat != null && streetOk(s)) };
}

/** the short words written out, for a second try: « 144 58e av., St-Laurent » → « 144 58e avenue, Saint-Laurent » */
export function longWords(q: string): string {
  const end = '(?=[\\s,;]|$)';
  return q
    .replace(new RegExp(`\\b(?:boul|blvd|bd)\\.?${end}`, 'gi'), 'boulevard')
    .replace(new RegExp(`\\b(?:av|ave)\\.?${end}`, 'gi'), 'avenue')
    .replace(new RegExp(`\\bch\\.?${end}`, 'gi'), 'chemin')
    .replace(new RegExp(`\\bmtée\\.?${end}`, 'gi'), 'montée')
    .replace(/\bSte?-(?=\p{L})/gu, (m) => (m.toLowerCase().startsWith('ste') ? 'Sainte-' : 'Saint-'))
    .replace(/\bSte?\.?\s+(?=\p{Lu})/gu, (m) => (m.toLowerCase().startsWith('ste') ? 'Sainte-' : 'Saint-'))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export type Located =
  | { status: 'found'; place: Suggestion; quality: 'door' | 'street' }
  | { status: 'choose'; choices: Suggestion[] }
  | { status: 'none' }
  /** `partial`: the network works (TomTom answered) but Photon, needed, did not: « not now », asked again at the next try,
      neither « no network » nor « the map services do not know it » (places.ts, review-places R6) */
  | { status: 'offline'; partial?: true };

/** finds the position of an address, or says why not (nothing fits, several fit, no network). `hurry`: TomTom and Photon
    are asked at once and the first door that fits is taken (a save waits 2.5 s at most: places.ts). `signal`: the
    person typed again (the customer's booking page): the question being asked is stopped and nothing more is asked
    (review-places R4) */
export async function locate(address: string | null | undefined,
  opts: { postal?: string | null; city?: string | null; fresh?: boolean; hurry?: boolean; signal?: AbortSignal } = {}): Promise<Located> {
  const text = String(address || '').trim();
  if (!text) return { status: 'none' };
  const w = wantedOf(text, opts);
  if (!w.street) return { status: 'none' };
  const typed = photonQuery(splitPasted(text).line);
  const queries = [typed, longWords(typed), w.civic ? longWords(`${w.civic} ${w.street}`) : ''].filter((q, i, all) => q && all.indexOf(q) === i);
  let choices: Suggestion[] = [];
  for (const q of queries) {
    if (opts.signal?.aborted) return { status: 'offline' };
    const r = await searchPlaces(q, opts.signal, { fresh: opts.fresh, hurry: opts.hurry, postal: opts.postal, city: opts.city });
    if (r.error) return r.partial ? { status: 'offline', partial: true } : { status: 'offline' };
    const best = bestPlace(r.places, w);
    if (best.place && best.quality) return { status: 'found', place: best.place, quality: best.quality };
    for (const c of best.choices) if (!choices.some((x) => x.key === c.key)) choices.push(c);
  }
  choices = choices.slice(0, 5);
  return choices.length ? { status: 'choose', choices } : { status: 'none' };
}
