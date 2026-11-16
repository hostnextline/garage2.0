import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { changed, checkDraft, customerPatch, draftOf, emptyDraft, movesAddress } from './draft';
import { useCustomerDraft } from './useCustomerDraft';
import type { Customer } from '../../data/types';

const file = { id: 'c1', first_name: 'Julie', last_name: 'Tremblay', company: null, phone: '514 555-0141 poste 23', email: null, lang: 'fr', address: '1250 rue Graham',
  unit: '3', postal_code: 'H3P 2C9', lat: 45.5, lng: -73.6, city: 'Mont-Royal', notes: null, sms_ok: true, card_on_file: false } as unknown as Customer;

describe('the customer draft', () => {
  it('names written with capitals, the phone the Québec way, only what changed', () => {
    const p = customerPatch(emptyDraft({ first_name: 'marc-andré', last_name: ' roy ', phone: '5145550141' }));
    expect(p).toMatchObject({ first_name: 'Marc-André', last_name: 'Roy', phone: '514 555-0141' });
    const before = customerPatch(draftOf(file));
    expect(changed(before, customerPatch({ ...draftOf(file), notes: 'Chien' }))).toEqual({ notes: 'Chien' });
  });
  it('a stored phone the form would refuse does not block another change (customers-a-22)', () => {
    const d = { ...draftOf(file), notes: 'Stationnement derrière' };
    expect(checkDraft(d, file.phone)).toEqual({});
    // a number typed (or changed) is still checked
    expect(checkDraft({ ...d, phone: '514 555' }, file.phone).phone).toBeTruthy();
    expect(checkDraft(emptyDraft({ first_name: 'A', phone: '555' })).phone).toBeTruthy();
  });
  it('an address change is told apart', () => {
    expect(movesAddress({ address: 'x' })).toBe(true);
    expect(movesAddress({ notes: 'x' })).toBe(false);
  });
});

describe('the form state (customers-a-28, the parents’ side of customers-a-01)', () => {
  it('a patch sent by an older render (the position found seconds after leaving the address) keeps what was typed since', () => {
    let api: ReturnType<typeof useCustomerDraft> | null = null;
    function Probe() { api = useCustomerDraft(() => emptyDraft()); return null; }
    const box = document.createElement('div');
    act(() => render(<Probe />, box));
    const staleSet = api!.set;                                 // the address field keeps the set of the render it was left in
    act(() => api!.set({ last_name: 'Tremblay', lang: 'en' }));
    act(() => staleSet({ place: { address: '160 khalil gibran', unit: null, postal_code: null, lat: 45.5, lng: -73.6 } }));
    expect(api!.draft).toMatchObject({ last_name: 'Tremblay', lang: 'en', place: { lat: 45.5 } });
    act(() => render(null, box));
  });
  it('one save at a time', async () => {
    let api: ReturnType<typeof useCustomerDraft> | null = null;
    function Probe() { api = useCustomerDraft(() => emptyDraft({ first_name: 'A' })); return null; }
    const box = document.createElement('div');
    act(() => render(<Probe />, box));
    let runs = 0;
    let done: () => void = () => undefined;
    const first = api!.once(() => new Promise<void>((r) => { runs++; done = r; }));
    await api!.once(async () => { runs++; });
    done();
    await first;
    expect(runs).toBe(1);
    act(() => render(null, box));
  });
});
