/* MapView against a pretend Leaflet: what is created, updated and removed, so a refresh of the team map does not draw
   everything again, and nothing of the map is left behind when the screen goes. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const log: string[] = [];
let mapsAlive = 0;
let removeThrows = false;
const tiles: Record<string, unknown>[] = [];
// without TomTom's key, whatever the shell says (VITE_TOMTOM_KEY): the tiles of these tests are OpenStreetMap's
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), TOMTOM_KEY: '' }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const chain = <T extends object>(o: T) => Object.assign(o, { addTo() { return o; } });
  const L = {
    Browser: { mobile: false },
    DomEvent: { stopPropagation: () => undefined },
    map: () => {
      mapsAlive++;
      const handlers: Record<string, () => void> = {};
      return {
        setView() { log.push('fit'); }, fitBounds() { log.push('fit'); }, getZoom: () => 11, invalidateSize() { /* pretend */ },
        on(k: string, f: () => void) { handlers[k] = f; }, off() { log.push('off'); }, remove() { mapsAlive--; log.push('remove'); if (removeThrows) throw new Error('zoom animation'); },
        getContainer: () => ({ clientWidth: 400, clientHeight: 300 }),
        scrollWheelZoom: { enable() { /* */ }, disable() { /* */ } }, dragging: { enable() { /* */ }, disable() { /* */ } }
      };
    },
    control: { attribution: () => chain({}), zoom: () => chain({ remove() { /* */ } }) },
    tileLayer: (url: string, o: Record<string, unknown>) => { tiles.push({ url, ...o }); return chain({}); },
    layerGroup: () => chain({ clearLayers() { log.push('clear'); } }),
    divIcon: (o: { html: string }) => o,
    latLngBounds: (p: unknown) => p,
    marker: (_at: unknown, o: { icon: { html: string } }) => {
      log.push(`marker:${/data-mk="([^"]+)"/.exec(o.icon.html)?.[1]}`);
      return chain({ on() { /* */ }, remove() { log.push('marker-remove'); }, setIcon() { log.push('setIcon'); }, setLatLng() { log.push('move'); }, setZIndexOffset() { /* */ } });
    },
    polyline: (_p: unknown, o: { className?: string; color?: string }) => {
      const name = `${o.className === 'mv-casing' ? 'casing' : 'stroke'}:${o.color || ''}`;
      log.push('line');
      return chain({ remove() { log.push('line-remove'); }, setLatLngs() { log.push('line-points'); }, setStyle() { log.push('line-style'); }, bringToFront() { log.push(`front:${name}`); } });
    }
  };
  return { default: L };
});
import { MapView, tilesFor, type MapMarker, type MapLine } from './MapView';

const box = document.createElement('div');
document.body.appendChild(box);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const person = (sub: string, lat = 45.5): MapMarker => ({ id: 'p:adam', kind: 'person', lat, lng: -73.6, label: 'Adam', sub, title: 'Adam' });
const stops = (): MapMarker[] => [{ id: 'j1', kind: 'job', lat: 45.51, lng: -73.61, number: 1, title: 'Arrêt 1', onClick: () => undefined }, { id: 'j2', kind: 'job', lat: 45.52, lng: -73.62, number: 2, title: 'Arrêt 2', onClick: () => undefined }];
const road: [number, number][] = [[45.51, -73.61], [45.515, -73.615], [45.52, -73.62]];

