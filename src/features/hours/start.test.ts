import { describe, it, expect } from 'vitest';
import { startOf, sameStart } from './TruckStartPanel';
import { hours as fr } from '../../i18n/fr/hours';
import { hours as en } from '../../i18n/en/hours';
import { map as frMap } from '../../i18n/fr/map';
import { map as enMap } from '../../i18n/en/map';

describe('where a truck leaves from (Part 18)', () => {
  it('« Départ des camions » is sent as null', () => {
    expect(startOf({ mode: 'home', label: 'x', address: 'y', lat: 1, lng: 2 })).toBeNull();
  });
  it('its own address needs a position found on the map', () => {
    expect(startOf({ mode: 'own', label: '', address: '10 rue X', lat: null, lng: null })).toBeUndefined();
    expect(startOf({ mode: 'own', label: '  Chez Saleh ', address: ' 10 rue X ', lat: 45.5, lng: -73.6 }))
      .toEqual({ label: 'Chez Saleh', address: '10 rue X', lat: 45.5, lng: -73.6 });
    expect(startOf({ mode: 'own', label: '', address: '', lat: 45.5, lng: -73.6 })).toEqual({ label: null, address: null, lat: 45.5, lng: -73.6 });
  });
  it('knows when nothing changed', () => {
    const s = { label: 'A', address: 'B', lat: 1, lng: 2 };
    expect(sameStart(null, null)).toBe(true);
    expect(sameStart(null, undefined)).toBe(true);
    expect(sameStart(s, { ...s })).toBe(true);
    expect(sameStart(s, { ...s, lat: 1.1 })).toBe(false);
    expect(sameStart(s, null)).toBe(false);
    expect(sameStart(null, s)).toBe(false);
  });
  it('every word exists in French and English', () => {
    expect(Object.keys(en.start).sort()).toEqual(Object.keys(fr.start).sort());
    for (const k of ['ownStart', 'leaves'] as const) { expect(frMap.legend[k]).toBeTruthy(); expect(enMap.legend[k]).toBeTruthy(); }
  });
});
