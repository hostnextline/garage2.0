import { describe, it, expect } from 'vitest';
import { destinationOf, mapsHref } from './directions';

const none = { address: null, lat: null, lng: null };
describe('« Itinéraire »', () => {
  it('the appointment’s own address, else the customer’s', () => {
    expect(destinationOf({ address: '500 rue du Chalet, Laval', lat: null, lng: null }, { address: '1 rue Maison', lat: 45.5, lng: -73.6 })).toBe('500 rue du Chalet, Laval');
    expect(destinationOf(none, { address: '12 rue Principale', lat: 45.4, lng: -73.9 })).toBe('12 rue Principale');
  });
  it('no address at all: a position still leads there; nothing: no link', () => {
    expect(destinationOf({ address: null, lat: 45.1, lng: -73.1 }, null)).toBe('45.1,-73.1');
    expect(destinationOf(none, { address: ' ', lat: 45.2, lng: -73.2 })).toBe('45.2,-73.2');
    expect(mapsHref(none, null)).toBeNull();
    expect(mapsHref({ address: 'A & B', lat: null, lng: null }, null)).toBe('https://www.google.com/maps/dir/?api=1&destination=A%20%26%20B&travelmode=driving');
  });
});
