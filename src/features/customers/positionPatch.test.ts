import { describe, it, expect } from 'vitest';
import { positionPatch } from './positionPatch';

describe('« Chercher » on a customer (customers-a-06)', () => {
  const s = { place: { address: '1250 rue Graham', unit: null, postal_code: 'H3P 2C9', lat: 45.52, lng: -73.64, city: 'Mont-Royal' } } as never;
  it('saves the position and the town, never the map’s postal code', () => {
    expect(positionPatch({ id: 'c1', city: null }, s)).toEqual({ id: 'c1', lat: 45.52, lng: -73.64, city: 'Mont-Royal' });
    expect(positionPatch({ id: 'c1', city: 'Montréal' }, s)).toEqual({ id: 'c1', lat: 45.52, lng: -73.64 });
  });
});