describe('MapView', () => {
  beforeEach(() => { log.length = 0; });
  it('draws once, then only what changed: « il y a 4 min » is a new icon for that dot, a move is a move, nothing else is touched', async () => {
    const lines = (): MapLine[] => [{ points: road, color: '#D3000E' }];
    await act(async () => { render(<MapView markers={[...stops(), person('il y a 3 min')]} lines={lines()} refit="focus" />, box); });
    await settle();
    expect(log.filter((x) => x.startsWith('marker:'))).toEqual(['marker:j1', 'marker:j2', 'marker:p:adam']);
    expect(log.filter((x) => x === 'line')).toHaveLength(2);   // casing + line
    log.length = 0;
    // the parent draws again with new arrays of the same things
    await act(async () => { render(<MapView markers={[...stops(), person('il y a 3 min')]} lines={lines()} refit="focus" />, box); });
    expect(log).toEqual([]);
    await act(async () => { render(<MapView markers={[...stops(), person('il y a 4 min')]} lines={lines()} refit="focus" />, box); });
    expect(log).toEqual(['setIcon']);
    log.length = 0;
    await act(async () => { render(<MapView markers={[...stops(), person('il y a 4 min', 45.501)]} lines={lines()} refit="focus" />, box); });
    expect(log).toEqual(['move']);
  });
  it('a new marker on the team map after the person moved the map: added, the view stays; « Recentrer » fits again', async () => {
    box.querySelector('.mv')!.dispatchEvent(new Event('pointerdown'));
    log.length = 0;
    const more: MapMarker[] = [...stops(), person('il y a 4 min', 45.501), { id: 'p:saleh', kind: 'person', lat: 45.4, lng: -73.7, title: 'Saleh' }];
    await act(async () => { render(<MapView markers={more} refit="focus" />, box); });
    expect(log).toContain('marker:p:saleh');
    expect(log).not.toContain('fit');
    expect(log.filter((x) => x === 'line-remove')).toHaveLength(2);   // the line asked no more is taken off
    log.length = 0;
    await act(async () => { render(<MapView markers={more} refit="focus" fitKey={1} />, box); });
    expect(log).toEqual(['fit']);
  });
  it('the screen goes: the map, its layers and its listeners go with it', async () => {
    expect(mapsAlive).toBe(1);
    await act(async () => { render(null, box); });
    expect(mapsAlive).toBe(0);
    expect(log).toEqual(expect.arrayContaining(['clear', 'off', 'remove']));
  });
  it('a line that becomes dashed is drawn again, and the lines after it go back on top of it, in order (mh-9)', async () => {
    const a: [number, number][] = [[45.5, -73.6], [45.51, -73.61]];
    const b: [number, number][] = [[45.52, -73.62], [45.53, -73.63]];
    const lines = (dashed: boolean): MapLine[] => [{ points: a, color: '#2F6FD0', dashed }, { points: b, color: '#D3000E' }];
    await act(async () => { render(<MapView markers={stops()} lines={lines(false)} />, box); });
    await settle();
    log.length = 0;
    await act(async () => { render(<MapView markers={stops()} lines={lines(true)} />, box); });
    expect(log.filter((x) => x === 'line')).toHaveLength(2);   // only the first line is made again
    expect(log.filter((x) => x.startsWith('front:'))).toEqual(['front:casing:', 'front:stroke:#D3000E']);
    await act(async () => { render(null, box); });
  });
  it('the streets are asked with CORS, so the « tuiles » cache can keep them for a map seen without signal (R127)', async () => {
    tiles.length = 0;
    await act(async () => { render(<MapView markers={stops()} />, box); });
    await settle();
    expect(tiles).toHaveLength(1);
    expect(tiles[0].url).toMatch(/tile\.openstreetmap\.org/);
    expect(tiles[0].crossOrigin).toBe('anonymous');
    await act(async () => { render(null, box); });
  });
  it('with TomTom’s key the map is TomTom’s (asked with CORS and the site’s address); without it, OpenStreetMap’s as before', () => {
    const tt = tilesFor('KEY');
    expect(tt.url).toBe('https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=KEY&tileSize=256');
    expect(tt.options).toMatchObject({ crossOrigin: 'anonymous', referrerPolicy: 'strict-origin-when-cross-origin', maxZoom: 19 });
    expect(String(tt.options.attribution)).toContain('TomTom');
    const osm = tilesFor('');
    expect(osm.url).toMatch(/tile\.openstreetmap\.org/);
    expect(osm.options).toMatchObject({ crossOrigin: 'anonymous', subdomains: 'abc' });
  });
  it('Leaflet throws while the map is removed: the screen still goes (mh-7)', async () => {
    await act(async () => { render(<MapView markers={stops()} />, box); });
    await settle();
    removeThrows = true;
    try {
      await act(async () => { render(null, box); });
      expect(log).toContain('remove');
    } finally { removeThrows = false; }
  });
});
