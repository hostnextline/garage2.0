/* The tracking map: the tiles say where they are shown (client-page-15), the map draws the truck and the house, and a
   map that cannot load leaves the page without a broken box (client-page-22). */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
// without TomTom's key, whatever the shell says (VITE_TOMTOM_KEY): OpenStreetMap's tiles, as before
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), TOMTOM_KEY: '' }));
import TrackMap from './TrackMap';
import type { TrackView } from './track-state';

const box = document.createElement('div');
document.body.appendChild(box);
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
beforeAll(() => {
  // jsdom lays nothing out: give the map a phone-sized box so Leaflet asks its tiles
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});
afterEach(() => act(() => render(null, box)));

const view = (o: Partial<TrackView> = {}): TrackView => ({
  kind: 'active', mechanic: 'Sami', garage: { name: 'Garage', phone: null }, lang: 'fr',
  dest: { lat: 45.52, lng: -73.6 }, pos: { lat: 45.5, lng: -73.57, at: '2026-11-17T15:00:00Z' }, route: [],
  eta: null, ended: null, posMinute: null, destLabel: null, ...o
});

describe('the tracking map', () => {
  it('asks OpenStreetMap’s tiles with a Referer of the site only (the page itself sends none)', async () => {
    await act(async () => { render(<TrackMap view={view()} l="fr" />, box); });
    for (let i = 0; i < 20 && !box.querySelector('img.leaflet-tile'); i++) await wait(20);
    const tiles = [...box.querySelectorAll('img.leaflet-tile')] as HTMLImageElement[];
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.getAttribute('referrerpolicy') ?? t.referrerPolicy).toBe('strict-origin-when-cross-origin');
      expect(t.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    }
    expect(box.querySelector('.cl-dot')).toBeTruthy();       // the truck
    expect(box.querySelector('.cl-home')).toBeTruthy();      // the house
  });
  it('the truck’s position gone (the trip paused): the truck leaves the map, the house stays', async () => {
    await act(async () => { render(<TrackMap view={view()} l="fr" />, box); });
    for (let i = 0; i < 20 && !box.querySelector('.cl-dot'); i++) await wait(20);
    expect(box.querySelector('.cl-dot')).toBeTruthy();
    await act(async () => { render(<TrackMap view={view({ pos: null })} l="fr" />, box); });
    await wait();
    expect(box.querySelector('.cl-dot')).toBeNull();
    expect(box.querySelector('.cl-home')).toBeTruthy();
  });
  it('no road from the server: the truck and the house, and NO line between them (never a straight one)', async () => {
    await act(async () => { render(<TrackMap view={view()} l="fr" />, box); });
    for (let i = 0; i < 20 && !box.querySelector('.cl-dot'); i++) await wait(20);
    expect(box.querySelector('.cl-dot')).toBeTruthy();
    expect(box.querySelector('.cl-home')).toBeTruthy();
    expect(box.querySelector('path.cl-route')).toBeNull();
    expect(box.querySelector('path.cl-route-casing')).toBeNull();
    // the road arrives: it is drawn; it goes again (the server lost it): the line leaves
    const road: [number, number][] = [[45.5, -73.57], [45.51, -73.58], [45.52, -73.6]];
    await act(async () => { render(<TrackMap view={view({ route: road })} l="fr" />, box); });
    await wait();
    expect(box.querySelector('path.cl-route')).toBeTruthy();
    expect(box.querySelector('path.cl-route')!.getAttribute('stroke-dasharray')).toBeNull();
    await act(async () => { render(<TrackMap view={view({ route: [] })} l="fr" />, box); });
    await wait();
    expect(box.querySelector('path.cl-route')).toBeNull();
    expect(box.querySelector('path.cl-route-casing')).toBeNull();
  });
  it('fits the trip once, then keeps its zoom while the truck moves (no zoom in and out at each position)', async () => {
    // a route that goes east first: the whole trip is wider than the truck and the house
    const route: [number, number][] = [[45.5, -73.57], [45.5, -73.5], [45.52, -73.5], [45.52, -73.6]];
    const zooms = () => new Set([...box.querySelectorAll('img.leaflet-tile')].map((t) => (t as HTMLImageElement).src.split('/')[3]));
    await act(async () => { render(<TrackMap view={view({ route, pos: { lat: 45.5, lng: -73.57, at: '2026-11-17T15:00:00Z' } })} l="fr" />, box); });
    for (let i = 0; i < 20 && !box.querySelector('img.leaflet-tile'); i++) await wait(20);
    const first = zooms();
    expect(first.size).toBe(1);
    // he comes near the house (the old map zoomed in on the truck and the house at each position)
    for (const [k, lng] of [[1, -73.58], [2, -73.59], [3, -73.595]] as [number, number][]) {
      await act(async () => { render(<TrackMap view={view({ route, pos: { lat: 45.52, lng, at: `2026-11-17T15:00:${String(k * 10).padStart(2, '0')}Z` } })} l="fr" />, box); });
      await wait(30);
    }
    expect(zooms()).toEqual(first);
    expect(box.querySelectorAll('.cl-dot')).toHaveLength(1);
  });
  it('the truck near the edge: a gentle pan that brings it back in view with the house, same zoom', async () => {
    // a short route (111 m) under the house: the first view is close; then the truck turns 230 m east, to the edge
    const route: [number, number][] = [[45.519, -73.6], [45.52, -73.6]];
    // where Leaflet put the map's pane (it moves the pane to pan)
    const pane = () => { const q = (box.querySelector('.leaflet-map-pane') as HTMLElement & { _leaflet_pos?: { x: number; y: number } })._leaflet_pos; return q ? `${q.x},${q.y}` : '0,0'; };
    const zooms = () => new Set([...box.querySelectorAll('img.leaflet-tile')].map((t) => (t as HTMLImageElement).src.split('/')[3]));
    await act(async () => { render(<TrackMap view={view({ route, pos: { lat: 45.519, lng: -73.6, at: '2026-11-17T15:00:00.000Z' } })} l="fr" />, box); });
    for (let i = 0; i < 20 && !box.querySelector('img.leaflet-tile'); i++) await wait(20);
    const before = pane(), z = zooms();
    await act(async () => { render(<TrackMap view={view({ route, pos: { lat: 45.519, lng: -73.597, at: '2026-11-17T15:00:00.500Z' } })} l="fr" />, box); });
    for (let i = 0; i < 60 && pane() === before; i++) await wait(50);     // the 1 s glide reaches the edge, then the pan
    expect(pane()).not.toBe(before);
    await wait(1300);
    const x = Number(pane().split(',')[0]) - Number(before.split(',')[0]);
    expect(x).toBeLessThan(-40);                                         // the map went left: the truck back toward the middle
    expect(zooms()).toEqual(z);
  });
});
