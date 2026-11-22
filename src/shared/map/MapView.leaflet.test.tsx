/* MapView with TomTom's key on the REAL Leaflet (review-maps H1, M1, L1): the small maps of the phone (Réglages → Départ,
   a booking preview, « Choisir sur la carte »: one stop, 4 tiles) change to OpenStreetMap's tiles when TomTom refuses
   them; a tile the phone kept in its cache does not hide the refusal; a network that lets nothing through is never taken
   for a refusal. The decision is TomTom's own answer to ONE plain request of a failed tile (fetch is pretended here). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), TOMTOM_KEY: 'KEY' }));
import { MapView, forgetTiles } from './MapView';

const box = document.createElement('div');
document.body.appendChild(box);
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const tiles = () => [...box.querySelectorAll('img.leaflet-tile')] as HTMLImageElement[];
const tomtom = () => tiles().filter((t) => /api\.tomtom\.com/.test(t.src));
const osm = () => tiles().filter((t) => /tile\.openstreetmap\.org/.test(t.src));
const credit = () => box.querySelector('.leaflet-control-attribution')?.textContent || '';
const STOP = [{ id: 'j1', kind: 'job' as const, lat: 45.51, lng: -73.61, number: 1 }];

/** a map of this size on screen, with one stop (shown at zoom 14 or more: 2 × 2 tiles on a phone) */
async function openAt(w: number, h: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(w);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(h);
  await act(async () => { render(<MapView markers={STOP} height={`${h}px`} controls={false} />, box); });
  for (let i = 0; i < 40 && !tiles().length; i++) await wait(20);
  await wait(30);
}
/** TomTom refuses every tile on screen (the pictures fail) */
function refuseAll() { for (const t of tomtom()) t.dispatchEvent(new Event('error')); }
/** TomTom answers the plain request with this status (with its CORS headers, as its 401 does) */
function tomtomSays(status: number) {
  const f = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => forgetTiles());
afterEach(async () => { await act(async () => { render(null, box); }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the small maps of a phone, TomTom refusing its tiles', () => {
  for (const [w, h, where] of [[328, 220, 'Réglages → Départ, a booking preview (220 px)'], [328, 340, 'a booking moment, the day’s route (340 px)']] as const) {
    it(`${where}: 4 tiles refused → OpenStreetMap’s streets and credit, never a blank map`, async () => {
      const f = tomtomSays(403);
      await openAt(w, h);
      expect(tomtom().length).toBeGreaterThan(0);
      expect(tomtom().length).toBeLessThan(6);         // fewer tiles than the old « 6 errors » could ever see
      refuseAll();
      await wait(30);
      expect(f).toHaveBeenCalledTimes(1);              // one plain request decides, not one per tile
      expect(tomtom()).toHaveLength(0);
      expect(osm().length).toBeGreaterThan(0);
      expect(credit()).toContain('OpenStreetMap');
      expect(credit()).not.toContain('TomTom');
    });
  }
  it('a tile the phone kept (the service worker’s cache) loads, the others are refused: still OpenStreetMap’s', async () => {
    const f = tomtomSays(403);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1024);
    await act(async () => { render(<MapView markers={STOP} height="1024px" full />, box); });
    for (let i = 0; i < 40 && !tiles().length; i++) await wait(20);
    await wait(30);
    const all = tomtom();
    const failedUrl = all[1].src;                        // Leaflet blanks a tile it takes away
    all[0].dispatchEvent(new Event('load'));             // the one tile still in the cache
    for (const t of all.slice(1)) t.dispatchEvent(new Event('error'));
    await wait(30);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(failedUrl);   // the failed tile itself (never in the cache)
    expect(tomtom()).toHaveLength(0);
    expect(osm().length).toBeGreaterThan(0);
  });
  it('TomTom refuses without its CORS headers: the opaque request comes back → OpenStreetMap’s', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o: RequestInit) => {
      if (o.mode === 'no-cors') return { status: 0, type: 'opaque' } as Response;
      throw new TypeError('Failed to fetch');
    }));
    await openAt(328, 220);
    refuseAll();
    await wait(30);
    expect(tomtom()).toHaveLength(0);
    expect(osm().length).toBeGreaterThan(0);
  });
  it('online but nothing passes (a tunnel, a Wi-Fi asking to sign in): TomTom’s tiles stay, no switch for the visit', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', f);
    await openAt(328, 220);
    refuseAll();
    await wait(30);
    expect(f).toHaveBeenCalled();
    expect(osm()).toHaveLength(0);
    expect(tomtom().length).toBeGreaterThan(0);
    // the next map of the visit still takes TomTom's
    await act(async () => { render(null, box); });
    await openAt(328, 220);
    expect(tomtom().length).toBeGreaterThan(0);
  });
  it('TomTom serves the tile (a passing failure): TomTom’s tiles stay', async () => {
    tomtomSays(200);
    await openAt(328, 220);
    refuseAll();
    await wait(30);
    expect(osm()).toHaveLength(0);
    expect(tomtom().length).toBeGreaterThan(0);
  });
});
