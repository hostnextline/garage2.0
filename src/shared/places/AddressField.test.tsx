/* The address field on screen, with Photon pretended: each race proven on the old field stays fixed. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import type { Suggestion } from './photon';

const photon = vi.hoisted(() => ({ answer: [] as unknown[], delay: 0, asked: [] as string[] }));
vi.mock('./places', () => ({
  searchPlaces: async (q: string) => {
    photon.asked.push(q);
    if (photon.delay) await new Promise((r) => setTimeout(r, photon.delay));
    return { places: photon.answer, error: null };
  }
}));

import { lang } from '../../lib/i18n';
import { AddressField, EMPTY_PLACE, type PlaceValue } from './AddressField';

const sugg = (house: string, street: string, city: string, lat = 45.52, lng = -73.64): Suggestion => ({
  place: { address: `${house} ${street}, ${city}, QC`, unit: null, postal_code: null, lat, lng, city },
  label: `${house} ${street}`, sub: `${city}, QC`, exact: true, key: `${house} ${street}|${city}`, house, street, areas: [city]
});
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const typeIn = async (el: HTMLInputElement, text: string) => {
  await act(() => { el.focus(); el.value = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); });
};
const blur = async (el: HTMLInputElement) => { await act(() => { el.blur(); }); };

/* a parent written the way the customer forms are: the patch merged into the draft of ITS render */
interface Draft { place: PlaceValue; last: string }
let draft: Draft;
let setOutside: (p: PlaceValue) => void = () => undefined;
function Form(p: { first?: PlaceValue }) {
  const [d, setD] = useState<Draft>({ place: p.first ?? EMPTY_PLACE, last: '' });
  draft = d;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  setOutside = (place) => setD((x) => ({ ...x, place }));
  return (
    <div>
      <AddressField value={d.place} onValue={(v) => set({ place: v })} details />
      <input data-testid="last" value={d.last} onInput={(e) => set({ last: (e.currentTarget as HTMLInputElement).value })} />
    </div>
  );
}

beforeEach(() => { lang.value = 'fr'; photon.answer = []; photon.delay = 0; photon.asked = []; });
afterEach(() => { act(() => render(null, box)); });

describe('the address field', () => {
  it('what is typed after leaving the field survives the position arriving (customers-a-01)', async () => {
    await act(() => render(<Form />, box));
    photon.answer = [sugg('160', 'rue Khalil-Gibran', 'Montréal', 45.527, -73.667)];
    photon.delay = 200;
    await typeIn(q('address-input')!, '160 khalil gibran');
    await blur(q('address-input')!);
    await typeIn(q('last')!, 'Tremblay');
    await wait(900);
    expect(draft.last).toBe('Tremblay');
    expect(draft.place).toMatchObject({ address: '160 khalil gibran', lat: 45.527 });
  });

  it('leaving right after the last key still takes the position, and the list stays closed (customers-a-07)', async () => {
    await act(() => render(<Form />, box));
    photon.answer = [sugg('1250', 'rue Graham', 'Mont-Royal')];
    await typeIn(q('address-input')!, '1250 rue Graham, Mont-Royal');
    await wait(100);
    await blur(q('address-input')!);
    await wait(500);
    expect(draft.place.lat).toBe(45.52);
    expect(q('address-suggestions')).toBeNull();
    expect(box.textContent).toContain('Position trouvée');
  });

  it('a chosen « rue Logan » is not cut on leaving (customers-a-02)', async () => {
    await act(() => render(<Form />, box));
    photon.answer = [sugg('1650', 'rue Logan', 'Montréal')];
    await typeIn(q('address-input')!, '1650 rue Logan');
    await wait(400);
    const li = q('address-suggestions')!.querySelector('li')!;
    await act(() => { li.click(); });
    await blur(q('address-input')!);
    await wait(50);
    expect(draft.place).toMatchObject({ address: '1650 rue Logan, Montréal, QC', unit: null });
    // typed by hand and left: the same
    await typeIn(q('address-input')!, '1650 rue Logan');
    await blur(q('address-input')!);
    await wait(50);
    expect(draft.place).toMatchObject({ address: '1650 rue Logan', unit: null });
  });

  it('another street chosen: the old unit and postal code go (customers-a-03)', async () => {
    await act(() => render(<Form first={{ address: '1250 rue Graham', unit: '3', postal_code: 'H3P 2C9', lat: 45.52, lng: -73.64, city: 'Mont-Royal' }} />, box));
    photon.answer = [sugg('700', 'rue Lebeau', 'Saint-Laurent', 45.53, -73.68)];
    await typeIn(q('address-input')!, '700 rue Lebeau');
    await wait(400);
    await act(() => { q('address-suggestions')!.querySelector('li')!.click(); });
    expect(draft.place).toMatchObject({ address: '700 rue Lebeau, Saint-Laurent, QC', unit: null, postal_code: null, lat: 45.53 });
    expect(q('address-unit')!.value).toBe('');
    expect(q('address-postal')!.value).toBe('');
  });

  it('the unit typed with the address is kept when a suggestion is chosen (customers-a-08)', async () => {
    await act(() => render(<Form />, box));
    photon.answer = [sugg('1250', 'rue Graham', 'Mont-Royal')];
    await typeIn(q('address-input')!, '3-1250 rue graham');
    await wait(400);
    await act(() => { q('address-suggestions')!.querySelector('li')!.click(); });
    expect(draft.place).toMatchObject({ address: '1250 rue Graham, Mont-Royal, QC', unit: '3' });
  });

  it('an address replaced from outside is looked up again on leaving (customers-a-19)', async () => {
    await act(() => render(<Form />, box));
    photon.answer = [sugg('1250', 'rue Graham', 'Mont-Royal')];
    await typeIn(q('address-input')!, '1250 rue Graham');
    await wait(400);
    await act(() => { q('address-suggestions')!.querySelector('li')!.click(); });
    await act(() => setOutside({ ...EMPTY_PLACE, address: '160 khalil gibran' }));
    photon.answer = [sugg('160', 'rue Khalil-Gibran', 'Montréal', 45.527, -73.667)];
    await act(() => { q('address-input')!.focus(); });
    await blur(q('address-input')!);
    await wait(100);
    expect(draft.place).toMatchObject({ address: '160 khalil gibran', lat: 45.527 });
  });
});
