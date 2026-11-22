import { describe, it, expect, beforeEach } from 'vitest';
import { tsMicros, cmpTs, sampleServerTime, serverNow, resetServerClock } from './clock';
import { sameValue, merge3 } from './merge';

describe('timestamps as Postgres writes them', () => {
  it('reads microseconds exactly, whatever the writing', () => {
    expect(tsMicros('2026-11-15T10:00:03.5+00:00')).toBe(tsMicros('2026-11-15T10:00:03.500000Z'));
    expect(tsMicros('2026-11-15 10:00:03.123456+00')).toBe(Date.UTC(2026, 10, 15, 10, 0, 3) * 1000 + 123456);
    expect(tsMicros('2026-11-15T05:00:03-05:00')).toBe(tsMicros('2026-11-15T10:00:03Z'));
    expect(Number.isNaN(tsMicros('hier'))).toBe(true);
  });
  it('orders what string order and Date.parse get wrong', () => {
    // .5 is later than .123456, although the string compares the other way
    expect(cmpTs('2026-11-15T10:00:03.5+00:00', '2026-11-15T10:00:03.123456+00:00')).toBeGreaterThan(0);
    // two stamps of one millisecond
    expect(cmpTs('2026-11-15T10:00:03.123457+00:00', '2026-11-15T10:00:03.123456+00:00')).toBeGreaterThan(0);
    expect(cmpTs('2026-11-15T10:00:03Z', '2026-11-15T10:00:03.000000+00:00')).toBe(0);
    expect(cmpTs(null, '2026-11-15T10:00:03Z')).toBeLessThan(0);
  });
});

describe('the server\'s clock', () => {
  beforeEach(() => resetServerClock());
  it('follows the stamp of our own write, the shortest round trip winning', () => {
    const now = Date.now();
    sampleServerTime(new Date(now + 60000).toISOString(), now - 100, now + 100);
    expect(Math.abs(serverNow() - (Date.now() + 60000))).toBeLessThan(1000);
    // a slower answer does not replace it
    sampleServerTime(new Date(now + 5000).toISOString(), now - 5000, now + 5000);
    expect(Math.abs(serverNow() - (Date.now() + 60000))).toBeLessThan(1000);
  });
  it('is the phone\'s own until sampled', () => { expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50); });
});

describe('row values', () => {
  it('sameValue compares data, not objects', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });
  it('merge3 sets what I changed and keeps what someone else changed (core-data-19)', () => {
    const prev = { speed_kmh: 35, detour: 1.3, blocks: [1, 2] };
    const mine = { speed_kmh: 40, detour: 1.3, blocks: [1, 2] };
    const theirs = { speed_kmh: 35, detour: 1.5, blocks: [1, 2], home: { label: 'Centrale' } };
    expect(merge3(prev, mine, theirs)).toEqual({ speed_kmh: 40, detour: 1.5, blocks: [1, 2], home: { label: 'Centrale' } });
  });
  it('a stale copy on the phone never writes its old values over untouched keys', () => {
    const shown = { home: { label: 'Vieux départ', lat: 1 }, speed_kmh: 35 };
    const saved = { home: { label: 'Vieux départ', lat: 1 }, speed_kmh: 30 };
    const server = { home: { label: 'Centrale', lat: 45.5 }, speed_kmh: 35 };
    expect(merge3(shown, saved, server)).toEqual({ home: { label: 'Centrale', lat: 45.5 }, speed_kmh: 30 });
  });
  it('nested objects merge key by key; a key I removed is removed; arrays are one value', () => {
    expect(merge3({ on: { a: true, b: true } }, { on: { a: false, b: true } }, { on: { a: true, b: false, c: true } })).toEqual({ on: { a: false, b: false, c: true } });
    expect(merge3({ x: 1, y: 2 }, { x: 1 }, { x: 1, y: 3 })).toEqual({ x: 1 });
    expect(merge3({ l: [1] }, { l: [1, 2] }, { l: [3] })).toEqual({ l: [1, 2] });
  });
  it('a part that is not an object: mine when I changed it, else theirs', () => {
    expect(merge3(['a'], ['a'], ['b'])).toEqual(['b']);
    expect(merge3(['a'], ['c'], ['b'])).toEqual(['c']);
  });
});
