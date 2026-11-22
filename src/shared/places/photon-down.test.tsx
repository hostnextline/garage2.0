/* Photon down (HTTP 503) while TomTom works (review-places R6): the network works, so neither the team's address field
   nor the customer's booking page says « Pas de réseau ». The real field, the real page step and the real search
   (places.ts, locate.ts); only the two map services are pretended. With no network at all, both still say it. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const env = vi.hoisted(() => ({ key: 'KEY' }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), get TOMTOM_KEY() { return env.key; } }));

import { lang } from '../../lib/i18n';
import { AddressField, EMPTY_PLACE, type PlaceValue } from './AddressField';
import { AddressStep } from '../../client/book/steps/AddressStep';
import type { Place } from '../../client/book/book-state';
import { forgetPlaces } from './places';

const TT_STREET = { results: [{ type: 'Street', address: { streetName: 'Avenue Mountain Sights', municipality: 'Montréal', countrySubdivisionCode: 'QC', postalCode: 'H4P', countryCode: 'CA' }, position: { lat: 45.4974, lon: -73.6538 } }] };

let asked: string[] = [];
/** TomTom knows only the street and Photon answers 503 (`down`); or no network at all (`none`) */
function services(how: 'down' | 'none') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const tt = new URL(url).hostname === 'api.tomtom.com';
    asked.push(tt ? 'tomtom' : 'photon');
    if (how === 'none') throw new TypeError('Failed to fetch');
    if (tt) return { ok: true, status: 200, json: async () => TT_STREET };
    return { ok: false, status: 503, json: async () => ({}) };
  }));
}

const box = document.createElement('div');
document.body.appendChild(box);
const byId = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function typeIn(el: HTMLInputElement, text: string) {
  await act(() => { el.focus(); el.value = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); });
}

function Field() {
  const [v, setV] = useState<PlaceValue>(EMPTY_PLACE);
  return <div><AddressField value={v} onValue={setV} /><input data-testid="other" /></div>;
}
function Step() {
  const [v, setV] = useState<Place | null>(null);
  return <AddressStep l="fr" value={v} onValue={setV} titleRef={{ current: null }} msg={null} onNext={() => undefined} />;
}

beforeEach(() => { asked = []; env.key = 'KEY'; lang.value = 'fr'; forgetPlaces(); });
afterEach(async () => { await act(async () => { render(null, box); }); vi.unstubAllGlobals(); });

describe('the team’s address field', () => {
  it('Photon down: TomTom’s street is offered, and leaving the field says the position is still to find, not « Pas de réseau »', async () => {
    services('down');
    await act(async () => { render(<Field />, box); });
    await typeIn(byId('address-input'), '8200 av mountain sights');
    await wait(400);
    expect(asked).toEqual(['tomtom', 'photon']);
    expect(box.textContent).toContain('8200 av. Mountain Sights');
    expect(box.textContent).not.toContain('Pas de réseau');
    await act(() => { byId('address-input').blur(); byId('other').focus(); });
    await wait(300);
    expect(asked).toEqual(['tomtom', 'photon', 'photon']);          // leaving the field: only Photon asked again
    expect(box.textContent).not.toContain('Pas de réseau');
    expect(box.textContent).toContain('Position pas encore trouvée');
  });

  it('no network at all: « Pas de réseau », as before', async () => {
    services('none');
    await act(async () => { render(<Field />, box); });
    await typeIn(byId('address-input'), '8200 av mountain sights');
    await wait(400);
    expect(box.textContent).toContain('Pas de réseau');
  });
});

describe('the customer’s booking page, « L’adresse »', () => {
  it('Photon down: « Aucune adresse trouvée… appelez-nous », not « Pas de réseau : vérifiez votre connexion »', async () => {
    services('down');
    await act(async () => { render(<Step />, box); });
    await typeIn(byId('book-address-input'), '8200 av mountain sights');
    await wait(500);
    expect(box.textContent).not.toContain('Pas de réseau');
    expect(box.textContent).toContain('Aucune adresse trouvée');
  });

  it('no network at all: « Pas de réseau », as before', async () => {
    services('none');
    await act(async () => { render(<Step />, box); });
    await typeIn(byId('book-address-input'), '8200 av mountain sights');
    await wait(500);
    expect(box.textContent).toContain('Pas de réseau');
  });
});
