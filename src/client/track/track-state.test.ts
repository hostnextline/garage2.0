import { describe, it, expect } from 'vitest';
import { trackView, arrival, headline, isFinal, routeOf, project, pointAt, minutesLeft, liveEta, calm, glidePath, OFF_ROUTE_M, type Calm, type Route } from './track-state';
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

/* ---------- the live arrival ---------- */

// a bent route in Montréal: 0.01° north (≈ 1112 m), then 0.01° east (≈ 780 m at this latitude)
const A: [number, number] = [45.5, -73.6];
const B: [number, number] = [45.51, -73.6];
const C: [number, number] = [45.51, -73.59];
const BENT = routeOf([A, B, C]) as Route;
const near = (x: number, want: number, tol: number) => expect(Math.abs(x - want), `${x} ≈ ${want} ± ${tol}`).toBeLessThanOrEqual(tol);

describe('where he is on his route (projection)', () => {
  it('measures the route once: metres to each point, its length', () => {
    near(BENT.cum[1], 1112, 3);
    near(BENT.total, 1112 + 780, 5);
    expect(routeOf([A])).toBeNull();
    expect(routeOf([A, A])).toBeNull();          // no length
    expect(routeOf(null)).toBeNull();
  });
  it('on the route: how far along, nothing off', () => {
    const o = project(BENT, { lat: 45.505, lng: -73.6 });
    near(o.along, 556, 3);
    near(o.off, 0, 0.5);
    expect(o.seg).toBe(0);
    const c = project(BENT, { lat: 45.51, lng: -73.595 });   // the middle of the second leg
    near(c.along, 1112 + 390, 5);
    expect(c.seg).toBe(1);
  });
  it('a little beside the road: the same place on the route, the metres beside it', () => {
    const o = project(BENT, { lat: 45.505, lng: -73.6005 });   // ≈ 39 m west of the first leg
    near(o.along, 556, 3);
    near(o.off, 39, 2);
  });
  it('before its start: the start; past its end: the end', () => {
    const before = project(BENT, { lat: 45.495, lng: -73.6 });
    expect(before.along).toBe(0);
    near(before.off, 556, 3);
    const past = project(BENT, { lat: 45.51, lng: -73.58 });
    expect(past.along).toBe(BENT.total);
    near(past.off, 780, 4);
  });
  it('off the route: the nearest point of it, far', () => {
    const o = project(BENT, { lat: 45.5, lng: -73.59 });       // the empty corner of the L
    near(o.off, 780, 4);
    expect(o.off).toBeGreaterThan(OFF_ROUTE_M);
  });
  it('the point so many metres along it', () => {
    expect(pointAt(BENT, 0)).toEqual({ lat: A[0], lng: A[1] });
    expect(pointAt(BENT, -5)).toEqual({ lat: A[0], lng: A[1] });
    expect(pointAt(BENT, BENT.total + 9)).toEqual({ lat: C[0], lng: C[1] });
    const p = pointAt(BENT, BENT.cum[1] + 390);
    near(p.lat, 45.51, 1e-6);
    near(p.lng, -73.595, 2e-5);
  });
});

describe('the minutes left along a bent route', () => {
  it('the distance left on the road over the whole road, times the planned minutes (not the straight line)', () => {
    near(minutesLeft(BENT, { lat: A[0], lng: A[1] }, 20).left, 20, 1e-9);
    // half the first leg: 556 + 780 m of road left of 1892 → 14.1 min (in a straight line to the end it would be 10.1)
    near(minutesLeft(BENT, { lat: 45.505, lng: -73.6 }, 20).left, 14.12, 0.05);
    near(minutesLeft(BENT, { lat: B[0], lng: B[1] }, 20).left, 8.25, 0.05);           // the corner
    near(minutesLeft(BENT, { lat: 45.51, lng: -73.595 }, 20).left, 4.12, 0.05);
    expect(minutesLeft(BENT, { lat: C[0], lng: C[1] }, 20).left).toBe(0);
    expect(minutesLeft(BENT, { lat: 45.51, lng: -73.58 }, 20).left).toBe(0);           // past the house
  });
});

describe('the live arrival of an answer (liveEta)', () => {
  const T = Date.parse(NOW);
  const on = (o: Partial<TrackAnswer> = {}): TrackAnswer => active({ route: [A, B, C], minutes: 20, dest: { lat: C[0], lng: C[1] },
    pos: { lat: 45.505, lng: -73.6, at: new Date(T - 10000).toISOString() }, eta_at: new Date(T + 3 * 60000).toISOString(), ...o });
  it('from where he is: minutes left from the server’s « now », and the arrival moment', () => {
    const e = liveEta(on(), T + 5000)!;
    near(e.left, 14.12, 0.05);
    expect(e.arrive).toBe(T + e.left * 60000);
  });
  it('is not trusted (the server’s eta_at stays) for an old position, a position off the route, no route, no planned minutes', () => {
    expect(liveEta(on({ pos: { lat: 45.505, lng: -73.6, at: new Date(T - 3 * 60000).toISOString() } }), T)).toBeNull();   // 3 min old
    expect(liveEta(on({ pos: { lat: 45.505, lng: -73.6, at: new Date(T - 100000).toISOString() } }), T)).not.toBeNull();  // 1 min 40: fine
    expect(liveEta(on({ pos: { lat: 45.5, lng: -73.59, at: NOW } }), T)).toBeNull();                                       // 780 m off
    expect(liveEta(on({ pos: { lat: 45.505, lng: -73.6045, at: NOW } }), T)).not.toBeNull();                               // ≈ 350 m off: trusted
    expect(liveEta(on({ pos: { lat: 45.505, lng: -73.606, at: NOW } }), T)).toBeNull();                                    // ≈ 470 m off
    expect(liveEta(on({ route: null }), T)).toBeNull();
    expect(liveEta(on({ route: [A] }), T)).toBeNull();
    expect(liveEta(on({ minutes: null }), T)).toBeNull();
    expect(liveEta(on({ minutes: 0 }), T)).toBeNull();
    expect(liveEta(on({ pos: null }), T)).toBeNull();
    expect(liveEta(on({ status: 'arrived' }), T)).toBeNull();
  });
});

