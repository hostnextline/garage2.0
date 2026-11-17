/* « Modifier » the file (R163): a new address typed and « Enregistrer » tapped at once (the field's own lookup answers
   after the sheet is gone) is saved WITH the position of that address; a change that does not touch the address asks
   nothing. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Customer } from '../../data/types';

const found = { status: 'found', quality: 'door', place: { place: { address: 'x', unit: null, postal_code: null, lat: 45.52, lng: -73.64, city: 'Mont-Royal' } } };
vi.mock('../../shared/places/locate', async (orig) => ({
  ...(await orig<typeof import('../../shared/places/locate')>()),
  locate: vi.fn(() => new Promise((done) => setTimeout(() => done(found), 30)))
}));
vi.mock('../../shared/places/places', async (orig) => ({
  ...(await orig<typeof import('../../shared/places/places')>()),
  searchPlaces: vi.fn(async () => ({ places: [], error: null }))
}));
vi.mock('../../data/api', async (orig) => ({
  ...(await orig<typeof import('../../data/api')>()),
  saveCustomer: vi.fn(async () => 'c1'),
  updateJob: vi.fn(async () => undefined)
}));
const api = await import('../../data/api');
const locateMod = await import('../../shared/places/locate');
const { EditSheet } = await import('./EditSheet');
const { lang } = await import('../../lib/i18n');
lang.value = 'fr';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
beforeEach(() => { vi.mocked(api.saveCustomer).mockClear(); vi.mocked(locateMod.locate).mockClear(); });
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const C = { id: 'c1', first_name: 'Marc', last_name: 'Roy', phone: '514-555-0141', address: '10 rue Ancienne', lat: 45.1, lng: -73.1, lang: 'fr', sms_ok: true } as Customer;

describe('« Modifier » the customer (R163)', () => {
  it('a new address saved right after typing carries its position', async () => {
    await act(() => render(<EditSheet c={C} onClose={() => undefined} onLeaving={() => undefined} onDeleted={() => undefined} />, box));
    const input = q('address-input') as HTMLInputElement;
    await act(() => { input.value = '1250 rue Graham'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => { q('customer-save').click(); });
    await wait(120);
    const sent = vi.mocked(api.saveCustomer).mock.calls.at(-1)?.[0];
    expect(sent).toMatchObject({ id: 'c1', address: '1250 rue Graham', lat: 45.52, lng: -73.64 });
    expect(sent).not.toHaveProperty('first_name');
  });
  it('a change without the address: nothing asked, only that field sent', async () => {
    await act(() => render(<EditSheet c={C} onClose={() => undefined} onLeaving={() => undefined} onDeleted={() => undefined} />, box));
    const first = q('cf-first') as HTMLInputElement;
    await act(() => { first.value = 'Marco'; first.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => { q('customer-save').click(); });
    await wait(60);
    expect(vi.mocked(api.saveCustomer).mock.calls.at(-1)?.[0]).toEqual({ id: 'c1', first_name: 'Marco' });
    expect(locateMod.locate).not.toHaveBeenCalled();
  });
});
