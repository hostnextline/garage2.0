/* The truck's glide on the tracking map, with a pretended clock and pretended frames (60 a second): it starts where
   the dot is, ends on the new position, follows the route's bend, and is placed at once for the first position, a
   big jump, « reduce motion », a page back on screen. */
import { describe, it, expect } from 'vitest';
import { glider, GLIDE_MAX_MS, GLIDE_MIN_MS, type Frames } from './glide';
import { routeOf, project, type LatLng, type Route } from './track-state';
import { metres } from '../../shared/places/photon';

function pretend(reduced = false) {
  let t = 0, n = 0;
  const queue = new Map<number, () => void>();
  const f: Frames = { now: () => t, request: (cb) => { queue.set(++n, cb); return n; }, cancel: (id) => { queue.delete(id); }, reduced: () => reduced };
  /** the clock moves on by ms, a frame every 16 ms */
  const advance = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 16);
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb());
    }
  };
  return { f, advance, pending: () => queue.size };
}
const drawn: LatLng[] = [];
const draw = (p: LatLng) => { drawn.push(p); };
const m = (a: LatLng, b: LatLng) => metres(a.lat, a.lng, b.lat, b.lng);
const maxStep = (pts: LatLng[]) => pts.slice(1).reduce((mx, p, i) => Math.max(mx, m(pts[i], p)), 0);

const A = { lat: 45.5, lng: -73.6 };
const N200 = { lat: 45.5018, lng: -73.6 };   // ≈ 200 m north

describe('the truck’s glide', () => {
  it('the first position is placed at once', () => {
    drawn.length = 0;
    const c = pretend();
    const g = glider(draw, c.f);
    g.to(A);
    expect(drawn).toEqual([A]);
    expect(g.gliding()).toBe(false);
    expect(c.pending()).toBe(0);
  });
  it('glides from where it is to the new position over about the time between them, in small steps, and ends on it', () => {
    const c = pretend();
    const g = glider(draw, c.f);
    g.to(A);
    drawn.length = 0;
    g.to(N200, { gapMs: 10000 });                  // 10 s between the positions → 12.5 s of glide
    expect(drawn[0]).toEqual(A);                   // it starts where the dot is
    c.advance(6250);
    const mid = drawn[drawn.length - 1];
    expect(Math.abs(m(A, mid) - 100)).toBeLessThan(3);   // halfway in time: halfway on the way
    expect(g.gliding()).toBe(true);
    c.advance(6300);
    expect(drawn[drawn.length - 1]).toEqual(N200);
    expect(g.gliding()).toBe(false);
    expect(c.pending()).toBe(0);                   // no frame asked once it is there
    expect(maxStep(drawn)).toBeLessThan(1);        // 200 m in ~780 frames: a quarter metre each
  });
  it('a new position during a glide starts from where the dot IS, never from the old target', () => {
    const c = pretend();
    const g = glider(draw, c.f);
    g.to(A);
    g.to(N200, { gapMs: 10000 });
    c.advance(5000);                               // 40 % of the way
    const there = g.where()!;
    expect(Math.abs(m(A, there) - 80)).toBeLessThan(3);
    drawn.length = 0;
    const next = { lat: 45.5036, lng: -73.6 };     // 400 m north of A
    g.to(next, { gapMs: 10000 });
    expect(drawn[0]).toEqual(there);
    c.advance(13000);
    expect(drawn[drawn.length - 1]).toEqual(next);
    expect(maxStep(drawn)).toBeLessThan(1);        // no jump back to the old target, no jump forward
  });
  it('follows the route’s bend between two positions on it (not across the corner)', () => {
    const route = routeOf([[45.5, -73.6], [45.51, -73.6], [45.51, -73.59]]) as Route;
    const c = pretend();
    const g = glider(draw, c.f);
    const from = { lat: 45.509, lng: -73.6 }, to = { lat: 45.51, lng: -73.5987 };   // 111 m before the corner, 101 m after
    g.to(from);
    drawn.length = 0;
    g.to(to, { gapMs: 8000, route });
    c.advance(10000);
    expect(drawn[drawn.length - 1]).toEqual(to);
    // every point drawn is on the road; the corner is passed through
    for (const p of drawn) expect(project(route, p).off).toBeLessThan(1);
    expect(Math.min(...drawn.map((p) => m(p, { lat: 45.51, lng: -73.6 })))).toBeLessThan(1);
  });
  it('straight across when an end is off the route', () => {
    const route = routeOf([[45.5, -73.6], [45.51, -73.6], [45.51, -73.59]]) as Route;
    const c = pretend();
    const g = glider(draw, c.f);
    const from = { lat: 45.509, lng: -73.602 }, to = { lat: 45.51, lng: -73.5987 };  // 156 m west of the road
    g.to(from);
    g.to(to, { gapMs: 8000, route });
    c.advance(5000);                               // half of the 10 s
    const mid = g.where()!;
    expect(m(mid, { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 })).toBeLessThan(2);
  });
  it('placed at once: a jump of more than 1.5 km, « reduce motion », a page back on screen', () => {
    for (const [reduced, target, o] of [
      [false, { lat: 45.52, lng: -73.6 }, {}],                 // 2.2 km away
      [true, N200, {}],
      [false, N200, { instant: true }]
    ] as [boolean, LatLng, { instant?: boolean }][]) {
      const c = pretend(reduced);
      const g = glider(draw, c.f);
      g.to(A);
      drawn.length = 0;
      g.to(target, { gapMs: 10000, ...o });
      expect(drawn).toEqual([target]);
      expect(g.gliding()).toBe(false);
      expect(c.pending()).toBe(0);
    }
  });
  it('the glide lasts 1 s at least and 20 s at most', () => {
    for (const [gap, ends] of [[100, GLIDE_MIN_MS], [60000, GLIDE_MAX_MS]]) {
      const c = pretend();
      const g = glider(draw, c.f);
      g.to(A);
      g.to(N200, { gapMs: gap });
      c.advance(ends - 40);
      expect(g.gliding()).toBe(true);
      c.advance(60);
      expect(g.gliding()).toBe(false);
      expect(g.where()).toEqual(N200);
    }
  });
  it('the page hidden: the glide ends on its target at once; gone: nothing more is drawn, the next position is placed at once', () => {
    const c = pretend();
    const g = glider(draw, c.f);
    g.to(A);
    g.to(N200, { gapMs: 10000 });
    c.advance(2000);
    g.finish();
    expect(g.where()).toEqual(N200);
    expect(c.pending()).toBe(0);
    g.to(A, { gapMs: 10000 });
    c.advance(1000);
    drawn.length = 0;
    g.stop();
    c.advance(20000);
    expect(drawn).toEqual([]);
    expect(g.where()).toBeNull();
    g.to(N200, { gapMs: 10000 });
    expect(drawn).toEqual([N200]);
  });
});
