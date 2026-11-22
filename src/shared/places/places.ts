/* Asking the map services for the places that match an address: used by the address field as you type, by « Chercher »,
   by locate.ts (leaving the field, a save, « Trouver », the locator of the positions still missing) and by the customer's
   booking page. Never throws; the same question twice is answered from memory (not an empty or partial answer, and not
   when asked to ask again).

   TomTom (only when the app has its key, config.ts) and Photon (OpenStreetMap search, free) TOGETHER:
   - TomTom is asked first. When its answer has the door typed, with its position (match.ts isTypedDoor), that is the
     answer and Photon is not asked. Otherwise (nothing, only the street, another door, another town) Photon is asked
     too and the two lists are merged: TomTom's first, the same address once (by key), and a door with its position wins
     over a street without one, so a TomTom street never hides Photon's door (review F1).
   - TomTom gets 2.5 s. A key refused, a quota used up (HTTP 401, 403, 429) or no answer in time makes it rest a minute,
     like the route planners (map/roads.ts): meanwhile Photon is asked alone, at once (review F6). When Photon does not
     answer either, the phone's network was the problem, not TomTom: it does not rest.
   - Without a key: Photon only, exactly as before TomTom.
   - `hurry` (a save waits 2.5 s at most: withPosition): both are asked at once, TomTom gets 1.5 s, and the answer comes
     as soon as one of them has the door typed (TomTom's later answer then goes into memory with Photon's). As you type
     they are asked one after the other: no Photon question when TomTom has the door.
   The same question asked again while its answer is on its way waits for that answer instead of asking again: the tap on
   « Créer » leaves the address field (its lookup starts) and saves with withPosition (the same lookup); asked twice, the
   save could give up at 2.5 s on its own question while the field's, asked earlier, was about to answer (R163, R164). A
   hurried question that joins one on its way hurries it. A question with its own stop signal is asked by itself; once
   stopped (a new letter typed), nothing more is asked for it. */
import { photonUrl, photonQuery, suggestionsOf, type Suggestion } from './photon';
import { tomtomSuggestions } from './tomtom';
import { wantedOf, isTypedDoor, mergePlaces, type Wanted } from './match';
import { tomtomGeocodeUrl } from '../../lib/tomtom';
import { TOMTOM_KEY } from '../../lib/config';
import { findPostal } from '../../lib/text';

export interface Found {
  places: Suggestion[]; error: 'offline' | null;
  /** with `error`: TomTom did answer (without the door typed) and Photon, needed, did not: the network works, a map
      service does not. Asked again next time (review-places R6) */
  partial?: true;
}

/** TomTom's time as you type; when the question hurries (a save); Photon's */
export const TOMTOM_MS = 2500;
export const HURRY_MS = 1500;
export const PHOTON_MS = 6000;
/** TomTom rests that long after a key refused, a quota used up or no answer */
export const REST_MS = 60_000;

/** an answer kept: the places, and whose answers are in them: Photon's, and TomTom's (`tomtom`: TomTom really answered
    these words; false when it failed or was not asked: no key, resting) */
interface Kept { places: Suggestion[]; photon: boolean; tomtom: boolean }
const cache = new Map<string, Kept>();
interface Lookup {
  found: Promise<Found>;
  /** another question with the same words waits for this answer: what it typed counts in « enough »; null once answered */
  join: (want: Wanted, hurry: boolean) => Promise<Found> | null;
}
const onTheWay = new Map<string, Lookup>();
let restUntil = 0;
/** TomTom is resting after a failure: Photon alone is asked */
export const tomtomResting = () => Date.now() < restUntil;

/** `fresh`: asks again even when the answer is kept (« Trouver »: the map service may know it now). `postal`, `city`:
    what the person gave besides the text (locate.ts), to judge whether TomTom found the door */
