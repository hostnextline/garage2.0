/* MapView with TomTom's key (review F3, review-maps H1 M1 L1): a TomTom tile fails → ONE plain request of that tile asks
   TomTom; it refuses (401 / 403 / 429…) → OpenStreetMap's tiles with OpenStreetMap's credit, on every map open, once; a
   tile shown (maybe from the phone's cache) proves nothing; no network, or a network that lets nothing through, never
   switches; TomTom serving the tile → no switch, the next check a minute later; the maps opened after the switch take
   OpenStreetMap's at once (never back and forth). Against a pretend Leaflet whose tile layers fire « tileerror » /
   « tileload » on demand, and a pretend fetch. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

interface Layer { url: string; o: Record<string, unknown>; on: Record<string, (e?: unknown) => void>; removed: boolean; fire: (ev: string) => void }
const layers: Layer[] = [];
const TILE = 'https://api.tomtom.com/map/1/tile/basic/main/14/4850/5860.png?key=KEY&tileSize=256';
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), TOMTOM_KEY: 'KEY' }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const chain = <T extends object>(o: T) => Object.assign(o, { addTo() { return o; } });
  const L = {
    Browser: { mobile: false },
    DomEvent: { stopPropagation: () => undefined },
    map: () => {
      const unload: (() => void)[] = [];
      return {
        setView() { /* */ }, fitBounds() { /* */ }, getZoom: () => 11, invalidateSize() { /* */ },
        on(ev: string, f: () => void) { if (ev === 'unload') unload.push(f); },
        // as the real Leaflet: off() with no type drops EVERY listener of the map, « unload » included (the screen's cleanup
        // calls it before remove(): a pretend map that kept them hid the bug e2e-routes B1)
        off(ev?: string) { if (!ev) unload.length = 0; },
        remove() { for (const f of unload) f(); },
        getContainer: () => ({ clientWidth: 400, clientHeight: 300 }),
        scrollWheelZoom: { enable() { /* */ }, disable() { /* */ } }, dragging: { enable() { /* */ }, disable() { /* */ } }
      };
    },
    control: { attribution: () => chain({}), zoom: () => chain({ remove() { /* */ } }) },
    tileLayer: (url: string, o: Record<string, unknown>) => {
      const l: Layer = {
        url, o, on: {}, removed: false,
        fire(ev) { if (!l.removed) l.on[ev]?.({ tile: { src: url.replace('{z}/{x}/{y}', '14/4850/5860') }, coords: { x: 4850, y: 5860, z: 14 } }); }
      };
      layers.push(l);
      return chain({
        on(ev: string, f: () => void) { l.on[ev] = f; return this; },
        off(evs?: string) { if (!evs) throw new Error('off() with no type also removes Leaflet’s own listeners (the credit)'); for (const e of evs.split(' ')) delete l.on[e]; return this; },
        remove() { l.removed = true; return this; }
      });
    },
    layerGroup: () => chain({ clearLayers() { /* */ } }),
    divIcon: (o: unknown) => o,
    latLngBounds: (p: unknown) => p,
    marker: () => chain({ on() { /* */ }, remove() { /* */ }, setIcon() { /* */ }, setLatLng() { /* */ }, setZIndexOffset() { /* */ } }),
    polyline: () => chain({ remove() { /* */ }, setLatLngs() { /* */ }, setStyle() { /* */ }, bringToFront() { /* */ } })
  };
  return { default: L };
});
import { MapView, forgetTiles } from './MapView';
import { TILE_CHECK_EVERY } from '../../lib/tomtom';

const box = document.createElement('div');
document.body.appendChild(box);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const STOP = [{ id: 'j1', kind: 'job' as const, lat: 45.51, lng: -73.61, number: 1 }];
const open = async () => { await act(async () => { render(<MapView markers={STOP} />, box); }); await settle(); };
const last = () => layers[layers.length - 1];
const errors = (l: Layer, n: number) => { for (let i = 0; i < n; i++) l.fire('tileerror'); };
/** TomTom answers the plain request of a tile with this status */
function tomtomSays(status: number) {
  const f = vi.fn(async (_u: string, _o?: RequestInit) => ({ status }) as Response);
  vi.stubGlobal('fetch', f);
  return f;
}

