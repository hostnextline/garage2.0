/* What the person typed, and whether an answer of the map services fits it: the door number, the street, the town or the
   start of the postal code. Pure. Shared by locate.ts (the one sure answer), places.ts (is TomTom's answer enough, or is
   Photon asked too, and the two lists in one) and the customer's booking page (only the places on the street typed). */
import { findPostal, postalCode, fold } from '../../lib/text';
import { splitPasted, civicOf, withoutPostal } from './address';
import { metres, apart, type Suggestion } from './photon';

/* words that only say what kind of street it is (they may be written or not, in full or short) */
const GENERIC = new Set([
  'rue', 'avenue', 'av', 'ave', 'boulevard', 'boul', 'blvd', 'bd', 'chemin', 'ch', 'place', 'pl', 'route', 'rte', 'rang', 'montee',
  'cote', 'croissant', 'cr', 'allee', 'impasse', 'terrasse', 'terr', 'promenade', 'prom', 'carre', 'square', 'sq', 'autoroute', 'aut',
  'cours', 'voie', 'passage', 'sentier', 'quai', 'esplanade', 'rond', 'point', 'ruelle', 'circuit', 'street', 'road', 'rd',
  'drive', 'dr', 'lane', 'ln', 'court', 'ct', 'crescent', 'cres', 'way', 'du', 'de', 'des', 'la', 'le', 'les', 'l', 'd', 'of', 'the'
]);
const DIRECTION: Record<string, string> = { e: 'est', o: 'ouest', w: 'ouest', west: 'ouest', east: 'est', n: 'nord', north: 'nord', s: 'sud', south: 'sud' };

/** a street as a set of words to compare: « rue Khalil-Gibran » = « khalil gibran », « 58e av. » = « 58e Avenue »,
    « St-Laurent » = « Saint-Laurent », « 1st » = « 1re » */
