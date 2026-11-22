/* What one address typed in the team's address field costs in requests (TomTom's free amount: 20 000 address lookups a
   month): the real field, the real search and lookup, only the two map services pretended (review F6). The person types
   « 8255 av mountain sights, montréal » in four bursts (a pause after each word group: the field asks 300 ms after the
   last key), leaves the field (the position is looked up), then saves (withPosition). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const env = vi.hoisted(() => ({ key: 'KEY' }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), get TOMTOM_KEY() { return env.key; } }));

import { lang } from '../../lib/i18n';
import { AddressField, EMPTY_PLACE, type PlaceValue } from './AddressField';
import { withPosition } from './withPosition';
import { forgetPlaces } from './places';

const TT_DOOR = { results: [{ type: 'Point Address', address: { streetNumber: '8255', streetName: 'Avenue Mountain Sights', municipality: 'Montréal', neighbourhood: 'Snowdon', countrySubdivisionCode: 'QC', postalCode: 'H4P', extendedPostalCode: 'H4P 2B5', countryCode: 'CA' }, position: { lat: 45.5005053, lon: -73.6577429 } }] };
const TT_STREET = { results: [{ type: 'Street', address: { streetName: 'Avenue Mountain Sights', municipality: 'Montréal', neighbourhood: 'Snowdon', countrySubdivisionCode: 'QC', postalCode: 'H4P', countryCode: 'CA' }, position: { lat: 45.4974127, lon: -73.6538718 } }] };
const PH_DOOR = { features: [{ geometry: { coordinates: [-73.6577, 45.5005] }, properties: { housenumber: '8255', street: 'Avenue Mountain Sights', city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H4P 2B5', osm_key: 'building', type: 'house' } }] };

const count = { tomtom: 0, photon: 0 };
function services(tomtom: { status?: number; body?: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (new URL(url).hostname === 'api.tomtom.com') { count.tomtom++; return { ok: (tomtom.status ?? 200) < 400, status: tomtom.status ?? 200, json: async () => tomtom.body ?? {} }; }
    count.photon++;
    return { ok: true, status: 200, json: async () => PH_DOOR };
  }));
}

const box = document.createElement('div');
document.body.appendChild(box);
let place: PlaceValue = EMPTY_PLACE;
function Form() {
  const [v, setV] = useState<PlaceValue>(EMPTY_PLACE);
  place = v;
  return <AddressField value={v} onValue={setV} />;
}
const input = () => box.querySelector('[data-testid="address-input"]') as HTMLInputElement;
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/** types the address in four bursts, leaves the field, saves; the requests of each part */
async function typeOneAddress() {
  await act(() => render(<Form />, box));
  for (const text of ['8255 av', '8255 av mountain', '8255 av mountain sights', '8255 av mountain sights, montréal']) {
    await act(() => { input().focus(); input().value = text; input().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); });
    await wait(400);
  }
  const typing = { ...count };
  await act(() => { input().blur(); });
  await wait(100);
  const saved = await withPosition(place);
  return { typing, all: { ...count }, saved };
}

beforeEach(() => { lang.value = 'fr'; count.tomtom = 0; count.photon = 0; env.key = 'KEY'; place = EMPTY_PLACE; forgetPlaces(); });
afterEach(async () => { await act(() => render(null, box)); vi.unstubAllGlobals(); });

describe('one address typed: the requests it costs', () => {
  it('TomTom knows the door: one TomTom lookup a pause; Photon only while the street is not typed yet', async () => {
    services({ body: TT_DOOR });
    const r = await typeOneAddress();
    expect(r.typing).toEqual({ tomtom: 4, photon: 1 });              // « 8255 av »: no street yet, so Photon too
    expect(r.all).toEqual({ tomtom: 4, photon: 1 });                 // leaving and saving: from memory
    expect(r.saved).toMatchObject({ lat: 45.5005053 });
  });
  it('TomTom knows only the street: TomTom and Photon each pause, and the position is found (Photon’s door)', async () => {
    services({ body: TT_STREET });
    const r = await typeOneAddress();
    expect(r.all).toEqual({ tomtom: 4, photon: 4 });
    expect(r.saved).toMatchObject({ lat: 45.5005, lng: -73.6577 });
  });
  it('TomTom refuses the key: asked once, then it rests and Photon alone answers', async () => {
    services({ status: 403 });
    const r = await typeOneAddress();
    expect(r.all).toEqual({ tomtom: 1, photon: 4 });
    expect(r.saved).toMatchObject({ lat: 45.5005 });
  });
  it('without a key: Photon only, as before TomTom', async () => {
    env.key = '';
    services({ body: TT_DOOR });
    const r = await typeOneAddress();
    expect(r.all).toEqual({ tomtom: 0, photon: 4 });
  });
});
