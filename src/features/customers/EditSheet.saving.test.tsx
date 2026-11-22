/* « Modifier » the file while « Enregistrer » waits for the position of a new address (customers-r2-2): « Annuler »,
   Escape and the dimmed area do nothing until the save is over, so « Quitter ? » never opens over a save that goes
   through, and the sheet closes once. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Customer } from '../../data/types';

// the position answers when the test says so (no timing under a loaded machine)
const { answer } = vi.hoisted(() => ({ answer: [] as Array<() => void> }));
const found = { status: 'found', quality: 'door', place: { place: { address: 'x', unit: null, postal_code: null, lat: 45.52, lng: -73.64, city: 'Mont-Royal' } } };
vi.mock('../../shared/places/locate', async (orig) => ({
  ...(await orig<typeof import('../../shared/places/locate')>()),
  locate: vi.fn(() => new Promise((done) => { answer.push(() => done(found)); }))
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
vi.mock('../../ui', async (orig) => ({
  ...(await orig<typeof import('../../ui')>()),
  ask: vi.fn(async () => true)
}));
const api = await import('../../data/api');
const ui = await import('../../ui');
const { EditSheet } = await import('./EditSheet');
const { lang, t } = await import('../../lib/i18n');
lang.value = 'fr';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => { answer.length = 0; return act(() => render(null, box)); });
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const cancel = () => document.body.querySelector('[data-testid="customer-edit-sheet"] .sheet-foot button') as HTMLButtonElement;
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** the position comes; then the save ends (polled, a loaded machine is slow) */
const release = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !answer.length; i++) await wait(10);
  await act(() => { answer.splice(0).forEach((f) => f()); });
  for (let i = 0; i < 300 && !done(); i++) await wait(10);
};
const C = { id: 'c1', first_name: 'Marc', last_name: 'Roy', phone: '514-555-0141', address: '10 rue Ancienne', lat: 45.1, lng: -73.1, lang: 'fr', sms_ok: true } as Customer;

describe('« Modifier » the customer while « Enregistrer » runs (customers-r2-2)', () => {
  it('« Annuler » and Escape do nothing during the save: no « Quitter ? », one close after the save', async () => {
    const onClose = vi.fn();
    await act(() => render(<EditSheet c={C} onClose={onClose} onLeaving={() => undefined} onDeleted={() => undefined} />, box));
    const input = q('address-input') as HTMLInputElement;
    await act(() => { input.value = '1250 rue Graham'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => { q('customer-save').click(); });
    await wait(10);
    expect(cancel().disabled).toBe(true);
    expect(q('customer-save').getAttribute('aria-busy')).toBe('true');
    expect(document.body.querySelector('[data-testid="customer-edit-sheet"] .sheet-x')).toBeNull();
    await act(() => { cancel().click(); });
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await wait(10);
    expect(ui.ask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await release(() => onClose.mock.calls.length > 0);
    expect(vi.mocked(api.saveCustomer).mock.calls.at(-1)?.[0]).toMatchObject({ id: 'c1', address: '1250 rue Graham', lat: 45.52 });
    expect(ui.ask).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('outside a save, « Annuler » with changes still asks « Quitter ? »', async () => {
    vi.mocked(ui.ask).mockClear();
    const onClose = vi.fn();
    await act(() => render(<EditSheet c={C} onClose={onClose} onLeaving={() => undefined} onDeleted={() => undefined} />, box));
    const first = q('cf-first') as HTMLInputElement;
    await act(() => { first.value = 'Marco'; first.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => { cancel().click(); });
    await wait(10);
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ui.ask).mock.calls[0][0].title).toBe(t('customers.file.leave.title'));
  });
});
