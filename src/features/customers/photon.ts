/* Addresses from Photon (OpenStreetMap search, photon.komoot.io): its answers written the Québec way,
   « 1250 rue Graham, Mont-Royal, QC H3P 2C9 », with the position for the planner and the map. */
import { postalCode, provinceOfPostal, civicNumber, findPostal } from '../../lib/text';
import type { PlaceValue } from './AddressField';

export interface PhotonFeature {
  geometry?: { coordinates?: number[] | null } | null;
  properties?: Record<string, unknown> | null;
}
export interface Suggestion {
  place: PlaceValue;
  /** first line: « 1250 rue Graham » (or the name of a business) */
  label: string;
  /** second line: « Mont-Royal, QC H3P 2C9 » */
  sub: string;
  /** false: the street was found, but not the door number (position of the street, or none) */
  exact: boolean;
  /** the door and the city, to see the same address twice */
  key: string;
}

export const PHOTON = 'https://photon.komoot.io/api/';
/** near Montréal first */
export function photonUrl(q: string): string {
  return `${PHOTON}?q=${encodeURIComponent(q)}&lang=fr&limit=5&lat=45.50&lon=-73.65`;
}

const PROVINCES: Record<string, string> = {
  quebec: 'QC', ontario: 'ON', 'nouveau-brunswick': 'NB', 'new brunswick': 'NB', 'nouvelle-ecosse': 'NS', 'nova scotia': 'NS',
  'ile-du-prince-edouard': 'PE', 'prince edward island': 'PE', 'terre-neuve-et-labrador': 'NL', 'newfoundland and labrador': 'NL',
  manitoba: 'MB', saskatchewan: 'SK', alberta: 'AB', 'colombie-britannique': 'BC', 'british columbia': 'BC', yukon: 'YT',
  'territoires du nord-ouest': 'NT', 'northwest territories': 'NT', nunavut: 'NU'
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function provinceCode(state: string | null | undefined, postal?: string | null): string | null {
  if (state) {
    const s = fold(state);
    if (PROVINCES[s]) return PROVINCES[s];
    if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  }
  return provinceOfPostal(postal || null);
}

/* the street type the Québec way: lower case, the usual short forms (rue Graham, boul. Décarie, ch. de la Côte-des-Neiges) */
const GENERIC: Record<string, string> = {
  rue: 'rue', avenue: 'av.', boulevard: 'boul.', chemin: 'ch.', place: 'place', route: 'route', rang: 'rang', montee: 'montée',
  cote: 'côte', croissant: 'croissant', allee: 'allée', impasse: 'impasse', terrasse: 'terrasse', promenade: 'promenade',
  carre: 'carré', square: 'square', autoroute: 'autoroute', cours: 'cours', voie: 'voie', passage: 'passage', sentier: 'sentier',
  quai: 'quai', esplanade: 'esplanade', 'rond-point': 'rond-point', ruelle: 'ruelle', circuit: 'circuit', parc: 'parc'
};
export function streetName(street: string): string {
  const s = street.trim().replace(/\s+/g, ' ');
  const m = /^(\S+)\s+(.+)$/.exec(s);
  if (!m) return s;
  const g = GENERIC[fold(m[1])];
  return g ? `${g} ${m[2]}` : s;
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '');
/** distance in metres between two points */
export function metres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** a street short enough for its middle to stand for any door on it (the planner counts driving time) */
const SHORT_STREET_M = 1500;

/** one Photon answer → a suggestion; null when it is not a place where a car can be (a city, a region…) */
export function suggestionOf(f: PhotonFeature, typedCivic: string | null = null): Suggestion | null {
  const p = f.properties || {};
  const c = f.geometry?.coordinates;
  const lng = Array.isArray(c) && Number.isFinite(c[0]) ? Number(c[0]) : null;
  const lat = Array.isArray(c) && Number.isFinite(c[1]) ? Number(c[1]) : null;
  const cc = str(p.countrycode).toUpperCase();
  if (cc && cc !== 'CA') return null;
  const type = str(p.type);
  const key = str(p.osm_key);
  const house = str(p.housenumber);
  const isStreet = type === 'street' || (key === 'highway' && !house);
  let street = str(p.street) || (isStreet ? str(p.name) : '');
  if (!street) return null;
  street = streetName(street);
  const name = !isStreet && str(p.name) && str(p.name) !== street ? str(p.name) : '';
  const civic = house || (isStreet ? typedCivic || '' : '');
  if (!civic && !isStreet) return null;
  const city = str(p.city) || str(p.locality) || str(p.district) || null;
  const pc = postalCode(str(p.postcode)) || null;
  const prov = provinceCode(str(p.state), pc);
  const line = civic ? `${civic} ${street}` : street;
  const tail = [city, [prov, pc].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  let exact = !!house;
  let pos = lat != null && lng != null ? { lat, lng } : null;
  if (!house) {
    // the street only: its middle is good enough when the street is short; otherwise the position stays to be found
    const e = Array.isArray(p.extent) ? (p.extent as unknown[]).map(Number) : null;
    const span = e && e.length === 4 && e.every(Number.isFinite) ? metres(e[1], e[0], e[3], e[2]) : Infinity;
    if (span > SHORT_STREET_M) pos = null;
    exact = false;
  }
  return {
    place: { address: tail ? `${line}, ${tail}` : line, unit: null, postal_code: pc, lat: pos?.lat ?? null, lng: pos?.lng ?? null, city },
    label: name || line,
    sub: name ? [line, tail].filter(Boolean).join(', ') : tail,
    exact,
    key: `${fold(line)}|${fold(city || '')}`
  };
}

/** Photon's answer → suggestions, the same address only once; `query` gives the door number when Photon only knows the street */
export function suggestionsOf(json: unknown, query: string): Suggestion[] {
  const feats = (json as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const civic = civicNumber(query);
  const all = feats.map((f) => suggestionOf(f, civic)).filter((s): s is Suggestion => !!s);
  // the exact door first, then the streets; the same door in the same city only once
  all.sort((a, b) => Number(b.exact) - Number(a.exact));
  const seen = new Set<string>();
  return all.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
}

/** what is sent to Photon: the street line (no unit, no postal code, which it reads badly) */
export function photonQuery(address: string): string {
  let s = address.replace(/\s+/g, ' ').trim();
  const pc = findPostal(s);
  if (pc) s = s.replace(new RegExp(pc.replace(' ', '\\s?-?'), 'i'), ' ');
  return s.replace(/\s+,/g, ',').replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}
