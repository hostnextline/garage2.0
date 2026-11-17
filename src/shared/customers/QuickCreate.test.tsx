/* The picker's short sheet « Nouveau client » (customers-r2-1): « Créer » may wait a moment for the position of the
   address (R163). Meanwhile « Annuler », Escape and the dimmed area do nothing, so a customer saved after the person
   « left » is never picked into the booking behind; a sheet closed by a navigation picks nothing either. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

// the position answers when the test says so (no timing under a loaded machine)
const { answer } = vi.hoisted(() => ({ answer: [] as Array<() => void> }));
const found = { status: 'found', quality: 'door', place: { place: { address: 'x', unit: null, postal_code: null, lat: 45.52, lng: -73.64, city: 'Mont-Royal' } } };
vi.mock('../places/locate', async (orig) => ({
  ...(await orig<typeof import('../places/locate')>()),
  locate: vi.fn(() => new Promise((done) => { answer.push(() => done(found)); }))
}));
vi.mock('../places/places', async (orig) => ({
  ...(await orig<typeof import('../places/places')>()),
  searchPlaces: vi.fn(async () => ({ places: [], error: null }))
}));
vi.mock('../../data/api', async (orig) => ({
  ...(await orig<typeof import('../../data/api')>()),
  saveCustomer: vi.fn(async () => 'c9')
}));
const api = await import('../../data/api');
const { QuickCreate } = await import('./QuickCreate');
const { lang } = await import('../../lib/i18n');
lang.value = 'fr';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
beforeEach(() => { vi.mocked(api.saveCustomer).mockClear(); answer.length = 0; });
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const cancel = () => document.body.querySelector('[data-testid="quick-create"] .sheet-foot button') as HTMLButtonElement;
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** the position comes; then the save ends (polled, a loaded machine is slow) */
const release = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !answer.length; i++) await wait(10);
  await act(() => { answer.splice(0).forEach((f) => f()); });
  for (let i = 0; i < 300 && !done(); i++) await wait(10);
};
const initial = { first_name: 'Ana', place: { address: '1250 rue Graham', unit: null, postal_code: null, lat: null, lng: null, city: null } };

describe('« Nouveau client » from the picker while « Créer » waits for the position (customers-r2-1)', () => {
  it('« Annuler » and Escape do nothing during the save; the customer is picked once it is saved', async () => {
    const onClose = vi.fn(), onCreated = vi.fn();
    await act(() => render(<QuickCreate initial={initial} onClose={onClose} onCreated={onCreated} />, box));
    await act(() => { q('quick-create-ok').click(); });
    await wait(10);
    expect(cancel().disabled).toBe(true);
    expect(q('quick-create-ok').getAttribute('aria-busy')).toBe('true');
    expect(document.body.querySelector('[data-testid="quick-create"] .sheet-x')).toBeNull();
    await act(() => { cancel().click(); });
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    await release(() => onCreated.mock.calls.length > 0);
    expect(vi.mocked(api.saveCustomer).mock.calls.at(-1)?.[0]).toMatchObject({ first_name: 'Ana', lat: 45.52, lng: -73.64 });
    expect(onCreated).toHaveBeenCalledWith('c9');
    expect(onClose).not.toHaveBeenCalled();
    // the save is over: « Annuler » works again
    expect(cancel().disabled).toBe(false);
  });
  it('a sheet closed by a navigation during the save picks nothing', async () => {
    const onCreated = vi.fn();
    await act(() => render(<QuickCreate initial={initial} onClose={() => undefined} onCreated={onCreated} />, box));
    await act(() => { q('quick-create-ok').click(); });
    await wait(10);
    await act(() => render(null, box));
    await release(() => vi.mocked(api.saveCustomer).mock.calls.length > 0);
    await wait(50);
    expect(api.saveCustomer).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });
  it('before any save, « Annuler » closes at once', async () => {
    const onClose = vi.fn();
    await act(() => render(<QuickCreate initial={initial} onClose={onClose} onCreated={() => undefined} />, box));
    await act(() => { cancel().click(); });
    await wait(10);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
