import { describe, it, expect } from 'vitest';
import { trackView, arrival, headline, isFinal } from './track-state';
import type { TrackAnswer } from '../api';

const sp = (s: string | null) => String(s).replace(/\s/g, ' ');
// 12:31 in Montréal (winter time, UTC-5)
const NOW = '2026-11-04T17:31:00Z';
const active = (o: Partial<TrackAnswer> = {}): TrackAnswer => ({
  status: 'active', garage: { name: 'Mécanique Mobile H.I.S', phone: '438 901-6606' }, mechanic: 'Adam Ismail', customer: 'Amira', lang: 'fr',
  dest: { lat: 45.5307, lng: -73.6702 }, route: [[45.5005, -73.6577], [45.5201, -73.6655], [45.5307, -73.6702]],
  km: 6.2, minutes: 14, eta_at: '2026-11-04T17:40:00Z', ended_at: null, now: NOW, pos: { lat: 45.5201, lng: -73.6655, at: '2026-11-04T17:30:40Z' }, ...o
});

describe('the tracking page', () => {
  it('shows the truck, the house, the route and « Arrivée prévue vers 12 h 40 (environ 9 min) »', () => {
    const at = Date.parse(NOW);
    const v = trackView(active(), at, at);
    expect(v.kind).toBe('active');
    expect(v.mechanic).toBe('Adam');
    expect(v.pos).toMatchObject({ lat: 45.5201, lng: -73.6655 });
    expect(v.dest).toEqual({ lat: 45.5307, lng: -73.6702 });
    expect(v.route).toHaveLength(3);
    expect(v.eta).toEqual({ minute: 12 * 60 + 40, left: 9 });
    expect(v.posMinute).toBe(12 * 60 + 30);
    // the card: « 9 min » big, then « Arrivée prévue vers 12 h 40 »
    expect(arrival(v, 'fr').left).toBe(9);
    expect(sp(arrival(v, 'fr').when)).toBe('Arrivée prévue vers 12 h 40');
    expect(sp(arrival(v, 'en').when)).toBe('Arriving around 12:40 p.m.');
    expect(headline(v, 'fr')).toBe('Adam est en route');
    expect(headline(v, 'en')).toBe('Adam is on the way');
    expect(isFinal(v.kind)).toBe(false);
  });
  it('counts the minutes on the server’s clock, even when the phone is 10 minutes late', () => {
    const phoneAt = Date.parse(NOW) - 10 * 60000;          // the phone thinks it is 12:21
    const v = trackView(active(), phoneAt, phoneAt + 2 * 60000);   // two minutes after the answer
    expect(v.eta?.left).toBe(7);
    expect(v.eta?.minute).toBe(760);                       // the time shown stays the real one
  });
  it('says « d’un instant à l’autre » once the time is reached', () => {
    const at = Date.parse(NOW);
    const v = trackView(active({ eta_at: '2026-11-04T17:31:30Z' }), at, at);
    expect(arrival(v, 'fr')).toEqual({ left: null, when: 'Arrivée d’un instant à l’autre' });
    expect(arrival(trackView(active(), at, at + 30 * 60000), 'en')).toEqual({ left: null, when: 'Arriving any minute now' });
  });
  it('has no arrival time without one, and no truck without a recent position', () => {
    const at = Date.parse(NOW);
    const v = trackView(active({ eta_at: null, pos: null }), at, at);
    expect(v.eta).toBeNull();
    expect(arrival(v, 'fr')).toEqual({ left: null, when: 'Il s’en vient chez vous.' });
    expect(v.pos).toBeNull();
    expect(v.posMinute).toBeNull();
    expect(trackView(active({ mechanic: '' }), at, at).mechanic).toBe('');
    expect(headline(trackView(active({ mechanic: null }), at, at), 'fr')).toBe('Votre mécano est en route');
  });
  it('drops broken points', () => {
    const at = Date.parse(NOW);
    const v = trackView(active({ route: [[45.5, -73.6], [999, 1], [0, 0], [45.55, -73.65], [45.6, -73.7]] as [number, number][], dest: { lat: NaN, lng: 2 } }), at, at);
    expect(v.route).toEqual([[45.5, -73.6], [45.55, -73.65], [45.6, -73.7]]);
    expect(v.dest).toBeNull();
  });
  it('a « road » of two points is the old server’s straight line: no route (never drawn); what is left of a broken one too', () => {
    const at = Date.parse(NOW);
    expect(trackView(active({ route: [[45.5005, -73.6577], [45.5307, -73.6702]] }), at, at).route).toEqual([]);
    expect(trackView(active({ route: [[45.5, -73.6], [999, 1], [45.6, -73.7]] as [number, number][] }), at, at).route).toEqual([]);
    expect(trackView(active({ route: null }), at, at).route).toEqual([]);
  });
  it('maps the end of the trip to plain words', () => {
    const at = Date.parse(NOW);
    const arrived = trackView({ status: 'arrived', mechanic: 'Adam', ended_at: '2026-11-04T17:38:00Z', now: NOW, garage: { name: 'G', phone: '4389016606' } }, at, at);
    expect(arrived.kind).toBe('arrived');
    expect(arrived.ended).toBe(12 * 60 + 38);
    expect(headline(arrived, 'fr')).toBe('Adam est arrivé');
    expect(arrived.pos).toBeNull();
    expect(isFinal(arrived.kind)).toBe(true);
    expect(trackView({ status: 'cancelled' }, at).kind).toBe('cancelled');
    expect(headline(trackView({ status: 'expired' }, at), 'en')).toBe('This tracking link has expired');
    expect(trackView({ status: 'not_found' }, at).kind).toBe('not_found');
    expect(trackView({ status: 'weird' }, at).kind).toBe('not_found');
    expect(trackView(null, at).kind).toBe('not_found');
  });
  it('keeps no map data once the trip is over, and reads the customer’s language', () => {
    const at = Date.parse(NOW);
    const v = trackView(active({ status: 'arrived', lang: 'en' }), at, at);
    expect(v.dest).toBeNull();
    expect(v.route).toEqual([]);
    expect(v.eta).toBeNull();
    expect(v.lang).toBe('en');
    expect(trackView(active({ lang: 'de' }), at, at).lang).toBeNull();
  });
});
