/* The position of an address without asking anyone: the right door, in the right town, or nothing.
   Used when the person leaves the address field without choosing a suggestion, by « Chercher », and by the locator
   that fills in the positions still missing (src/app/locator.ts).
   Photon is asked with the address as typed, then with the short words written out (av. → avenue, St- → Saint-),
   then without the town; every answer is checked against what was typed: the same door number, the same street, and
   the town or the postal code (its first three characters) when they were given. Two different places that both fit
   are not chosen: the person picks (« Laquelle est la bonne ? »). */
import { civicNumber, findPostal, postalCode } from '../../lib/text';
import { splitPasted } from './address';
import { photonQuery, metres, type Suggestion } from './photon';
import { searchPlaces } from './places';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
  const parts = line.replace(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?-?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi, ' ').split(',').map((x) => x.trim()).filter(Boolean);
  const first = parts[0] || '';
  const range = /^\s*(\d{1,6}[A-Za-z]?)\s*-\s*(\d{1,6}[A-Za-z]?)\s+(?=\D)/.exec(first);
  const civic = range ? range[1] : civicNumber(first);
  const civics = range ? [range[1], range[2]] : civic ? [civic] : [];
  const street = civic ? first.replace(/^\s*\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?\b[\s,]*/, '').trim() : first;
  let city = opts.city?.trim() || null;
  if (!city) for (const p of parts.slice(1)) { const f = fold(p).replace(/\s+/g, ''); if (f && !PROVINCE.test(f) && !/^\d/.test(f)) { city = p; break; } }
  return { civic, civics, street, city, fsa: pc ? pc.slice(0, 3) : null };
}

const digits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');
const near = (a: Suggestion, b: Suggestion) =>
  a.place.lat != null && b.place.lat != null && metres(a.place.lat, a.place.lng!, b.place.lat, b.place.lng!) < 250;

export interface Best { place: Suggestion | null; quality: 'door' | 'street' | null; choices: Suggestion[] }
/** where the garage works: with no town and no postal code typed, an answer farther than this is not taken */
export const AREA = { lat: 45.5, lng: -73.65, km: 120 };
/** the one answer that fits what was typed; none when nothing fits or when two different places fit */
export function bestPlace(cands: Suggestion[], w: Wanted, area = AREA): Best {
  const inArea = (s: Suggestion) => !!w.city || !!w.fsa || metres(s.place.lat!, s.place.lng!, area.lat, area.lng) <= area.km * 1000;
  const withPos = cands.filter((s) => s.place.lat != null && s.place.lng != null && inArea(s));
  const streetOk = (s: Suggestion) => !w.street || sameStreet(w.street, s.street);
  const townOk = (s: Suggestion) => !!w.city && s.areas.some((a) => sameTown(a, w.city));
  const fsaOk = (s: Suggestion) => !!w.fsa && (s.place.postal_code || '').toUpperCase().startsWith(w.fsa);
  // a town or a postal code was given: one of them must agree (a wrong town with the right postal code still fits)
  const placeOk = (s: Suggestion) => (!w.city && !w.fsa) || townOk(s) || fsaOk(s);
  const pick = (list: Suggestion[]): Suggestion | null => (list.length && list.every((s) => near(s, list[0])) ? list[0] : null);

  const doors = withPos.filter((s) => s.exact && w.civics.some((c) => digits(c) === digits(s.house)) && streetOk(s));
  const fitting = doors.filter(placeOk);
  const door = pick(fitting);
  if (door) return { place: door, quality: 'door', choices: fitting };
  if (fitting.length) return { place: null, quality: null, choices: fitting };
  // only the street (its middle, when the street is short): only in the town or postal code that was typed
  if (w.city || w.fsa) {
    const streets = withPos.filter((s) => !s.exact && streetOk(s) && (townOk(s) || fsaOk(s)));
    const street = pick(streets);
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
  | { status: 'none' | 'offline' };

/** finds the position of an address, or says why not (nothing fits, several fit, no network) */
export async function locate(address: string | null | undefined, opts: { postal?: string | null; city?: string | null; fresh?: boolean } = {}): Promise<Located> {
  const text = String(address || '').trim();
  if (!text) return { status: 'none' };
  const w = wantedOf(text, opts);
  if (!w.street) return { status: 'none' };
  const typed = photonQuery(splitPasted(text).line);
  const queries = [typed, longWords(typed), w.civic ? longWords(`${w.civic} ${w.street}`) : ''].filter((q, i, all) => q && all.indexOf(q) === i);
  let choices: Suggestion[] = [];
  for (const q of queries) {
    const r = await searchPlaces(q, undefined, { fresh: opts.fresh });
    if (r.error) return { status: 'offline' };
    const best = bestPlace(r.places, w);
    if (best.place && best.quality) return { status: 'found', place: best.place, quality: best.quality };
    for (const c of best.choices) if (!choices.some((x) => x.key === c.key)) choices.push(c);
  }
  choices = choices.slice(0, 5);
  return choices.length ? { status: 'choose', choices } : { status: 'none' };
}
