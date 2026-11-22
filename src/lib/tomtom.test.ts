import { describe, it, expect, vi } from 'vitest';
import { tomtomTiles, tileWatch, tileCheckOf, checkTile, TILE_CHECK_EVERY, TILE_CHECK_RETRY, isRoadLine, tomtomRouteUrl, parseTomtomRoute, tomtomRefused, tomtomError, tomtomGeocodeUrl, tomtomResults } from './tomtom';

/** TomTom's real answer to a refused key (curl of 2026-11-19, review-app-done): HTTP 401 with this body */
const REFUSED_KEY = { detailedError: { code: 'Unauthorized', message: 'You are missing valid authentication credentials' } };

describe('TomTom: what the app asks and how it reads the answers', () => {
  it('the map tiles carry the key, and credit TomTom AND OpenStreetMap (the roads may be OSRM’s, the addresses Photon’s)', () => {
    const t = tomtomTiles('k e&y');
    expect(t.url).toBe('https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=k%20e%26y&tileSize=256');
    expect(t.attribution).toContain('TomTom');
    expect(t.attribution).toContain('openstreetmap.org/copyright');
  });
  it('a route through the stops in order, leaving now, with the traffic of now', () => {
    const u = new URL(tomtomRouteUrl([[45.5005, -73.6577], [45.5307, -73.6702], [45.4772, -73.6213]], 'KEY'));
    expect(u.pathname).toBe('/routing/1/calculateRoute/45.500500,-73.657700:45.530700,-73.670200:45.477200,-73.621300/json');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ key: 'KEY', traffic: 'true', departAt: 'now', travelMode: 'car', routeType: 'fastest' });
  });
  it('another day: leaving at the moment asked (no offset: Montréal’s time); anything else written is never sent', () => {
    const u = new URL(tomtomRouteUrl([[45.5, -73.6], [45.51, -73.61]], 'KEY', '2026-11-24T11:30:00'));
    expect(u.searchParams.get('departAt')).toBe('2026-11-24T11:30:00');
    expect(u.searchParams.get('traffic')).toBe('true');   // a moment to come: TomTom's usual traffic of that moment
    expect(new URL(tomtomRouteUrl([[45.5, -73.6], [45.51, -73.61]], 'KEY', '2026-11-24T11:30:00&key=x')).searchParams.get('departAt')).toBe('now');
  });
  it('reads one line per leg and TomTom’s own time (the traffic is in it: no margin added)', () => {
    const answer = { routes: [{ summary: { lengthInMeters: 23456, travelTimeInSeconds: 1887 }, legs: [
      { points: [{ latitude: 45.5006, longitude: -73.6578 }, { latitude: 45.51, longitude: -73.66 }, { latitude: 45.51, longitude: -73.66 }, { latitude: 45.53, longitude: -73.67 }] },
      { points: [{ latitude: 45.53, longitude: -73.67 }, { latitude: 45.4773, longitude: -73.6214 }] }
    ] }] };
    const r = parseTomtomRoute(answer, 3)!;
    expect(r.legs).toEqual([[[45.5006, -73.6578], [45.51, -73.66], [45.53, -73.67]], [[45.53, -73.67], [45.4773, -73.6214]]]);
    expect(r.km).toBe(23.5);
    expect(r.minutes).toBe(31);                      // 1887 s, not 1887 s + 20 %
    expect(parseTomtomRoute(answer, 4)).toBeNull();  // not the legs asked for
    expect(parseTomtomRoute({ routes: [] }, 3)).toBeNull();
    expect(parseTomtomRoute({ routes: [{ legs: [{}, {}] }] }, 3)).toBeNull();   // no time: not a route
    expect(parseTomtomRoute(null, 2)).toBeNull();
  });
  it('a leg with no point at all is not an answer (it would be drawn as a straight line): the next planner is asked', () => {
    const summary = { lengthInMeters: 1000, travelTimeInSeconds: 120 };
    expect(parseTomtomRoute({ routes: [{ summary, legs: [{}] }] }, 2)).toBeNull();
    expect(parseTomtomRoute({ routes: [{ summary, legs: [{ points: [] }] }] }, 2)).toBeNull();
    expect(parseTomtomRoute({ routes: [{ summary, legs: [{ points: [{ latitude: 'x', longitude: null }] }] }] }, 2)).toBeNull();
    // an error written in a 200 is not a route either
    expect(parseTomtomRoute({ error: { description: 'Engine error' } }, 2)).toBeNull();
  });
  it('« no road » is for good; a key refused, badly written or a quota used up is not (both of TomTom’s error bodies)', () => {
    expect(tomtomRefused(400, { error: { description: 'Engine error while executing route request: NO_ROUTE_FOUND' } })).toBe(true);
    expect(tomtomRefused(400, { error: { description: 'Invalid API key' } })).toBe(false);
    expect(tomtomRefused(400, { detailedError: { code: 'BadRequest', message: 'Invalid key format' } })).toBe(false);   // review F8
    expect(tomtomRefused(400, { detailedError: { code: 'Unauthorized', message: 'You are missing valid authentication credentials' } })).toBe(false);
    expect(tomtomRefused(401, REFUSED_KEY)).toBe(false);
    expect(tomtomRefused(403, { error: { description: 'You are not allowed to access this endpoint' } })).toBe(false);
    expect(tomtomRefused(429, null)).toBe(false);
    expect(tomtomRefused(200, {})).toBe(false);
    expect(tomtomError(REFUSED_KEY)).toBe('You are missing valid authentication credentials Unauthorized');
    expect(tomtomError({ error: { description: 'NO_ROUTE_FOUND' } })).toBe('NO_ROUTE_FOUND');
    expect(tomtomError('<html>')).toBe('');
  });
  it('the addresses: Canada only, near Montréal first, in French, a half-typed address as it is', () => {
    const u = new URL(tomtomGeocodeUrl('8255 av mountain si', 'KEY'));
    expect(u.pathname).toBe('/search/2/geocode/8255%20av%20mountain%20si.json');
    expect(Object.fromEntries(u.searchParams)).toEqual({ key: 'KEY', countrySet: 'CA', lat: '45.5', lon: '-73.65', limit: '6', language: 'fr-FR' });
    expect(u.searchParams.has('typeahead')).toBe(false);   // TomTom withdrew it from this service: sending it is refused
    expect(tomtomResults({ results: [{ type: 'Street' }] })).toHaveLength(1);
    expect(tomtomResults({})).toEqual([]);
    expect(tomtomResults(null)).toEqual([]);
  });
});

