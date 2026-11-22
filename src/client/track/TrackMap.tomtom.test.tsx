/* The customer's tracking map WITH TomTom's key (review F3, F13, F15, review-maps H1 L1), on the real Leaflet: TomTom's
   tiles with the site's address; refused (TomTom's own answer to ONE plain request of a failed tile: 401 / 403 / 429…)
   → OpenStreetMap's tiles and credit, once, even on a small map of a few tiles; no network at all, or a network that lets
   nothing through, is not a reason; the old server's two-point « road » is never drawn. */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), TOMTOM_KEY: 'KEY' }));
import TrackMap, { forgetTiles } from './TrackMap';
import type { TrackView } from './track-state';

const box = document.createElement('div');
document.body.appendChild(box);
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
beforeAll(() => {
  // a small box (a phone held sideways, the card over the map): only a few tiles, the decision must not need many
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(328);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(220);
});
beforeEach(() => forgetTiles());
/** TomTom answers the plain request of a tile with this status (with its CORS headers, as its 401 does) */
function tomtomSays(status: number) {
  const f = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal('fetch', f);
  return f;
}
afterEach(async () => { vi.unstubAllGlobals(); await act(() => render(null, box)); });

const view = (o: Partial<TrackView> = {}): TrackView => ({
  kind: 'active', mechanic: 'Sami', garage: { name: 'Garage', phone: null }, lang: 'fr',
  dest: { lat: 45.52, lng: -73.6 }, pos: { lat: 45.5, lng: -73.57, at: '2026-11-17T15:00:00Z' }, route: [],
  eta: null, ended: null, posMinute: null, destLabel: null, ...o
});
const tiles = () => [...box.querySelectorAll('img.leaflet-tile')] as HTMLImageElement[];
const credit = () => box.querySelector('.leaflet-control-attribution')?.textContent || '';
async function shown() {
  await act(async () => { render(<TrackMap view={view()} l="fr" />, box); });
  for (let i = 0; i < 30 && !tiles().length; i++) await wait(20);
}
/** TomTom refuses every tile on screen (a key refused answers 401: the picture fails) */
function refuseAll() { for (const t of tiles()) if (/api\.tomtom\.com/.test(t.src)) t.dispatchEvent(new Event('error')); }

describe('the tracking map with TomTom’s key', () => {
  it('asks TomTom’s tiles with the site’s address, and credits TomTom and OpenStreetMap', async () => {
    await shown();
    expect(tiles().length).toBeGreaterThan(0);
    for (const t of tiles()) {
      expect(t.src).toMatch(/^https:\/\/api\.tomtom\.com\/map\/1\/tile\/basic\/main\/\d+\/\d+\/\d+\.png\?key=KEY&tileSize=256$/);
      expect(t.getAttribute('referrerpolicy') ?? t.referrerPolicy).toBe('strict-origin-when-cross-origin');
    }
    expect(credit()).toContain('TomTom');
    expect(credit()).toContain('OpenStreetMap');
  });
  it('TomTom refuses its tiles: OpenStreetMap’s streets and credit, never a blank map; no back and forth', async () => {
    const f = tomtomSays(403);
    await shown();
    expect(tiles().length).toBeGreaterThan(0);
    expect(tiles().length).toBeLessThan(6);   // a small map: the old « 6 errors » never came
    refuseAll();
    await wait(20);
    expect(f).toHaveBeenCalledTimes(1);
    const [u, o] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toMatch(/^https:\/\/api\.tomtom\.com\/map\//);
    expect(o.referrerPolicy).toBe('strict-origin-when-cross-origin');   // the page itself sends no Referer
    expect(o.credentials).toBe('omit');
    const now = tiles();
    expect(now.length).toBeGreaterThan(0);
    for (const t of now) expect(t.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    expect(credit()).toContain('OpenStreetMap');
    expect(credit()).not.toContain('TomTom');
    // the same page draws the map again: OpenStreetMap's at once
    await act(async () => { render(null, box); });
    await shown();
    for (const t of tiles()) expect(t.src).toMatch(/tile\.openstreetmap\.org/);
  });
  it('no network at all: the failed tiles are not a reason to change (TomTom’s stay), nothing is asked', async () => {
    const f = tomtomSays(403);
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await shown();
    refuseAll();
    await wait(20);
    expect(f).not.toHaveBeenCalled();
    expect(tiles().length).toBeGreaterThan(0);
    for (const t of tiles()) expect(t.src).toMatch(/api\.tomtom\.com/);
  });
  it('online but nothing passes (a tunnel, a Wi-Fi asking to sign in): TomTom’s stay, the page does not give up on them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await shown();
    refuseAll();
    await wait(20);
    for (const t of tiles()) expect(t.src).toMatch(/api\.tomtom\.com/);
    await act(async () => { render(null, box); });
    await shown();
    for (const t of tiles()) expect(t.src).toMatch(/api\.tomtom\.com/);
  });
  it('the old server’s two-point « road »: no line (never that straight line); a real road: drawn', async () => {
    await act(async () => { render(<TrackMap view={view({ route: [[45.5, -73.57], [45.52, -73.6]] })} l="fr" />, box); });
    for (let i = 0; i < 30 && !box.querySelector('.cl-dot'); i++) await wait(20);
    expect(box.querySelector('.cl-dot')).toBeTruthy();
    expect(box.querySelector('path.cl-route')).toBeNull();
    expect(box.querySelector('path.cl-route-casing')).toBeNull();
    await act(async () => { render(<TrackMap view={view({ route: [[45.5, -73.57], [45.51, -73.58], [45.52, -73.6]] })} l="fr" />, box); });
    await wait();
    expect(box.querySelector('path.cl-route')).toBeTruthy();
  });
});