export function streetWords(s: string | null | undefined): string[] {
  const words = fold(String(s || '')).replace(/[.,'’`]/g, ' ').replace(/[-/]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  words.forEach((w, i) => {
    if (w === 'st' || w === 'saint') { if (i < words.length - 1) out.push('saint'); return; }   // « Main St » is the generic word
    if (w === 'ste' || w === 'sainte') { out.push('sainte'); return; }
    if (w === 'mt') { out.push('mont'); return; }
    const ord = /^(\d+)(e|eme|ieme|er|re|ere|th|st|nd|rd)$/.exec(w);
    if (ord) { out.push(`${ord[1]}e`); return; }
    if (DIRECTION[w]) { out.push(DIRECTION[w]); return; }
    if (GENERIC.has(w)) return;
    out.push(w);
  });
  return out;
}
/** every word typed is in the street of the answer (« khalil gibran » fits « rue Khalil-Gibran ») */
export function sameStreet(typed: string, found: string): boolean {
  const a = streetWords(typed), b = new Set(streetWords(found));
  return a.length > 0 && a.every((w) => b.has(w));
}
const townKey = (s: string) => streetWords(s).join('');
/** « St-Laurent » and « Saint-Laurent », « Montréal-Nord » inside « Montréal »… */
export function sameTown(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = townKey(a || ''), y = townKey(b || '');
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

export interface Wanted {
  /** the door number, and the other number of a duplex (« 4521-4523 rue Fabre ») */
  civic: string | null; civics: string[];
  street: string; city: string | null; fsa: string | null;
}
const PROVINCE = /^(qc|que|quebec|on|ont|ontario|nb|ns|pe|nl|mb|sk|ab|bc|yt|nt|nu|canada)$/;
/** what the person typed: « 144 58e Avenue, Laval, QC H7V 2A7 » → door 144, street « 58e Avenue », Laval, H7V */
export function wantedOf(address: string, opts: { postal?: string | null; city?: string | null } = {}): Wanted {
  const { line, postal } = splitPasted(address);
  const pc = postalCode(opts.postal) || postal || findPostal(line);
  const parts = withoutPostal(line).split(',').map((x) => x.trim()).filter(Boolean);
  const first = parts[0] || '';
  const range = /^\s*(\d{1,6}[A-Za-z]?)\s*-\s*(\d{1,6}[A-Za-z]?)\s+(?=\D)/.exec(first);
  const civic = range ? range[1] : civicOf(first);
  const civics = range ? [range[1], range[2]] : civic ? [civic] : [];
  const street = civic ? first.replace(/^\s*\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?\b[\s,]*/, '').trim() : first;
  let city = opts.city?.trim() || null;
  // a part that is only a postal area (« 8200 av mountain sights, H4P ») is not the town (final-critic P1)
  if (!city) for (const p of parts.slice(1)) { const f = fold(p).replace(/\s+/g, ''); if (f && !PROVINCE.test(f) && !/^\d/.test(f) && !/^[a-z]\d[a-z]$/.test(f)) { city = p; break; } }
  return { civic, civics, street, city, fsa: pc ? pc.slice(0, 3) : null };
}

/** where the garage works: with no town and no postal code typed, an answer farther than this is not taken */
export const AREA = { lat: 45.5, lng: -73.65, km: 120 };
export const digits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');
export const hasPosition = (s: Suggestion) => s.place.lat != null && s.place.lng != null;

/** the street typed is the street of the answer; the last word may still be being typed (« av mountain si ») */
export function streetBegun(typed: string, found: string): boolean {
  const a = streetWords(typed), b = streetWords(found);
  return a.length > 0 && a.every((w, i) => b.includes(w) || (i === a.length - 1 && b.some((x) => x.startsWith(w))));
}

/** the door typed, with its position: the same door number, on the street typed, in the town or postal code typed
    (when one was), near the garage when neither was. When TomTom's answer has one, Photon is not asked (places.ts). */
export function isTypedDoor(s: Suggestion, w: Wanted, area = AREA): boolean {
  if (!s.exact || !hasPosition(s) || !w.civics.length) return false;
  if (!w.civics.some((c) => digits(c) === digits(s.house))) return false;
  if (!streetBegun(w.street, s.street)) return false;
  if (w.city || w.fsa) {
    return (!!w.city && s.areas.some((a) => sameTown(a, w.city))) || (!!w.fsa && (s.place.postal_code || '').toUpperCase().startsWith(w.fsa));
  }
  return metres(s.place.lat!, s.place.lng!, area.lat, area.lng) <= area.km * 1000;
}

/** where a suggestion stands: the door typed (`w`, with its position), then another door with its position, then a
    street with its position (its middle, Photon), then a place whose position is still to be found (a TomTom street) */
const standing = (s: Suggestion, w?: Wanted) => (hasPosition(s) ? (s.exact ? (w && isTypedDoor(s, w) ? 0 : 1) : 2) : 3);
/** two answers in one list (TomTom's, then Photon's): the same address only once, by key; of the two, the one with the
    door and its position is kept (TomTom's when they are as good), with the town names of both, so a TomTom street
    without a position never hides Photon's door. `w`, what was typed: the door typed comes first, before another door
    (Enter in the address field takes the first line: review-places R3); then the other doors with their position, then
    the streets; among equals, the first list's before the second's, each in its own order. */
export function mergePlaces(first: Suggestion[], second: Suggestion[], w?: Wanted): Suggestion[] {
  const kept = new Map<string, Suggestion>();
  for (const s of [...first, ...second]) {
    const had = kept.get(s.key);
    // two places a hyphen apart in their names but not one place (final-off L2): both kept, the person chooses
    if (had && apart(had, s)) { const k = `${s.key}~${kept.size}`; kept.set(k, { ...s, key: k }); continue; }
    if (!had) { kept.set(s.key, s); continue; }
    // which of the two: by what each one is (TomTom's when as good); is it the door typed is asked of the two joined
    const [win, other] = standing(s) < standing(had) ? [s, had] : [had, s];
    kept.set(s.key, { ...win, areas: [...new Set([...win.areas, ...other.areas])] });
  }
  return [...kept.values()].sort((a, b) => standing(a, w) - standing(b, w));
}
