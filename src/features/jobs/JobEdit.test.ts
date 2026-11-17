/* « Changer de client » waits for a customer just made on this phone to reach the server; the phone's storage refusing to
   be read must not leave the button spinning for good (jobs-r6). The outbox is pretended. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxEntry } from '../../data/local';

const box = vi.hoisted(() => ({ list: vi.fn<() => Promise<OutboxEntry[]>>() }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), outboxList: box.list }));
const api = vi.hoisted(() => ({ updateJob: vi.fn((..._a: unknown[]) => Promise.resolve()) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));

import { reached, saveJobAddress } from './JobEdit';
import type { PlaceValue } from '../../shared/places/place';

const insert = (id: string): OutboxEntry => ({ seq: 1, op: 'o1', kind: 'insert', table: 'customers', id, values: {}, at: '', tries: 0, state: 'pending' });

beforeEach(() => { box.list.mockReset(); });

describe('waiting for a new customer to reach the server', () => {
  it('the phone’s storage cannot be read (blocked, broken): it goes on at once instead of throwing', async () => {
    box.list.mockRejectedValue(new Error('IndexedDB blocked'));
    await expect(reached('customers', 'c9')).resolves.toBeUndefined();
  });
  it('waits while the customer is still in the outbox, then goes on', async () => {
    box.list.mockResolvedValueOnce([insert('c9')]).mockResolvedValueOnce([]);
    await expect(reached('customers', 'c9', 2000)).resolves.toBeUndefined();
    expect(box.list).toHaveBeenCalledTimes(2);
  });
});

describe('the appointment’s own address (R164)', () => {
  const home: PlaceValue = { address: '1250 rue Graham, Montréal', unit: '3', postal_code: 'H3P 2C9', lat: 45.52, lng: -73.64, city: 'Montréal' };
  const found = (lat: number, lng: number) => vi.fn(async (p: PlaceValue) => ({ ...p, lat, lng }));
  beforeEach(() => { api.updateJob.mockClear(); });
  it('the position is looked for before saving: a typed address is saved with it, not without', async () => {
    const locate = found(45.6, -73.5);
    const typed = { ...home, address: '500 rue du Chalet, Laval', lat: null, lng: null };
    const r = await saveJobAddress('j1', home, typed, locate as never);
    expect(locate).toHaveBeenCalledTimes(1);
    expect(r.lat).toBe(45.6);
    expect(api.updateJob).toHaveBeenCalledWith('j1', expect.objectContaining({ address: '500 rue du Chalet, Laval', lat: 45.6, lng: -73.5 }));
  });
  it('another address keeps no apartment nor postal code of the one the form started from (they are not shown)', async () => {
    const typed = { ...home, address: '500 rue du Chalet, Laval', lat: null, lng: null };
    await saveJobAddress('j1', home, typed, found(45.6, -73.5) as never);
    expect(api.updateJob.mock.calls[0][1]).toMatchObject({ unit: null, postal_code: null });
  });
  it('the same door written better keeps its apartment and its code: a typo fixed, the town added, the same door’s suggestion (jobs-r2-3)', async () => {
    const keep = vi.fn(async (p: PlaceValue) => ({ ...p, lat: 45.52, lng: -73.64 }));
    const cases: [string, string][] = [
      ['1250 rue Grahm, Montréal', '1250 rue Graham, Montréal'],            // a typo fixed in the street
      ['1250 rue Graham', '1250 rue Graham, Mont-Royal'],                    // the town added
      ['1250 rue Graham, Montréal', '1250 Rue Graham, Mont-Royal, QC']       // the suggestion of that same door
    ];
    for (const [from, to] of cases) {
      api.updateJob.mockClear();
      await saveJobAddress('j1', { ...home, address: from }, { ...home, address: to, lat: null, lng: null }, keep as never);
      expect(api.updateJob.mock.calls[0][1]).toMatchObject({ address: to, unit: '3', postal_code: 'H3P 2C9' });
    }
    // and the position lookup gets the code (it helps it recognise the area)
    expect(keep.mock.calls.at(-1)![0].postal_code).toBe('H3P 2C9');
  });
  it('another door of the same street keeps neither, as the address field itself does (its code may be another one: the other side, a corner)', async () => {
    await saveJobAddress('j1', home, { ...home, address: '1252 rue Graham, Montréal', lat: null, lng: null }, found(45.52, -73.64) as never);
    expect(api.updateJob.mock.calls[0][1]).toMatchObject({ unit: null, postal_code: null });
  });
  it('a unit or a code typed with the new address is kept; the same address keeps its own', async () => {
    await saveJobAddress('j1', home, { ...home, address: '500 rue du Chalet, Laval', unit: '12', postal_code: 'H7N 1A1', lat: null, lng: null }, found(45.6, -73.5) as never);
    expect(api.updateJob.mock.calls[0][1]).toMatchObject({ unit: '12', postal_code: 'H7N 1A1' });
    const same = vi.fn(async (p: PlaceValue) => p);
    await saveJobAddress('j1', home, { ...home }, same as never);
    expect(api.updateJob.mock.calls[1][1]).toEqual({ address: '1250 rue Graham, Montréal', unit: '3', postal_code: 'H3P 2C9', lat: 45.52, lng: -73.64 });
  });
});
