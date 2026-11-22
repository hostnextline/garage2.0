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
});
