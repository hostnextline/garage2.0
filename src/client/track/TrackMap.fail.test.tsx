/* The map's library cannot load (weak signal, an old phone): no empty grey box stays over the page (client-page-22). */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import TrackMap from './TrackMap';

vi.mock('leaflet', () => { throw new Error('the map file did not arrive'); });

describe('the tracking map without its library', () => {
  it('draws nothing instead of an empty box', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    await act(async () => {
      render(<TrackMap l="fr" view={{ kind: 'active', mechanic: 'Sami', garage: { name: null, phone: null }, lang: 'fr', dest: { lat: 45.52, lng: -73.6 }, pos: null, route: [], eta: null, ended: null, posMinute: null, destLabel: null }} />, box);
    });
    for (let i = 0; i < 20 && box.querySelector('[data-testid="track-map"]'); i++) await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    expect(box.querySelector('[data-testid="track-map"]')).toBeNull();
    await act(() => { render(null, box); });
  });
});