export async function searchPlaces(q: string, signal?: AbortSignal,
  opts: { fresh?: boolean; key?: string; hurry?: boolean; postal?: string | null; city?: string | null } = {}): Promise<Found> {
  const ttKey = opts.key ?? TOMTOM_KEY;
  const query = photonQuery(q);
  if (query.length < 3 || !/\p{L}/u.test(query)) return { places: [], error: null };
  const key = query.toLowerCase();
  const want = wantedOf(query, { postal: opts.postal || findPostal(q), city: opts.city });
  const hit = opts.fresh ? undefined : cache.get(key);
  // the answer kept serves when it has the door typed, or when it has both services' answers, or when TomTom cannot be
  // asked now (no key, resting). Otherwise only the service missing from it is asked: Photon when TomTom's door does not
  // fit what is asked now (another town given); TomTom when it failed or rested for these words (review-places R1)
  if (hit && (hit.places.some((s) => isTypedDoor(s, want)) || (hit.photon && (hit.tomtom || !ttKey || tomtomResting())))) {
    return { places: hit.places, error: null };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { places: [], error: 'offline' };
  if (signal?.aborted) return { places: [], error: 'offline' };   // stopped before it was asked: nothing is asked (R4)
  const known: Known = !hit ? {} : hit.photon ? { photon: hit.places } : { tomtom: hit.places };
  if (signal) return lookup(query, key, ttKey, want, !!opts.hurry, signal, known).found;
  const joined = onTheWay.get(key)?.join(want, !!opts.hurry);
  if (joined) return joined;
  const run = lookup(query, key, ttKey, want, !!opts.hurry, undefined, known);
  onTheWay.set(key, run);
  try { return await run.found; } finally { if (onTheWay.get(key) === run) onTheWay.delete(key); }
}

function keep(key: string, places: Suggestion[], from: { photon: boolean; tomtom: boolean }) {
  if (!places.length) return;                                       // an empty answer is asked again next time
  cache.delete(key);
  cache.set(key, { places, ...from });
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
}

/** what is already kept for these words: TomTom's answer (only Photon is asked) or Photon's (only TomTom is asked) */
interface Known { tomtom?: Suggestion[]; photon?: Suggestion[] }

/** one question to both services */
function lookup(query: string, key: string, ttKey: string, want: Wanted, hurried: boolean, signal: AbortSignal | undefined, known: Known): Lookup {
  /** what each question waiting for this answer typed: a save joining the field's question brings its postal code or its
      town (review-places R5). « Enough » = the door typed for every one of them */
  const wants = [want];
  const enough = (list: Suggestion[]) => wants.every((w) => list.some((s) => isTypedDoor(s, w)));
  let tt: Asking | null = null, ph: Asking | null = null;
  let ttAns: Answer | null = known.tomtom ? { places: known.tomtom, fail: null } : null;
  let phAns: Answer | null = known.photon ? { places: known.photon, fail: null } : null;
  let done = false;
  let answer!: (f: Found) => void;
  const found = new Promise<Found>((r) => { answer = r; });
  const settle = (f: Found) => {
    if (done) return;
    done = true;
    if (onTheWay.get(key) === self) onTheWay.delete(key);         // a question asked from now on is not joined to it
    answer(f);
  };

  /** both answers are in (or TomTom was not asked): one list */
  const together = () => {
    const p = phAns!;
    const pl = p.fail ? [] : p.places;
    if (!ttAns) { keep(key, pl, { photon: true, tomtom: false }); settle({ places: pl, error: p.fail ? 'offline' : null }); return; }   // Photon alone, as before
    // TomTom silent and Photon silent too: the phone's network, not TomTom
    if (ttAns.fail === 'silent' && p.fail === 'silent') restUntil = 0;
    const places = mergePlaces(ttAns.fail ? [] : ttAns.places, pl, want);
    if (!p.fail) { keep(key, places, { photon: true, tomtom: !ttAns.fail }); settle({ places, error: null }); return; }
    // Photon was needed and could not be reached: what TomTom said is shown, but the answer is not complete. Only
    // TomTom's part is kept (next time Photon alone is asked); `partial`: TomTom answered, so the network works (R6)
    if (ttAns.fail) { settle({ places, error: 'offline' }); return; }
    keep(key, ttAns.places, { photon: false, tomtom: true });
    settle({ places, error: 'offline', partial: true });
  };
  const onPhoton = (p: Answer) => {
    phAns = p;
    if (done) return;
    if (!tt || ttAns) { together(); return; }
    // TomTom still on its way (a hurried question): Photon's door is the answer now
    if (!p.fail && enough(p.places)) { keep(key, p.places, { photon: true, tomtom: false }); settle({ places: p.places, error: null }); }
  };
  const askPhoton = () => {
    if (ph || phAns) return;
    ph = ask(photonUrl(query), (j) => suggestionsOf(j, query), PHOTON_MS, signal, false);
    void ph.answer.then(onPhoton);
  };
  const onTomtom = (a: Answer) => {
    ttAns = a;
    if (a.fail === 'refused' || a.fail === 'silent') restUntil = Date.now() + REST_MS;
    if (done) {
      // after Photon gave the door: TomTom's answer goes into memory with it, TomTom's first
      if (!a.fail && phAns && !phAns.fail) keep(key, mergePlaces(a.places, phAns.places, want), { photon: true, tomtom: true });
      return;
    }
    // stopped by the person (a new letter typed): nothing more is asked for this question
    if (a.fail === 'stopped' || signal?.aborted) { ph?.stop(); settle({ places: a.places, error: a.fail ? 'offline' : null }); return; }
    if (!a.fail && enough(a.places)) {
      // the door typed: Photon is not needed (stopped if it was asked at the same time); its answer already in (kept,
      // or come first without the door) goes with TomTom's
      const pl = phAns && !phAns.fail ? phAns.places : null;
      ph?.stop();
      const places = pl ? mergePlaces(a.places, pl, want) : a.places;
      keep(key, places, { photon: !!pl, tomtom: true });
      settle({ places, error: null });
      return;
    }
    askPhoton();
    if (phAns) together();
  };
  const hurryUp = () => {
    if (hurried || done) return;
    hurried = true;
    if (tt && !ttAns) { tt.cut(HURRY_MS); askPhoton(); }
  };

  const self: Lookup = {
    found,
    join: (w, hurry) => {
      if (done) return null;
      wants.push(w);
      if (hurry) hurryUp();
      return found;
    }
  };
  if (known.tomtom || !ttKey || tomtomResting()) {
    askPhoton();
    if (phAns) together();                                         // Photon's answer kept and TomTom cannot be asked
  } else {
    tt = ask(tomtomGeocodeUrl(query, ttKey), (j) => tomtomSuggestions(j, query), hurried ? HURRY_MS : TOMTOM_MS, signal, true);
    void tt.answer.then(onTomtom);
    if (hurried) askPhoton();
  }
  return self;
}

/** why a service gave nothing: refused (key, quota), silent (no answer in time, no network), busy (any other refusal),
    stopped (a new letter, or not needed any more) */
type Fail = 'refused' | 'silent' | 'busy' | 'stopped';
interface Answer { places: Suggestion[]; fail: Fail | null }
interface Asking { answer: Promise<Answer>; cut: (ms: number) => void; stop: () => void }

/** one request; `cut`: the time left made shorter; never throws */
function ask(url: string, read: (json: unknown) => Suggestion[], ms: number, signal: AbortSignal | undefined, tomtom: boolean): Asking {
  const ctl = new AbortController();
  let late = false;
  const stop = () => ctl.abort();
  const tooLate = () => { late = true; ctl.abort(); };
  let end = Date.now() + ms;
  let timer = setTimeout(tooLate, ms);
  signal?.addEventListener('abort', stop);
  const why = (): Fail => (late ? 'silent' : ctl.signal.aborted ? 'stopped' : 'silent');
  const answer = (async (): Promise<Answer> => {
    try {
      // TomTom answers its key only for the app's addresses: the page's own address goes with the question (the customer's
      // page sends none by default, client.html)
      const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' }, ...(tomtom ? { referrerPolicy: 'strict-origin-when-cross-origin' as const } : {}) });
      if (r.status === 401 || r.status === 403 || r.status === 429) return { places: [], fail: 'refused' };
      if (!r.ok) return { places: [], fail: 'busy' };
      let json: unknown;
      try { json = await r.json(); } catch { return { places: [], fail: ctl.signal.aborted ? why() : 'busy' }; }
      return { places: read(json), fail: null };
    } catch {
      return { places: [], fail: why() };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  })();
  return {
    answer,
    cut: (cap) => {
      const now = Date.now();
      if (end - now <= cap) return;
      end = now + cap;
      clearTimeout(timer);
      timer = setTimeout(tooLate, cap);
    },
    stop
  };
}

/** forgets the answers kept in memory and TomTom's rest (tests) */
export function forgetPlaces() { cache.clear(); onTheWay.clear(); restUntil = 0; }