describe('TomTom’s tiles refused: the map changes to OpenStreetMap’s, never stays blank', () => {
  beforeEach(() => { layers.length = 0; forgetTiles(); });
  afterEach(async () => { await act(async () => { render(null, box); }); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('ONE tile error asks TomTom once (that tile, the site’s address); it refuses: OpenStreetMap’s tiles and credit, once', async () => {
    const f = tomtomSays(403);
    await open();
    expect(layers).toHaveLength(1);
    const tt = layers[0];
    expect(tt.url).toMatch(/^https:\/\/api\.tomtom\.com\/map\//);
    errors(tt, 3);
    expect(f).toHaveBeenCalledTimes(1);              // one check at a time, not one per tile
    expect(f.mock.calls[0][0]).toBe(TILE);
    expect(f.mock.calls[0][1]).toMatchObject({ mode: 'cors', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
    await settle();
    expect(layers).toHaveLength(2);
    expect(tt.removed).toBe(true);
    expect(last().url).toMatch(/tile\.openstreetmap\.org/);
    expect(String(last().o.attribution)).toContain('OpenStreetMap');
    expect(String(last().o.attribution)).not.toContain('TomTom');
    expect(last().o.crossOrigin).toBe('anonymous');  // still kept by the « tuiles » cache for a map seen without signal
    errors(tt, 20);
    await settle();
    expect(layers).toHaveLength(2);                 // no back and forth, never a third layer
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('the maps opened after the switch take OpenStreetMap’s at once (no blank map on each screen)', async () => {
    tomtomSays(401);
    await open();
    errors(layers[0], 1);
    await settle();
    await act(async () => { render(null, box); });
    layers.length = 0;
    await open();
    expect(layers).toHaveLength(1);
    expect(layers[0].url).toMatch(/tile\.openstreetmap\.org/);
  });
  it('two maps on screen: one check, both change', async () => {
    const f = tomtomSays(429);
    await act(async () => { render(<div><MapView markers={STOP} /><MapView markers={STOP} /></div>, box); });
    await settle();
    expect(layers).toHaveLength(2);
    errors(layers[0], 1);
    errors(layers[1], 1);
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(layers[0].removed && layers[1].removed).toBe(true);
    expect(layers.slice(2).map((l) => /openstreetmap/.test(l.url))).toEqual([true, true]);
  });
  it('a map closed while TomTom is being asked: nothing is added to it', async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { answer = r; })));
    await open();
    errors(layers[0], 1);
    await act(async () => { render(null, box); });
    answer({ status: 403 } as Response);
    await settle();
    expect(layers).toHaveLength(1);
  });
  it('a map closed EARLIER in the visit is forgotten: when TomTom then refuses, the map on screen changes (e2e-routes B1)', async () => {
    tomtomSays(401);
    await open();
    await act(async () => { render(null, box); });          // the first screen closes: its map is gone
    await open();                                           // another screen, another map
    expect(layers).toHaveLength(2);
    errors(layers[1], 1);
    await settle();
    expect(layers[1].removed).toBe(true);
    expect(layers).toHaveLength(3);                         // one OpenStreetMap layer, on the map on screen only
    expect(layers[2].url).toMatch(/openstreetmap/);
    expect(layers[0].removed).toBe(false);                  // nothing was done to the map already gone
  });
  it('a tile shown (maybe from the phone’s cache) proves nothing: a later error is still checked', async () => {
    const f = tomtomSays(403);
    await open();
    last().fire('tileload');
    errors(last(), 1);
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(layers).toHaveLength(2);
    expect(last().url).toMatch(/tile\.openstreetmap\.org/);
  });
  it('TomTom serves the tile: no switch; asked again only a minute later (the month’s tiles may have run out since)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = tomtomSays(200);
    await open();
    errors(last(), 1);
    await settle();
    expect(layers).toHaveLength(1);
    errors(last(), 10);
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + TILE_CHECK_EVERY);
    f.mockImplementation(async () => ({ status: 403 }) as Response);
    errors(last(), 1);
    await settle();
    expect(f).toHaveBeenCalledTimes(2);
    expect(layers).toHaveLength(2);
    expect(last().url).toMatch(/tile\.openstreetmap\.org/);
  });
  it('errors while the phone has no network at all: nothing asked, no switch', async () => {
    const f = tomtomSays(403);
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await open();
    errors(last(), 40);
    await settle();
    expect(f).not.toHaveBeenCalled();
    expect(layers).toHaveLength(1);
  });
  it('online but nothing passes (a tunnel, a captive Wi-Fi): no switch for the visit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await open();
    errors(last(), 6);
    await settle();
    expect(layers).toHaveLength(1);
    expect(layers[0].removed).toBe(false);
  });
  it('with the key, TomTom’s tiles credit TomTom and OpenStreetMap (the roads may be OSRM’s)', async () => {
    await open();
    expect(String(layers[0].o.attribution)).toMatch(/TomTom.*OpenStreetMap/);
    expect(layers[0].o.referrerPolicy).toBe('strict-origin-when-cross-origin');
  });
});
