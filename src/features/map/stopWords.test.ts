import { describe, it, expect } from 'vitest';
import { whenOf, lateStop, winOf, kmText, durText, fmtKm, lostStops, findable } from './stopWords';
import type { Stop } from '../../shared/map/assemble';

const stop = (o: Partial<Stop> = {}): Stop => ({ id: 'j', number: 1, truckId: 't', n: 1, block: 'am', order: 1, etaMin: 600, status: 'booked', name: 'Julie', address: '', lat: 45.5, lng: -73.6, hasPos: true, done: false, live: false, ...o });

describe('the words of a stop on the map', () => {
  it('a block job: its block and its planned arrival', () => {
    expect(whenOf(stop(), null, 'fr')).toBe('Matin, vers 10 h');
    expect(whenOf(stop({ etaMin: null, block: 'pm' }), null, 'fr')).toBe('Après-midi');
  });
  it('booked by arrival window: the window of the server, else of the phone’s copy of the job', () => {
    expect(whenOf(stop({ block: 'day', win: [540, 780] }), null, 'fr')).toBe('Entre 9 h et 13 h, vers 10 h');
    expect(whenOf(stop({ block: 'day' }), { win_start: 540, win_end: 780 }, 'fr')).toBe('Entre 9 h et 13 h, vers 10 h');
    expect(whenOf(stop({ block: 'day', flex: true, etaMin: null }), null, 'fr')).toBe('Dans la journée (plage confirmée la veille)');
  });
  it('a window nobody here knows (another truck’s job, not on this phone): « Dans la journée », not a guess (x-dualmode-12)', () => {
    expect(whenOf(stop({ block: 'day', etaMin: null }), null, 'fr')).toBe('Dans la journée');
    expect(whenOf(stop({ block: 'day', etaMin: null }), undefined, 'en')).toBe('During the day');
  });
  it('« Hors plage »: a coming stop planned outside its window', () => {
    expect(lateStop(stop({ block: 'day', win: [540, 580] }))).toBe(true);
    expect(lateStop(stop({ block: 'day', win: [540, 780] }))).toBe(false);
    expect(lateStop(stop({ block: 'day', win: [540, 580], status: 'en_route' }))).toBe(false);
    expect(lateStop(stop({ block: 'day' }), { win_start: 540, win_end: 580 })).toBe(true);
    expect(winOf(stop({ block: 'day' }), { win_start: null, win_end: null })).toBeNull();
  });
  it('the road in km and time', () => {
    expect(kmText(23.46, 'fr')).toBe('23');
    expect(kmText(9.46, 'fr')).toBe('9,5');
    expect(kmText(9.46, 'en')).toBe('9.5');
    expect(durText(36)).toBe('36 min');
    expect(durText(65)).toBe('1 h 05');
    expect(fmtKm(6.25, 'fr')).toMatch(/^6,3$/);
  });
});

describe('« Trouver »', () => {
  const lost = lostStops([stop({ id: 'a', hasPos: false, lat: null, lng: null }), stop({ id: 'b', hasPos: false, status: 'done', done: true }), stop({ id: 'c' }), stop({ id: 'd', hasPos: false, status: 'on_site' }), stop({ id: 'e', hasPos: false })]);
  it('the note counts every stop not done without a position', () => expect(lost.map((s) => s.id)).toEqual(['a', 'd', 'e']));
  it('the button looks only for what the locator will look for: today on, coming, on this phone (map-hours-17)', () => {
    expect(findable(lost, '2026-11-16', '2026-11-16', (id) => id !== 'e').map((s) => s.id)).toEqual(['a', 'd']);
    expect(findable(lost, '2026-11-15', '2026-11-16', () => true)).toEqual([]);   // yesterday's map: nothing to search
  });
});
