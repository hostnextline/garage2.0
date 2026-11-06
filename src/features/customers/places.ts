/* Asking Photon (OpenStreetMap search) for the places that match an address: used by the address field as you type,
   by « Chercher », and by the locator that finds the positions still missing. 6 s at most, never throws; the same
   question twice is answered from memory (not an empty answer, and not when asked to ask again). */
import { photonUrl, photonQuery, suggestionsOf, type Suggestion } from './photon';

export interface Found { places: Suggestion[]; error: 'offline' | null }
const cache = new Map<string, Suggestion[]>();

/** `fresh`: asks again even when the answer is kept (« Trouver »: the map service may know it now) */
export async function searchPlaces(q: string, signal?: AbortSignal, opts: { fresh?: boolean } = {}): Promise<Found> {
  const query = photonQuery(q);
  if (query.length < 3 || !/\p{L}/u.test(query)) return { places: [], error: null };
  const key = query.toLowerCase();
  const hit = opts.fresh ? undefined : cache.get(key);
  if (hit) return { places: hit, error: null };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { places: [], error: 'offline' };
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, 6000);
  try {
    const r = await fetch(photonUrl(query), { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return { places: [], error: 'offline' };
    const places = suggestionsOf(await r.json(), query);
    if (places.length) cache.set(key, places);           // an empty answer is asked again next time
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
    return { places, error: null };
  } catch {
    return { places: [], error: 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** forgets the answers kept in memory (tests) */
export function forgetPlaces() { cache.clear(); }
