/* The customer's booking page (client.html#reserver), step « L'adresse », end to end: the real page step, the real address
   search (places.ts, TomTom with the app's key, Photon), only the two map services pretended. What the customer sees and
   what the page keeps to send to « book » (reviews F1 and F4). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const env = vi.hoisted(() => ({ key: 'KEY' }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), get TOMTOM_KEY() { return env.key; } }));

import { AddressStep } from '../../client/book/steps/AddressStep';
import type { Place } from '../../client/book/book-state';
import { forgetPlaces } from './places';

const STREET_ONLY = { results: [{ type: 'Street', address: { streetName: 'Avenue Mountain Sights', municipality: 'Montréal', neighbourhood: 'Snowdon', countrySubdivisionCode: 'QC', postalCode: 'H4P', countryCode: 'CA' }, position: { lat: 45.4974127, lon: -73.6538718 } }] };
const RANGE = { results: [{ type: 'Address Range', address: { streetNumber: '1401', streetName: 'Rue Légendre Est', municipality: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H2M', countryCode: 'CA' }, position: { lat: 45.5606338, lon: -73.6365069 } }] };
const PHOTON_8200 = { features: [{ geometry: { coordinates: [-73.6577, 45.5005] }, properties: { housenumber: '8200', street: 'Avenue Mountain Sights', city: 'Montréal', state: 'Québec', countrycode: 'CA', postcode: 'H4P 2B5', osm_key: 'building', type: 'house' } }] };

let asked: string[] = [];
function services(tomtom: unknown, photon: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const tt = new URL(url).hostname === 'api.tomtom.com';
    asked.push(tt ? 'tomtom' : 'photon');
    return { ok: true, status: 200, json: async () => (tt ? tomtom : photon) };
  }));
}

const box = document.createElement('div');
document.body.appendChild(box);
let chosen: Place | null = null;
function Step() {
  const [v, setV] = useState<Place | null>(null);
  chosen = v;
  return <AddressStep l="fr" value={v} onValue={setV} titleRef={{ current: null }} msg={null} onNext={() => undefined} />;
}
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function typeAddress(text: string) {
  await act(async () => { render(<Step />, box); });
  const el = q('book-address-input')[0] as HTMLInputElement;
  await act(async () => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(450);                                                   // the page waits 350 ms after the last letter
}

beforeEach(() => { asked = []; chosen = null; env.key = 'KEY'; forgetPlaces(); });
afterEach(async () => { await act(async () => { render(null, box); }); vi.unstubAllGlobals(); });

describe('Réserver en ligne, « L’adresse »: what the customer sees', () => {
  it('TomTom knows only the street, Photon the door: the door is offered and chosen with its position (review F1)', async () => {
    services(STREET_ONLY, PHOTON_8200);
    await typeAddress('8200 av mountain sights');
    expect(asked).toEqual(['tomtom', 'photon']);
    expect(q('book-suggestion').map((b) => b.textContent)).toEqual(['8200 av. Mountain SightsMontréal, QC']);
    expect(box.textContent).not.toContain('Aucune adresse');
    await act(async () => { q('book-suggestion')[0].click(); });
    expect(chosen).toMatchObject({ address: '8200 av. Mountain Sights, Montréal, QC', lat: 45.5005, lng: -73.6577, exact: true, postal_code: 'H4P 2B5' });
    expect(q('book-place')[0].textContent).toContain('8200 av. Mountain Sights, Montréal, QC');
  });

  it('a TomTom door placed along its block (« Address Range »): chosen, and no 3-character postal code goes to « book » (review F4)', async () => {
    services(RANGE, { features: [] });
    await typeAddress('1401 rue legendre est');
    expect(asked).toEqual(['tomtom']);                                // TomTom had the door typed: Photon not asked
    await act(async () => { q('book-suggestion')[0].click(); });
    expect(chosen).toMatchObject({ address: '1401 rue Légendre Est, Montréal, QC', lat: 45.5606338, postal_code: null });
  });

  it('the postal code the customer typed goes to « book », not the suggestion’s (review-places R2)', async () => {
    services(STREET_ONLY, PHOTON_8200);                               // Photon’s door says H4P 2B5
    await typeAddress('8200 av mountain sights H4P 2B6');
    await act(async () => { q('book-suggestion')[0].click(); });
    expect(chosen).toMatchObject({ lat: 45.5005, postal_code: 'H4P 2B6' });
  });

  it('a TomTom door range (only « H2M »), the whole code typed: the code typed is sent (review-places R2)', async () => {
    services(RANGE, { features: [] });
    await typeAddress('1401 rue legendre est H2M 1J4');
    await act(async () => { q('book-suggestion')[0].click(); });
    expect(chosen).toMatchObject({ lat: 45.5606338, postal_code: 'H2M 1J4' });
  });

  it('without the app’s key: Photon only, as before', async () => {
    env.key = '';
    services(STREET_ONLY, PHOTON_8200);
    await typeAddress('8200 av mountain sights');
    expect(asked).toEqual(['photon']);
    expect(q('book-suggestion')).toHaveLength(1);
  });
});

/* ---------- what one address typed costs on the public page, and a new letter stopping the old text (review-places R4) ---------- */