describe('the calm rule (the minutes shown never flicker)', () => {
  const run = (vals: number[]) => { let s: Calm | null = null; return vals.map((x) => (s = calm(s, x)).v); };
  it('the first value is shown; a change under a full minute is not', () => {
    expect(run([10.2, 9.6, 10.9, 9.4])).toEqual([10.2, 10.2, 10.2, 10.2]);
  });
  it('a full minute more must hold for two answers in a row', () => {
    expect(run([10, 11.2, 11.3])).toEqual([10, 10, 11.3]);
    // up once, back, up once again: never shown
    expect(run([10, 11.2, 10.1, 11.2, 10.3, 11.4])).toEqual([10, 10, 10, 10, 10, 10]);
    // a full minute more, then a full minute less: the two do not make « holds »
    expect(run([10, 11.2, 8.6])).toEqual([10, 10, 10]);
  });
  it('drops at once when he is clearly closer (2 minutes or more); a smaller drop holds two answers', () => {
    expect(run([10, 7.9])).toEqual([10, 7.9]);
    expect(run([10, 8.6, 8.5])).toEqual([10, 10, 8.5]);
  });
  it('stuck in traffic (the same place for minutes): the same minutes, no « 1 min » while he is far', () => {
    const shown = run(Array.from({ length: 24 }, () => 9.4)).map(Math.round);
    expect(new Set(shown)).toEqual(new Set([9]));
  });
  it('driving at the planned pace (a twelfth of a minute every 5 s): one minute less about every minute, never back up', () => {
    const raw = Array.from({ length: 12 * 6 }, (_, i) => 10 - i / 12);   // 6 minutes of answers, 5 s apart
    const shown = run(raw).map(Math.round);
    let changes = 0;
    for (let i = 1; i < shown.length; i++) { expect(shown[i]).toBeLessThanOrEqual(shown[i - 1]); if (shown[i] !== shown[i - 1]) changes++; }
    expect(changes).toBeGreaterThanOrEqual(5);
    expect(changes).toBeLessThanOrEqual(6);
  });
});

describe('the card with a live arrival (what useTrack keeps)', () => {
  const T = Date.parse(NOW);   // 12:31
  it('shows the live minutes and their time, not the server’s eta_at', () => {
    const v = trackView(active(), T, T, { left: 14.2, arrive: T + 14.2 * 60000 });
    expect(v.eta).toEqual({ minute: 12 * 60 + 45, left: 14 });
    expect(sp(arrival(v, 'fr').when)).toBe('Arrivée prévue vers 12 h 45');
  });
  it('counts down only when answers stop coming; never earlier than now; « bientôt » when nearly there', () => {
    const held = { left: 6, arrive: T + 6 * 60000 };
    expect(trackView(active(), T, T + 5000, held).eta?.left).toBe(6);                 // the next answer is due
    expect(trackView(active(), T, T + 3 * 60000, held).eta?.left).toBe(3);            // three minutes without an answer
    const late = trackView(active(), T, T + 9 * 60000, held);
    expect(late.eta).toEqual({ minute: 12 * 60 + 40, left: 0 });                       // 12:40 = now, not 12:37
    expect(arrival(late, 'fr')).toEqual({ left: null, when: 'Arrivée d’un instant à l’autre' });
    expect(arrival(trackView(active(), T, T, { left: 0.8, arrive: T + 48000 }), 'en').when).toBe('Arriving any minute now');
  });
  it('without a live arrival: the server’s eta_at, as before', () => {
    expect(trackView(active(), T, T, null).eta).toEqual({ minute: 12 * 60 + 40, left: 9 });
  });
});

describe('the way the dot glides (glidePath)', () => {
  it('follows the route’s bend when both ends are on it', () => {
    const way = glidePath({ lat: 45.508, lng: -73.6 }, { lat: 45.51, lng: -73.598 }, BENT);
    expect(way).toEqual([[45.508, -73.6], B, [45.51, -73.598]]);
  });
  it('straight when an end is off the route, when he goes backwards, or without a route', () => {
    expect(glidePath({ lat: 45.508, lng: -73.603 }, { lat: 45.51, lng: -73.598 }, BENT)).toHaveLength(2);   // 230 m beside it
    expect(glidePath({ lat: 45.51, lng: -73.598 }, { lat: 45.508, lng: -73.6 }, BENT)).toHaveLength(2);     // backwards
    expect(glidePath({ lat: 45.508, lng: -73.6 }, { lat: 45.51, lng: -73.598 }, null)).toHaveLength(2);
    expect(glidePath({ lat: 45.502, lng: -73.6 }, { lat: 45.504, lng: -73.6 }, BENT)).toHaveLength(2);      // no bend between
  });
});