describe('a stored line is a road only with 3 points or more (the old server wrote the two ends alone)', () => {
  it('two points, one, none: not a road; three: a road', () => {
    expect(isRoadLine([[45.5, -73.6], [45.52, -73.6]])).toBe(false);
    expect(isRoadLine([[45.5, -73.6]])).toBe(false);
    expect(isRoadLine([])).toBe(false);
    expect(isRoadLine(null)).toBe(false);
    expect(isRoadLine([[45.5, -73.6], [45.51, -73.6], [45.52, -73.6]])).toBe(true);
  });
});

describe('TomTom’s tiles refused → OpenStreetMap’s, once (decided by TomTom’s own answer, review-maps H1 M1 L1)', () => {
  it('what TomTom answered: a refusal (key, site, quota, too many) or a broken server → refused; a tile → ok', () => {
    for (const s of [400, 401, 403, 429, 500, 502, 503]) expect(tileCheckOf(s)).toBe('refused');
    for (const s of [200, 204, 304, 404]) expect(tileCheckOf(s)).toBe('ok');
  });
  const URL = 'https://api.tomtom.com/map/1/tile/basic/main/14/4850/5860.png?key=KEY&tileSize=256';
  it('ONE plain request of the failed tile, with the site’s address, no cookie, past the browser’s cache', async () => {
    const get = vi.fn(async () => ({ status: 403 }) as Response);
    expect(await checkTile(URL, get as unknown as typeof fetch)).toBe('refused');
    expect(get).toHaveBeenCalledTimes(1);
    const [u, o] = get.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toBe(URL);
    expect(o).toMatchObject({ mode: 'cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
    expect(o.signal).toBeDefined();
  });
  it('TomTom serves the tile: ok (that tile failed for a passing reason)', async () => {
    expect(await checkTile(URL, (async () => ({ status: 200 }) as Response) as typeof fetch)).toBe('ok');
  });
  it('no answer at all (no signal, a tunnel, a Wi-Fi asking to sign in): network, never a reason to change maps', async () => {
    const get = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await checkTile(URL, get as unknown as typeof fetch)).toBe('network');
    expect(get).toHaveBeenCalledTimes(2);   // the opaque request did not come either
  });
  it('an answer without the CORS headers (an error page; TomTom’s tiles always carry them): the opaque request comes → refused', async () => {
    const get = vi.fn(async (_u: string, o: RequestInit) => {
      if (o.mode === 'no-cors') return { status: 0, type: 'opaque' } as Response;
      throw new TypeError('Failed to fetch');
    });
    expect(await checkTile(URL, get as unknown as typeof fetch)).toBe('refused');
    expect((get.mock.calls[1] as unknown as [string, RequestInit])[1].mode).toBe('no-cors');
  });
  it('too slow: network (no second request), and the request is stopped', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const get = vi.fn((_u: string, o: RequestInit) => new Promise<Response>((_r, no) => { signal = o.signal!; o.signal!.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError'))); }));
      const p = checkTile(URL, get as unknown as typeof fetch, 3000);
      await vi.advanceTimersByTimeAsync(3001);
      expect(await p).toBe('network');
      expect(signal?.aborted).toBe(true);
      expect(get).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('the watch: the FIRST tile error asks one check (a small map has only 4 tiles); one at a time; refused → switch once, for good', () => {
    const w = tileWatch();
    expect(w.error(true, 0)).toBe(true);       // one error is enough to ask
    expect(w.error(true, 1)).toBe(false);      // a check is out: no second one
    expect(w.checked('refused', 2)).toBe(true);
    expect(w.down).toBe(true);
    expect(w.error(true, 3)).toBe(false);      // changed: nothing more to ask, no back and forth
    expect(w.checked('refused', 4)).toBe(false);
  });
  it('a tile loaded (maybe from the phone’s cache) proves nothing: errors are still checked; TomTom says ok → next check a minute later', () => {
    const w = tileWatch();
    expect(w.error(true, 0)).toBe(true);
    expect(w.checked('ok', 100)).toBe(false);
    expect(w.error(true, 100 + TILE_CHECK_EVERY - 1)).toBe(false);
    expect(w.error(true, 100 + TILE_CHECK_EVERY)).toBe(true);   // the month’s tiles ran out since: asked again
    expect(w.checked('refused', 100 + TILE_CHECK_EVERY + 5)).toBe(true);
  });
  it('no network at all: no check (OpenStreetMap would fail the same way); no answer → asked again a little later, no switch', () => {
    const w = tileWatch();
    for (let i = 0; i < 30; i++) expect(w.error(false, i)).toBe(false);
    expect(w.error(true, 50)).toBe(true);
    expect(w.checked('network', 60)).toBe(false);
    expect(w.down).toBe(false);
    expect(w.error(true, 60 + TILE_CHECK_RETRY - 1)).toBe(false);
    expect(w.error(true, 60 + TILE_CHECK_RETRY)).toBe(true);
  });
});