const TT_DOOR_8200 = { results: [{ type: 'Point Address', address: { streetNumber: '8200', streetName: 'Avenue Mountain Sights', municipality: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H4P', extendedPostalCode: 'H4P 2B5', countryCode: 'CA' }, position: { lat: 45.5005, lon: -73.6577 } }] };
/** the customer types in four bursts, a pause after each (the page asks 350 ms after the last letter) */
async function typeInBursts() {
  await act(async () => { render(<Step />, box); });
  const el = q('book-address-input')[0] as HTMLInputElement;
  const shown: number[] = [];
  for (const text of ['8200 av', '8200 av mountain', '8200 av mountain sig', '8200 av mountain sights']) {
    await act(async () => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(450);
    shown.push(q('book-suggestion').length);
  }
  const n = (who: string) => asked.filter((x) => x === who).length;
  return { tomtom: n('tomtom'), photon: n('photon'), shown };
}

describe('Réserver en ligne, « L’adresse »: what one address typed costs (review-places R4)', () => {
  it('TomTom knows the door: one TomTom lookup a pause once the street has a word, Photon never; the door shown mid-word', async () => {
    services(TT_DOOR_8200, PHOTON_8200);
    // before: 6 TomTom + 2 Photon (« 8200 av » and « … sig » each ran the careful second lookup), « … sig » showed nothing
    expect(await typeInBursts()).toEqual({ tomtom: 3, photon: 0, shown: [0, 1, 1, 1] });
  });
  it('TomTom knows only the street: TomTom and Photon once a pause (before: 6 + 6)', async () => {
    services(STREET_ONLY, PHOTON_8200);
    expect(await typeInBursts()).toEqual({ tomtom: 3, photon: 3, shown: [0, 1, 1, 1] });
  });
  it('without the app’s key: Photon once a pause (before: 6)', async () => {
    env.key = '';
    services(TT_DOOR_8200, PHOTON_8200);
    expect(await typeInBursts()).toEqual({ tomtom: 0, photon: 3, shown: [0, 1, 1, 1] });
  });
});

describe('Réserver en ligne, « L’adresse »: the careful second lookup waits for whole words (review-places R4)', () => {
  it('a pause in the middle of a word asks once; the careful lookup runs only once the street is typed in whole words', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url);
      const tt = u.hostname === 'api.tomtom.com';
      seen.push(`${tt ? 'tomtom' : 'photon'} ${tt ? decodeURIComponent(u.pathname.split('/geocode/')[1].replace(/\.json$/, '')) : u.searchParams.get('q')}`);
      return { ok: true, status: 200, json: async () => (tt ? STREET_ONLY : { features: [] }) };   // TomTom the street, Photon nothing
    }));
    await act(async () => { render(<Step />, box); });
    const el = q('book-address-input')[0] as HTMLInputElement;
    await act(async () => { el.value = '8200 av mountain sig'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(450);
    // « sig » may still become « sights »: TomTom's « Avenue Mountain Sights » begins with it, so no second lookup
    // (before: + « 8200 avenue mountain sig » to TomTom and Photon at every such pause)
    expect(seen).toEqual(['tomtom 8200 av mountain sig', 'photon 8200 av mountain sig']);
    seen.length = 0;
    await act(async () => { el.value = '8200 av mountain sights'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(450);
    expect(seen).toEqual(['tomtom 8200 av mountain sights', 'photon 8200 av mountain sights', 'tomtom 8200 avenue mountain sights', 'photon 8200 avenue mountain sights']);
    expect(box.textContent).toContain('Aucune adresse');
  });
});

describe('Réserver en ligne, « L’adresse »: a new letter stops the old text’s careful second lookup (review-places R4)', () => {
  it('nothing more is asked for the old text once the customer types again', async () => {
    const log: { who: string; q: string; at: number }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      const u = new URL(url);
      const tt = u.hostname === 'api.tomtom.com';
      const words = tt ? decodeURIComponent(u.pathname.split('/geocode/')[1].replace(/\.json$/, '')) : (u.searchParams.get('q') || '');
      log.push({ who: tt ? 'tomtom' : 'photon', q: words, at: Date.now() });
      return new Promise((done, fail) => {
        const t = setTimeout(() => done({ ok: true, status: 200, json: async () => (tt ? STREET_ONLY : { features: [] }) }), 150);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('aborted', 'AbortError')); });
      });
    }));
    await act(async () => { render(<Step />, box); });
    const el = q('book-address-input')[0] as HTMLInputElement;
    const OLD = '8200 av mountain sights';
    await act(async () => { el.value = OLD; el.dispatchEvent(new Event('input', { bubbles: true })); });
    // TomTom a street, Photon nothing: nothing on the street, so the page asks again with the short words written out
    for (let i = 0; i < 100 && !log.some((x) => /avenue/.test(x.q)); i++) await wait(10);
    expect(log.some((x) => x.who === 'tomtom' && /avenue/.test(x.q))).toBe(true);
    // counted by place in the log, not by the clock: the old text's request may be logged in the same millisecond
    const from = log.length;
    // « … sights e » (Est): every wording of the new text ends with « e », none of the old one does
    await act(async () => { el.value = `${OLD} e`; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(1200);
    expect(log.slice(from).filter((x) => !x.q.endsWith(' e')).map((x) => `${x.who} ${x.q}`)).toEqual([]);
    expect(log.slice(from).some((x) => x.q.endsWith(' e'))).toBe(true);    // the new text is asked
  });
});
