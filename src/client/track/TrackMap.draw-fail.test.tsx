/* The map's library loads but throws while drawing (a Leaflet error on the truck's marker): the map goes away, the
   tracking card (time of arrival, the call button) stays. Before, the Guard around the whole page caught the error of
   the map's effect and the customer read « Un problème est survenu » instead of the card (client-r2-1). */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { TrackAnswer } from '../api';

vi.mock('leaflet', async (orig) => {
  const real = await orig<typeof import('leaflet') & { default?: typeof import('leaflet') }>();
  const L = real.default ?? real;
  const marker = () => { throw new Error('Leaflet: invalid LatLng'); };
  return { ...real, marker, default: { ...L, marker } };
});
vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  const active: TrackAnswer = {
    status: 'active', garage: { name: 'Garage', phone: '438 901-6606' }, mechanic: 'Sami', lang: 'fr',
    dest: { lat: 45.52, lng: -73.6 }, pos: { lat: 45.5, lng: -73.57, at: new Date().toISOString() }, route: [], eta_at: new Date(Date.now() + 12 * 60000).toISOString(), now: new Date().toISOString()
  };
  return { ...real, callTrack: async () => active };
});
import { Guard } from '../guard';
import { TrackPage } from './TrackPage';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});
afterEach(() => act(() => render(null, box)));

describe('the tracking map that throws while drawing (client-r2-1)', () => {
  it('hides the map and keeps the tracking card, never « Un problème est survenu »', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => { render(<Guard><TrackPage token="TRIP-token-123456" linkLang={null} onLang={() => undefined} /></Guard>, box); });
    // the map's file comes after the card (a grey box meanwhile), then Leaflet draws: wait until the box is gone
    const mapBox = () => box.querySelector('.cl-map');
    for (let i = 0; i < 150 && (mapBox() || !q('track-eta')) && !q('client-error-server'); i++) await wait(20);
    expect(q('client-error-server')).toBeNull();
    expect(q('track-map')).toBeNull();
    expect(box.querySelector('.cl-map'), 'no grey box left over the page').toBeNull();
    expect(q('track-eta')).toBeTruthy();
    expect(q('track-headline')?.textContent).toContain('Sami');
    expect(q('client-call')?.getAttribute('href')).toMatch(/^tel:/);
    err.mockRestore();
  });
});
