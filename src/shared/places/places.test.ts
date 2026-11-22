/* Asking the map services: the same question asked twice at the same time is asked once; TomTom and Photon together
   (review F1); TomTom's time, its rest, and the saves that hurry (review F6). */
import { describe, it, expect, vi, afterEach } from 'vitest';

// the app's TomTom key, as the build would give it: none unless a test says so (a key in the shell changes nothing here)
const env = vi.hoisted(() => ({ key: '' }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), get TOMTOM_KEY() { return env.key; } }));

import { searchPlaces, forgetPlaces, tomtomResting, TOMTOM_MS, HURRY_MS, REST_MS } from './places';
import { withPosition } from './withPosition';
import { locate } from './locate';
import { EMPTY_PLACE } from './place';
import * as field from './AddressField';

const KHALIL_160 = {
  geometry: { coordinates: [-73.66748, 45.52789] },
  properties: { housenumber: '160', street: 'Rue Khalil-Gibran', city: 'Montréal', postcode: 'H4N 1C0', countrycode: 'CA', state: 'Québec', type: 'house', osm_key: 'place', osm_value: 'house' }
};
const TT_160 = { results: [{ type: 'Point Address', address: { streetNumber: '160', streetName: 'Rue Khalil-Gibran', municipality: 'Montréal', countrySubdivision: 'QC', postalCode: 'H4N', extendedPostalCode: 'H4N 3C7', countryCode: 'CA' }, position: { lat: 45.5279, lon: -73.6675 } }] };
/** Photon answering after `ms` */
function slowPhoton(ms: number, features: unknown[] = [KHALIL_160]) {
  const fetch = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((done, fail) => {
    const t = setTimeout(() => done({ ok: true, json: async () => ({ features }) }), ms);
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('aborted', 'AbortError')); });
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('the same question at the same time', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); });

  it('is asked once, and both get the answer', async () => {
    vi.useFakeTimers();
    const fetch = slowPhoton(500);
    const a = searchPlaces('160 khalil gibran');
    const b = searchPlaces('160 khalil gibran');
    await vi.advanceTimersByTimeAsync(600);
    expect((await a).places).toHaveLength(1);
    expect((await b).places).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a question with its own stop signal is asked by itself, and stopping it stops only it', async () => {
    vi.useFakeTimers();
    const fetch = slowPhoton(500);
    const ctl = new AbortController();
    const a = searchPlaces('160 khalil gibran');
    const b = searchPlaces('160 khalil gibran', ctl.signal);
    ctl.abort();
    await vi.advanceTimersByTimeAsync(600);
    expect((await b).error).toBe('offline');
    expect((await a).places).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a question that failed is asked again next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    expect((await searchPlaces('160 khalil gibran')).error).toBe('offline');
    const fetch = slowPhoton(0);
    expect((await searchPlaces('160 khalil gibran')).places).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

/* « Créer » tapped while the field's own lookup is on its way (R163, R164): the field left the address 2 s ago, Photon
   is slow (3 s). The save waits 2.5 s from the tap; asking again from zero would give up at 2.5 s and save without a
   position, though the answer comes 1 s later. Joining the field's question, the save gets it. */
describe('the position found while « Créer » is tapped is not lost', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); });

  it('the save joins the field\'s lookup already on its way', async () => {
    vi.useFakeTimers();
    const fetch = slowPhoton(3000);
    const field = locate('160 khalil gibran');                  // the field, when the person left it
    await vi.advanceTimersByTimeAsync(2000);
    const saved = withPosition({ ...EMPTY_PLACE, address: '160 khalil gibran' });   // « Créer », 2 s later
    await vi.advanceTimersByTimeAsync(1100);
    expect((await field).status).toBe('found');
    expect(await saved).toMatchObject({ address: '160 khalil gibran', lat: 45.52789, lng: -73.66748, city: 'Montréal' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an answer already kept is used at once', async () => {
    slowPhoton(0);
    await locate('160 khalil gibran');
    const fetch = slowPhoton(0);
    expect(await withPosition({ ...EMPTY_PLACE, address: '160 khalil gibran' })).toMatchObject({ lat: 45.52789 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('withPosition, as the saves ask for it (R163, R164)', () => {
  it('is exported with that name, beside placeFields, from the address field too', () => {
    expect(field.withPosition).toBe(withPosition);
    expect(typeof field.placeFields).toBe('function');
  });
});

describe('with TomTom’s key: TomTom first, Photon behind it', () => {
  afterEach(() => { vi.unstubAllGlobals(); forgetPlaces(); });
  function services(tomtom: () => unknown, photon: unknown[] = [KHALIL_160]) {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('api.tomtom.com')) return tomtom();
      return { ok: true, json: async () => ({ features: photon }) };
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  const hosts = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => new URL(String(c[0])).hostname);
  it('TomTom answers: its address, and Photon is not asked', async () => {
    const fetch = services(() => ({ ok: true, json: async () => TT_160 }));
    const r = await searchPlaces('160 khalil gibran', undefined, { key: 'KEY' });
    expect(r.error).toBeNull();
    expect(r.places[0].place).toMatchObject({ address: '160 rue Khalil-Gibran, Montréal, QC', lat: 45.5279, lng: -73.6675 });
    expect(hosts(fetch)).toEqual(['api.tomtom.com']);
    expect(String(fetch.mock.calls[0][0])).toContain('/search/2/geocode/160%20khalil%20gibran.json?key=KEY');
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].referrerPolicy).toBe('strict-origin-when-cross-origin');
    // the same question again: from memory
    await searchPlaces('160 khalil gibran', undefined, { key: 'KEY' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('TomTom does not answer (key refused, quota, network): Photon answers', async () => {
    for (const tomtom of [() => ({ ok: false, status: 403, json: async () => ({}) }), () => { throw new TypeError('Failed to fetch'); }]) {
      forgetPlaces();
      const fetch = services(tomtom);
      const r = await searchPlaces('160 khalil gibran', undefined, { key: 'KEY' });
      expect(r.places[0].place).toMatchObject({ lat: 45.52789 });
      expect(hosts(fetch)).toEqual(['api.tomtom.com', 'photon.komoot.io']);
    }
  });
  it('TomTom knows nothing for these words: Photon is asked too', async () => {
    const fetch = services(() => ({ ok: true, json: async () => ({ results: [] }) }));
    const r = await searchPlaces('160 khalil gibran', undefined, { key: 'KEY' });
    expect(r.places).toHaveLength(1);
    expect(hosts(fetch)).toEqual(['api.tomtom.com', 'photon.komoot.io']);
  });
  it('no key: Photon only, as before', async () => {
    const fetch = services(() => ({ ok: true, json: async () => TT_160 }));
    await searchPlaces('160 khalil gibran', undefined, { key: '' });
    expect(hosts(fetch)).toEqual(['photon.komoot.io']);
  });
  it('a question stopped by a new letter while TomTom is asked: Photon is not asked for it', async () => {
    const ctl = new AbortController();
    const fetch = vi.fn((url: string, init?: { signal?: AbortSignal }) => new Promise((_done, fail) => {
      init?.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')));
      void url;
    }));
    vi.stubGlobal('fetch', fetch);
    const asked = searchPlaces('160 khalil gibran', ctl.signal, { key: 'KEY' });
    ctl.abort();
    expect((await asked).places).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('a question already stopped before it is asked asks nobody (review-places R4)', async () => {
    const fetch = services(() => ({ ok: true, json: async () => TT_160 }));
    const ctl = new AbortController();
    ctl.abort();
    expect(await searchPlaces('160 khalil gibran', ctl.signal, { key: 'KEY' })).toEqual({ places: [], error: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('locate stopped between two wordings (a new letter on the booking page): the next wording is not asked (review-places R4)', async () => {
    const ctl = new AbortController();
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const tt = url.includes('api.tomtom.com');
      asked.push(tt ? 'tomtom' : 'photon');
      // the first wording's last answer comes in, and the person types again while it is being read
      return { ok: true, status: 200, json: async () => { if (!tt) ctl.abort(); return tt ? { results: [] } : { features: [] }; } };
    }));
    env.key = 'KEY';
    try {
      expect(await locate('160 av khalil gibran', { signal: ctl.signal })).toEqual({ status: 'offline' });
    } finally { env.key = ''; }
    expect(asked).toEqual(['tomtom', 'photon']);                        // « 160 avenue khalil gibran » never asked
  });
});

/* ---------- TomTom and Photon together (review F1) ---------- */

/** what a pretend service answers: after `ms`, an HTTP status and a body; `hang`: never (only its time limit stops it);
    `fail`: no network */
interface Reply { status?: number; body?: unknown; ms?: number; hang?: boolean; fail?: boolean }
type Spec = Reply | ((url: string) => Reply);
function both(tomtom: Spec, photon: Spec) {
  const log: { who: 'tomtom' | 'photon'; at: number }[] = [];
  const fetch = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
    const who = new URL(url).hostname === 'api.tomtom.com' ? 'tomtom' as const : 'photon' as const;
    log.push({ who, at: Date.now() });
    const spec = who === 'tomtom' ? tomtom : photon;
    const r = typeof spec === 'function' ? spec(url) : spec;
    return new Promise((done, fail) => {
      let t: ReturnType<typeof setTimeout> | undefined;
      init?.signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('aborted', 'AbortError')); });
      if (r.hang) return;
      t = setTimeout(() => {
        if (r.fail) fail(new TypeError('Failed to fetch'));
        else done({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} });
      }, r.ms ?? 0);
    });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, who: () => log.map((x) => x.who), log };
}
/** a promise's value once it is there (fake timers) */
function watch<T>(p: Promise<T>) { const w: { v?: T } = {}; void p.then((v) => { w.v = v; }); return w; }

const TT_STREET = { results: [{ type: 'Street', address: { streetName: 'Avenue Mountain Sights', municipality: 'Montréal', neighbourhood: 'Snowdon', countrySubdivisionCode: 'QC', postalCode: 'H4P', countryCode: 'CA' }, position: { lat: 45.4974127, lon: -73.6538718 } }] };
const TT_8255 = { results: [{ type: 'Point Address', address: { streetNumber: '8255', streetName: 'Avenue Mountain Sights', municipality: 'Montréal', neighbourhood: 'Snowdon', localName: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H4P', extendedPostalCode: 'H4P 2B5', countryCode: 'CA' }, position: { lat: 45.5005053, lon: -73.6577429 } }] };
const photonHouse = (hn: string, street: string, lng: number, lat: number, extra: Record<string, string> = {}) => ({
  geometry: { coordinates: [lng, lat] },
  properties: { housenumber: hn, street, city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H4P 2B5', osm_key: 'building', type: 'house', ...extra }
});
const PH_8200 = { features: [photonHouse('8200', 'Avenue Mountain Sights', -73.6577, 45.5005)] };
const PH_KHALIL = { features: [KHALIL_160] };

describe('TomTom and Photon together (review F1)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); env.key = ''; });

  it('TomTom knows only the street (no position): Photon is asked too and its door is offered, once', async () => {
    const s = both({ body: TT_STREET }, { body: PH_8200 });
    const r = await searchPlaces('8200 av mountain sights', undefined, { key: 'KEY' });
    expect(s.who()).toEqual(['tomtom', 'photon']);
    expect(r.error).toBeNull();
    // TomTom's street and Photon's door are the same address: the door with its position is kept
    expect(r.places).toHaveLength(1);
    expect(r.places[0].place).toMatchObject({ address: '8200 av. Mountain Sights, Montréal, QC', lat: 45.5005, lng: -73.6577 });
    expect(r.places[0].exact).toBe(true);
    await searchPlaces('8200 av mountain sights', undefined, { key: 'KEY' });
    expect(s.fetch).toHaveBeenCalledTimes(2);                      // kept: not asked again
  });

  it('TomTom has that door number on ANOTHER street: Photon is asked too', async () => {
    const decarie = { type: 'Point Address', address: { streetNumber: '8200', streetName: 'Boulevard Décarie', municipality: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H4P', extendedPostalCode: 'H4P 2P5', countryCode: 'CA' }, position: { lat: 45.4963, lon: -73.6602 } };
    const s = both({ body: { results: [decarie, ...TT_STREET.results] } }, { body: PH_8200 });
    const r = await searchPlaces('8200 av mountain sights', undefined, { key: 'KEY' });
    expect(s.who()).toEqual(['tomtom', 'photon']);
    // the door typed first (Enter in the field takes the first line: review-places R3), then TomTom's other door;
    // Photon's door took the place of TomTom's street
    expect(r.places.map((x) => [x.place.address, x.place.lat])).toEqual([
      ['8200 av. Mountain Sights, Montréal, QC', 45.5005],
      ['8200 boul. Décarie, Montréal, QC', 45.4963]
    ]);
  });

  it('the address field: TomTom has the door typed, so Photon is not asked; no door: both, merged', async () => {
    const s = both({ body: TT_8255 }, { body: PH_8200 });
    expect((await searchPlaces('8255 av mountain si', undefined, { key: 'KEY' })).places[0].place.lat).toBe(45.5005053);
    expect(s.who()).toEqual(['tomtom']);
    await searchPlaces('8200 av mountain sights', undefined, { key: 'KEY' });
    expect(s.who()).toEqual(['tomtom', 'tomtom', 'photon']);
  });

  it('a whole address saved (withPosition → locate) gets Photon’s door while TomTom knows only the street', async () => {
    env.key = 'KEY';
    both({ body: TT_STREET }, { body: PH_8200 });
    expect(await withPosition({ ...EMPTY_PLACE, address: '8200 av. Mountain Sights, Montréal' })).toMatchObject({ lat: 45.5005, lng: -73.6577, city: 'Montréal' });
  });

  it('the background locator’s question (the file’s town and postal code, asked fresh) finds the door', async () => {
    env.key = 'KEY';
    const s = both({ body: TT_STREET }, { body: PH_8200 });
    const r = await locate('8200 av. Mountain Sights', { city: 'Montréal', postal: null, fresh: true });
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.place.place).toMatchObject({ lat: 45.5005, lng: -73.6577 });
    expect(s.who()).toEqual(['tomtom', 'photon']);
  });

  it('a borough TomTom does not name: Photon is asked too, and the door is found (TomTom’s position, both town names)', async () => {
    env.key = 'KEY';
    const s = both({ body: TT_8255 }, { body: { features: [photonHouse('8255', 'Avenue Mountain Sights', -73.6576, 45.5004, { district: 'Côte-des-Neiges–Notre-Dame-de-Grâce' })] } });
    const r = await locate('8255 av. Mountain Sights, Côte-des-Neiges');
    expect(s.who()).toEqual(['tomtom', 'photon']);
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.place.place.lat).toBe(45.5005053);
  });

  it('TomTom’s door kept for these words, asked again with a town it does not name: only Photon is asked', async () => {
    env.key = 'KEY';
    const s = both({ body: TT_8255 }, { body: { features: [photonHouse('8255', 'Avenue Mountain Sights', -73.6576, 45.5004, { district: 'Côte-des-Neiges–Notre-Dame-de-Grâce' })] } });
    await searchPlaces('8255 av mountain sights');                 // the field, as the person typed
    expect(s.who()).toEqual(['tomtom']);
    const r = await locate('8255 av mountain sights', { city: 'Côte-des-Neiges' });   // the locator, with the file's town
    expect(r.status).toBe('found');
    expect(s.who()).toEqual(['tomtom', 'photon']);
  });
});

/* ---------- an answer made without TomTom is not kept as complete (review-places R1) ---------- */

const TT_KHALIL_DOOR = { results: [{ type: 'Point Address', address: { streetNumber: '160', streetName: 'Rue Khalil-Gibran', municipality: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H4N', extendedPostalCode: 'H4N 3C7', countryCode: 'CA' }, position: { lat: 45.5279, lon: -73.6675 } }] };
/** Photon knows only the (long) street: no position, so no door to take */
const PH_KHALIL_STREET = { features: [{ geometry: { coordinates: [-73.66, 45.52] }, properties: { name: 'Rue Khalil-Gibran', city: 'Montréal', state: 'Québec', countrycode: 'CA', osm_key: 'highway', type: 'street', extent: [-73.70, 45.55, -73.60, 45.49] } }] };
/** TomTom fails its first question (`first`), then has the door */
const tomtomThenDoor = (first: Reply) => { let n = 0; return (): Reply => (n++ === 0 ? first : { body: TT_KHALIL_DOOR }); };

describe('an answer made while TomTom failed or rested is not kept as complete (review-places R1)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); env.key = ''; });

  it('TomTom busy (500) while the address was typed: later (the locator, a save) TomTom alone is asked again and its door found', async () => {
    env.key = 'KEY';
    const s = both(tomtomThenDoor({ status: 500 }), { body: PH_KHALIL_STREET });
    await searchPlaces('160 rue khalil-gibran');                    // the field, as typed: TomTom 500, Photon the street
    expect(s.who()).toEqual(['tomtom', 'photon']);
    const r = await locate('160 rue khalil-gibran', { city: 'Montréal' });   // the locator's round, not « fresh »
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.place.place).toMatchObject({ lat: 45.5279, lng: -73.6675 });
    expect(s.who()).toEqual(['tomtom', 'photon', 'tomtom']);        // Photon's answer kept is not asked again
    // now complete: from memory
    await locate('160 rue khalil-gibran', { city: 'Montréal' });
    expect(s.who()).toHaveLength(3);
  });

  it('TomTom silent (it rests): during the rest the kept answer serves; after it, TomTom is asked for those words', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const s = both(tomtomThenDoor({ hang: true }), { body: PH_KHALIL_STREET });
    const typed = watch(searchPlaces('160 rue khalil-gibran'));
    await vi.advanceTimersByTimeAsync(TOMTOM_MS + 100);
    expect(typed.v?.places).toHaveLength(1);
    expect(tomtomResting()).toBe(true);
    const during = watch(locate('160 rue khalil-gibran', { city: 'Montréal' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(during.v?.status).toBe('none');                          // resting: Photon's answer, nobody asked
    expect(s.who()).toEqual(['tomtom', 'photon']);
    await vi.advanceTimersByTimeAsync(REST_MS);
    expect(tomtomResting()).toBe(false);
    const after = watch(locate('160 rue khalil-gibran', { city: 'Montréal' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(after.v?.status).toBe('found');
    expect(s.who()).toEqual(['tomtom', 'photon', 'tomtom']);
  });

  it('a Photon answer kept that has the door typed is enough: TomTom is not asked for it, even after its rest', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    both({ status: 403 }, { body: PH_KHALIL });
    const first = watch(searchPlaces('160 khalil gibran'));         // TomTom refused: Photon's door, kept
    await vi.advanceTimersByTimeAsync(10);
    expect(first.v?.places[0].place.lat).toBe(45.52789);
    await vi.advanceTimersByTimeAsync(REST_MS);
    expect(tomtomResting()).toBe(false);
    const s = both({ body: TT_160 }, { body: PH_KHALIL });
    const again = watch(searchPlaces('160 khalil gibran'));
    await vi.advanceTimersByTimeAsync(10);
    expect(again.v?.places[0].place.lat).toBe(45.52789);
    expect(s.who()).toEqual([]);
  });
});

/* ---------- Photon down while TomTom works (decision 4 of build-places, review-places R6) ---------- */

describe('TomTom answers without the door and Photon is down (review-places R6)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); env.key = ''; });

  it('TomTom’s list, « offline » and « partial »; only TomTom’s part is kept: next time Photon alone is asked, and its door comes', async () => {
    env.key = 'KEY';
    let photonUp = false;
    const s = both({ body: TT_STREET }, () => (photonUp ? { body: PH_8200 } : { status: 503 }));
    const r = await searchPlaces('8200 av mountain sights');
    expect(r).toMatchObject({ error: 'offline', partial: true });
    expect(r.places.map((x) => [x.label, x.place.lat])).toEqual([['8200 av. Mountain Sights', null]]);   // TomTom's street
    // leaving the field, a save, the locator: « not now » (the network works), told apart from no network
    expect(await locate('8200 av mountain sights', { city: 'Montréal' })).toEqual({ status: 'offline', partial: true });
    expect(s.who()).toEqual(['tomtom', 'photon', 'photon']);       // TomTom's answer kept: only Photon asked again
    photonUp = true;
    const back = await searchPlaces('8200 av mountain sights');
    expect(back.error).toBeNull();
    expect(back.places[0].place).toMatchObject({ address: '8200 av. Mountain Sights, Montréal, QC', lat: 45.5005 });
    expect(s.who()).toEqual(['tomtom', 'photon', 'photon', 'photon']);
  });

  it('no network at all (both silent): « offline », not « partial »', async () => {
    env.key = 'KEY';
    both({ fail: true }, { fail: true });
    const r = await searchPlaces('8200 av mountain sights');
    expect(r.error).toBe('offline');
    expect(r.partial).toBeUndefined();
    expect(await locate('160 khalil gibran')).toEqual({ status: 'offline' });
  });
});

/* ---------- a save joining a question asked with other words (review-places R5) ---------- */

describe('a save that joins a question on its way keeps its own postal code (review-places R5)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); env.key = ''; });
  const T = '100 rue principale';
  const GRANBY = { results: [{ type: 'Point Address', address: { streetNumber: '100', streetName: 'Rue Principale', municipality: 'Granby', countrySubdivisionCode: 'QC', postalCode: 'J2G', extendedPostalCode: 'J2G 2T5', countryCode: 'CA' }, position: { lat: 45.40, lon: -72.73 } }] };
  const ST_EUSTACHE = { features: [photonHouse('100', 'Rue Principale', -73.95, 45.55, { city: 'Saint-Eustache', postcode: 'J7R 2A1' })] };

  it('the field asked « 100 rue principale » (no code); the save (J7R 2A1 in its box) joins it: the Saint-Eustache door is saved, one question', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const s = both({ body: GRANBY, ms: 300 }, { body: ST_EUSTACHE, ms: 300 });
    void searchPlaces(T);                                           // the field, as the person typed
    await vi.advanceTimersByTimeAsync(100);
    const saved = watch(withPosition({ ...EMPTY_PLACE, address: T, postal_code: 'J7R 2A1' }));   // « Créer », 0.1 s later
    await vi.advanceTimersByTimeAsync(2600);
    expect(saved.v).toMatchObject({ lat: 45.55, lng: -73.95, postal_code: 'J7R 2A1' });
    expect(s.who()).toEqual(['tomtom', 'photon']);
  });
});

/* ---------- TomTom's time and its rest; the saves that hurry (review F6) ---------- */

describe('TomTom’s time and its rest (review F6)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); env.key = ''; });

  it('as you type, TomTom gets 2.5 s; then it rests a minute and Photon answers at once', async () => {
    vi.useFakeTimers();
    expect(TOMTOM_MS).toBe(2500);
    const s = both({ hang: true }, { body: PH_KHALIL, ms: 200 });
    const a = watch(searchPlaces('160 khalil gibran', undefined, { key: 'KEY' }));
    await vi.advanceTimersByTimeAsync(TOMTOM_MS - 100);
    expect(a.v).toBeUndefined();
    expect(s.who()).toEqual(['tomtom']);
    await vi.advanceTimersByTimeAsync(400);                         // 2.5 s + Photon's 0.2 s
    expect(a.v?.places).toHaveLength(1);
    expect(s.who()).toEqual(['tomtom', 'photon']);
    expect(tomtomResting()).toBe(true);
    // the next question, while TomTom rests: Photon alone, in its own 0.2 s
    const b = watch(searchPlaces('1250 rue graham', undefined, { key: 'KEY' }));
    await vi.advanceTimersByTimeAsync(250);
    expect(b.v?.error).toBeNull();
    expect(s.who()).toEqual(['tomtom', 'photon', 'photon']);
    // a minute later TomTom is asked again
    await vi.advanceTimersByTimeAsync(REST_MS);
    expect(tomtomResting()).toBe(false);
    void searchPlaces('8200 av mountain sights', undefined, { key: 'KEY' });
    expect(s.who()[3]).toBe('tomtom');
  });

  it('a key refused or a quota used up (401, 403, 429) makes TomTom rest; another refusal (400, 500) sends only this question to Photon', async () => {
    for (const status of [401, 403, 429, 400, 500]) {
      forgetPlaces();
      const s = both({ status, body: { detailedError: { code: 'x' } } }, { body: PH_KHALIL });
      const r = await searchPlaces('160 khalil gibran', undefined, { key: 'KEY' });
      expect(r.places[0].place.lat).toBe(45.52789);
      expect(s.who()).toEqual(['tomtom', 'photon']);
      expect([status, tomtomResting()]).toEqual([status, status === 401 || status === 403 || status === 429]);
    }
  });

  it('a new letter typed, or no network at all (TomTom and Photon silent): TomTom does not rest', async () => {
    const ctl = new AbortController();
    both({ hang: true }, { body: PH_KHALIL });
    const asked = searchPlaces('160 khalil gibran', ctl.signal, { key: 'KEY' });
    ctl.abort();
    await asked;
    expect(tomtomResting()).toBe(false);
    forgetPlaces();
    both({ fail: true }, { fail: true });
    expect((await searchPlaces('160 khalil gibran', undefined, { key: 'KEY' })).error).toBe('offline');
    expect(tomtomResting()).toBe(false);
    // TomTom silent while Photon answers: TomTom rests
    both({ fail: true }, { body: PH_KHALIL });
    await searchPlaces('1250 rue graham', undefined, { key: 'KEY' });
    expect(tomtomResting()).toBe(true);
  });
});

describe('a save waits 2.5 s at most: TomTom and Photon at once (review F6)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetPlaces(); env.key = ''; });
  const KHALIL = { ...EMPTY_PLACE, address: '160 khalil gibran' };

  it('TomTom does not answer: Photon’s door is saved in 0.3 s; TomTom gets 1.5 s, then rests', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const s = both({ hang: true }, { body: PH_KHALIL, ms: 300 });
    const saved = watch(withPosition(KHALIL));
    await vi.advanceTimersByTimeAsync(350);
    expect(saved.v).toMatchObject({ lat: 45.52789, lng: -73.66748 });
    expect(s.log.map((x) => [x.who, x.at - s.log[0].at])).toEqual([['tomtom', 0], ['photon', 0]]);   // both at once
    await vi.advanceTimersByTimeAsync(HURRY_MS);
    expect(tomtomResting()).toBe(true);
  });

  it('TomTom answers a street at 0.4 s and Photon the door at 2.3 s: saved in time (one after the other: 2.7 s, too late)', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const street = { results: [{ ...TT_STREET.results[0], address: { ...TT_STREET.results[0].address, streetName: 'Rue Khalil-Gibran' } }] };
    both({ body: street, ms: 400 }, { body: PH_KHALIL, ms: 2300 });
    const saved = watch(withPosition(KHALIL));
    await vi.advanceTimersByTimeAsync(2400);
    expect(saved.v).toMatchObject({ lat: 45.52789 });
    // the same services asked the typing way: TomTom first, then Photon: 2.7 s
    forgetPlaces();
    const typed = watch(searchPlaces('160 khalil gibran'));
    await vi.advanceTimersByTimeAsync(2600);
    expect(typed.v).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(typed.v?.places[0].place.lat).toBe(45.52789);
  });

  it('TomTom slow (a street at 2 s), Photon has the door at 0.3 s: the save does not wait for TomTom', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    both({ body: TT_STREET, ms: 2000 }, { body: PH_KHALIL, ms: 300 });
    const saved = watch(withPosition(KHALIL));
    await vi.advanceTimersByTimeAsync(350);
    expect(saved.v).toMatchObject({ lat: 45.52789 });
  });

  it('the save joins the field’s lookup on its way and hurries it (R163, TomTom silent)', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const s = both({ hang: true }, { body: PH_KHALIL, ms: 300 });
    const field = watch(searchPlaces('160 khalil gibran'));          // the field, as the person typed (one after the other)
    await vi.advanceTimersByTimeAsync(100);
    expect(s.who()).toEqual(['tomtom']);
    const saved = watch(withPosition(KHALIL));                      // « Créer », 0.1 s later: joins and hurries it
    await vi.advanceTimersByTimeAsync(350);
    // without hurrying, the answer would come at 2.5 s + 0.3 s, after the save's 2.6 s
    expect(saved.v).toMatchObject({ lat: 45.52789 });
    expect(field.v?.places).toHaveLength(1);
    expect(s.who()).toEqual(['tomtom', 'photon']);
  });

  /* Photon does not know the words as typed (« av »), only written out (« avenue », locate's second wording); TomTom hangs.
     The second wording can only start once the first one is answered: TomTom's limit decides whether the save is in time
     (review-places R7). */
  const AV = '8200 av mountain sights';
  const photonLongWords = (url: string): Reply => ({ body: url.includes('avenue') ? PH_8200 : { features: [] }, ms: 300 });

  it('a save alone: TomTom gets 1.5 s, so the second wording is asked in time (with 2.5 s it would not be)', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const s = both({ hang: true }, photonLongWords);
    const saved = watch(withPosition({ ...EMPTY_PLACE, address: AV }));
    await vi.advanceTimersByTimeAsync(HURRY_MS + 350);
    expect(saved.v).toMatchObject({ lat: 45.5005, lng: -73.6577 });
    expect(s.log.map((x) => [x.who, x.at - s.log[0].at])).toEqual([['tomtom', 0], ['photon', 0], ['photon', HURRY_MS]]);
  });

  it('a save joining the field’s question cuts TomTom’s time left to 1.5 s, so the second wording is asked in time', async () => {
    vi.useFakeTimers();
    env.key = 'KEY';
    const s = both({ hang: true }, photonLongWords);
    void searchPlaces(AV);                                          // the field: TomTom alone, 2.5 s
    await vi.advanceTimersByTimeAsync(100);
    const saved = watch(withPosition({ ...EMPTY_PLACE, address: AV }));   // joins at 0.1 s: TomTom's end at 1.6 s, not 2.5
    await vi.advanceTimersByTimeAsync(HURRY_MS + 350);
    expect(saved.v).toMatchObject({ lat: 45.5005, lng: -73.6577 });
    expect(s.log.map((x) => [x.who, x.at - s.log[0].at])).toEqual([['tomtom', 0], ['photon', 100], ['photon', 100 + HURRY_MS]]);
  });

  it('while TomTom rests: Photon alone, at once', async () => {
    env.key = 'KEY';
    both({ status: 403 }, { body: PH_KHALIL });
    await searchPlaces('1250 rue graham');
    const s = both({ body: TT_160 }, { body: PH_KHALIL });
    expect(await withPosition(KHALIL)).toMatchObject({ lat: 45.52789 });
    expect(s.who()).toEqual(['photon']);
  });
});
