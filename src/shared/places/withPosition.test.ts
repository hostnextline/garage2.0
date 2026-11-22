import { describe, it, expect, vi, afterEach } from 'vitest';
const real = vi.hoisted(() => ({ locate: vi.fn() }));
vi.mock('./locate', () => ({ locate: real.locate }));
import { withPosition } from './withPosition';
import type { locate } from './locate';
import type { Suggestion } from './photon';
import { EMPTY_PLACE } from './place';

const found = { status: 'found', quality: 'door', place: { place: { address: 'x', unit: null, postal_code: null, lat: 45.52, lng: -73.64, city: 'Mont-Royal' } } as Suggestion } as const;
const typed = { ...EMPTY_PLACE, address: '1250 rue Graham', postal_code: 'H3P 2C9' };

describe('the position at the moment of saving (customers-a-05)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('a sure answer in time gives the position; the address stays as typed', async () => {
    const find = vi.fn(async () => found) as unknown as typeof locate;
    expect(await withPosition(typed, 2500, find)).toEqual({ ...typed, lat: 45.52, lng: -73.64, city: 'Mont-Royal' });
    expect(find).toHaveBeenCalledWith('1250 rue Graham', { postal: 'H3P 2C9' });
  });
  it('an answer that hangs: saved without position after the wait', async () => {
    vi.useFakeTimers();
    const find = vi.fn(() => new Promise(() => undefined)) as unknown as typeof locate;
    const p = withPosition(typed, 2500, find);
    await vi.advanceTimersByTimeAsync(2600);
    expect(await p).toBe(typed);
  });
  it('several places or nothing: saved as typed', async () => {
    const find = vi.fn(async () => ({ status: 'choose', choices: [] })) as unknown as typeof locate;
    expect(await withPosition(typed, 2500, find)).toBe(typed);
  });
  it('without its own lookup: locate, in a hurry (TomTom and Photon at once, places.ts; review F6)', async () => {
    real.locate.mockResolvedValueOnce(found);
    expect(await withPosition(typed)).toEqual({ ...typed, lat: 45.52, lng: -73.64, city: 'Mont-Royal' });
    expect(real.locate).toHaveBeenCalledWith('1250 rue Graham', { postal: 'H3P 2C9', hurry: true });
  });
  it('without signal, already placed, or empty: nothing asked', async () => {
    const find = vi.fn(async () => found) as unknown as typeof locate;
    expect(await withPosition({ ...typed, lat: 1, lng: 2 }, 2500, find)).toEqual({ ...typed, lat: 1, lng: 2 });
    expect(await withPosition(EMPTY_PLACE, 2500, find)).toBe(EMPTY_PLACE);
    vi.stubGlobal('navigator', { onLine: false });
    expect(await withPosition(typed, 2500, find)).toBe(typed);
    expect(find).not.toHaveBeenCalled();
  });
});
