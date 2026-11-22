/* R163: « Créer » tapped right after typing the address (the tap that leaves the field, whose own lookup answers after
   the sheet is gone): the file is saved with the position of that address, not without it. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../data/api', async (orig) => ({
  ...(await orig<typeof import('../../data/api')>()),
  saveCustomer: vi.fn(async () => 'c-new'),
  saveVehicle: vi.fn(async () => 'v-new')
}));
const api = await import('../../data/api');
const { createCustomer, positioned } = await import('./create');
const { emptyDraft } = await import('./draft');
import type { locate } from '../places/locate';
import type { Suggestion } from '../places/photon';

const found = { status: 'found', quality: 'door', place: { place: { address: 'x', unit: null, postal_code: null, lat: 45.52, lng: -73.64, city: 'Mont-Royal' } } as Suggestion } as const;
const typed = () => emptyDraft({ first_name: 'Marc', phone: '5145550141', place: { address: '1250 rue Graham', unit: null, postal_code: 'H3P 2C9', lat: null, lng: null, city: null } });

describe('making a customer (R163)', () => {
  beforeEach(() => vi.mocked(api.saveCustomer).mockClear());
  it('tap « Créer » right after typing → saved with lat/lng', async () => {
    const find = vi.fn(async () => found) as unknown as typeof locate;
    expect(await createCustomer(typed(), null, find)).toBe('c-new');
    expect(find).toHaveBeenCalledWith('1250 rue Graham', { postal: 'H3P 2C9' });
    expect(vi.mocked(api.saveCustomer).mock.calls[0][0]).toMatchObject({ address: '1250 rue Graham', lat: 45.52, lng: -73.64, first_name: 'Marc' });
  });
  it('no sure answer: saved as typed, without position', async () => {
    const find = vi.fn(async () => ({ status: 'choose', choices: [] })) as unknown as typeof locate;
    await createCustomer(typed(), null, find);
    expect(vi.mocked(api.saveCustomer).mock.calls[0][0]).toMatchObject({ address: '1250 rue Graham', lat: null, lng: null });
  });
  it('a position already chosen in the field is kept and nothing is asked', async () => {
    const find = vi.fn(async () => found) as unknown as typeof locate;
    const d = emptyDraft({ first_name: 'Marc', place: { address: '1250 rue Graham', unit: null, postal_code: null, lat: 45.1, lng: -73.1, city: null } });
    expect(await positioned(d, find)).toBe(d);
    expect(find).not.toHaveBeenCalled();
  });
});
