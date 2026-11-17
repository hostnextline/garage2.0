/* Asking Photon: the same question asked twice at the same time is asked once. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchPlaces, forgetPlaces } from './places';
import { withPosition } from './withPosition';
import { locate } from './locate';
import { EMPTY_PLACE } from './place';

const KHALIL_160 = {
  geometry: { coordinates: [-73.66748, 45.52789] },
  properties: { housenumber: '160', street: 'Rue Khalil-Gibran', city: 'Montréal', postcode: 'H4N 1C0', countrycode: 'CA', state: 'Québec', type: 'house', osm_key: 'place', osm_value: 'house' }
};
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
