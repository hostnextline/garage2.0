/* The truck's dot on the tracking map glides from where it is drawn to each new position (requestAnimationFrame), over
   about the time between the two positions, along the route's bends when both ends are on it (glidePath). Placed at
   once instead: the first position, a jump of more than 1.5 km, a page just back on screen (instant), « reduce motion ».
   A new position during a glide starts from where the dot IS. The clock and the frames are given: the tests pretend
   them (glide.test.ts). */
import { metres } from '../../shared/places/photon';
import { glidePath, pointAt, routeOf, type LatLng, type Route } from './track-state';

/** farther than this from where the dot is: placed at once (no glide across the city) */
export const JUMP_M = 1500;
/** the glide lasts between 1 s and 20 s */
export const GLIDE_MIN_MS = 1000;
export const GLIDE_MAX_MS = 20000;
/** a little longer than the time between the two positions: the next one usually comes before the dot stops, so it
    does not stop and start again at each answer (the page asks every 5 s, the phone sends every 10 s) */
export const GLIDE_STRETCH = 1.25;
/** the time between two positions when it is not known: the phone's pace while driving */
export const GLIDE_GAP_MS = 10000;

export interface Frames {
  now(): number;
  request(cb: () => void): number;
  cancel(id: number): void;
  /** « reduce motion » on the phone: no glide */
  reduced(): boolean;
}

export function prefersReduced(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export const browserFrames: Frames = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  request: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => cb()) : (setTimeout(cb, 16) as unknown as number)),
  cancel: (id) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); clearTimeout(id); },
  reduced: prefersReduced
};

export interface GlideTo {
  /** the time between this position and the one before (ms); unknown: GLIDE_GAP_MS */
  gapMs?: number | null;
  /** the route, to follow its bends */
  route?: Route | null;
  /** placed at once (the page just came back on screen) */
  instant?: boolean;
}
export interface Glider {
  /** to a new position */
  to(target: LatLng, o?: GlideTo): void;
  /** the glide ends now, on its target (the page is hidden) */
  finish(): void;
  /** stops without drawing anything more and forgets where the dot is: the next position is placed at once (the
      position is gone, the map goes away) */
  stop(): void;
  /** where the dot is drawn (null: nowhere yet) */
  where(): LatLng | null;
  gliding(): boolean;
}

export function glider(draw: (p: LatLng) => void, f: Frames = browserFrames): Glider {
  let cur: LatLng | null = null;
  let target: LatLng | null = null;
  let way: Route | null = null;
  let t0 = 0;
  let dur = 1;
  let id: number | null = null;

  const put = (p: LatLng) => { cur = p; draw(p); };
  const cancel = () => { if (id != null) f.cancel(id); id = null; };
  const at = (): LatLng => (way ? pointAt(way, Math.min(1, (f.now() - t0) / dur) * way.total) : target!);
  const step = () => {
    id = null;
    if (!target) return;
    if (f.now() - t0 >= dur || !way) { put(target); return; }
    put(at());
    id = f.request(step);
  };

  return {
    to(next, o = {}) {
      // from where the dot is now (in the middle of a glide: there, never the old target)
      const from = id != null ? at() : cur;
      cancel();
      target = { lat: next.lat, lng: next.lng };
      way = null;
      if (!from || o.instant || f.reduced() || metres(from.lat, from.lng, next.lat, next.lng) > JUMP_M) { put(target); return; }
      way = routeOf(glidePath(from, target, o.route ?? null));
      if (!way) { put(target); return; }   // already there
      const gap = o.gapMs != null && Number.isFinite(o.gapMs) && o.gapMs > 0 ? o.gapMs : GLIDE_GAP_MS;
      dur = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, gap * GLIDE_STRETCH));
      t0 = f.now();
      put(from);
      id = f.request(step);
    },
    finish() { if (id != null) { cancel(); if (target) put(target); } },
    stop() { cancel(); cur = null; target = null; way = null; },
    where() { return cur; },
    gliding() { return id != null; }
  };
}
