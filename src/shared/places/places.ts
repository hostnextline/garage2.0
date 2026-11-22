/* Asking Photon (OpenStreetMap search) for the places that match an address: used by the address field as you type,
   by « Chercher », and by the locator that finds the positions still missing. 6 s at most, never throws; the same
   question twice is answered from memory (not an empty answer, and not when asked to ask again).
   The same question asked again while its answer is on its way waits for that answer instead of asking Photon a second
   time: the tap on « Créer » leaves the address field (its lookup starts) and saves with withPosition (the same lookup);
   asked twice, the save could give up at 2.5 s on its own question while the field's, asked earlier, was about to
   answer (R163, R164), and Photon was asked everything twice. A question with its own stop signal is asked by itself. */
import { photonUrl, photonQuery, suggestionsOf, type Suggestion } from './photon';

export interface Found { places: Suggestion[]; error: 'offline' | null }
const cache = new Map<string, Suggestion[]>();
const onTheWay = new Map<string, Promise<Found>>();

/** `fresh`: asks again even when the answer is kept (« Trouver »: the map service may know it now) */
export async function searchPlaces(q: string, signal?: AbortSignal, opts: { fresh?: boolean } = {}): Promise<Found> {
  const query = photonQuery(q);
  if (query.length < 3 || !/\p{L}/u.test(query)) return { places: [], error: null };
  const key = query.toLowerCase();
  const hit = opts.fresh ? undefined : cache.get(key);
  if (hit) return { places: hit, error: null };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { places: [], error: 'offline' };
  if (signal) return ask(query, key, signal);
  const going = onTheWay.get(key);
  if (going) return going;
  const run = ask(query, key);
  onTheWay.set(key, run);
  try { return await run; } finally { if (onTheWay.get(key) === run) onTheWay.delete(key); }
}

async function ask(query: string, key: string, signal?: AbortSignal): Promise<Found> {
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
export function forgetPlaces() { cache.clear(); onTheWay.clear(); }
