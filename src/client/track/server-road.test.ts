/* The line of a trip's road as the server keeps it (supabase/functions/_shared/road.ts, used by « Je pars »): the road
   planner's full road, thinned to the points that shape it. Hassan, 2026-11-21, on the tracking page: « it's a straight
   line, it doesn't show the actual route »: the line must stay on the streets, bends and all. */
import { describe, it, expect } from 'vitest';
import { thinRoad, ROAD_MAX, ROAD_TOL_M, type RoadPt } from '../../../supabase/functions/_shared/road';
import handler from '../../../supabase/functions/enroute/handler.ts?raw';

const M = 111320;
const KX = M * Math.cos((45.5 * Math.PI) / 180);
/** a point x metres east and y metres north of a corner of Montréal */
const at = (x: number, y: number): RoadPt => [45.5 + y / M, -73.65 + x / KX];
/** metres from p to the piece a–b */
function off(p: RoadPt, a: RoadPt, b: RoadPt): number {
  const px = (p[1] - a[1]) * KX, py = (p[0] - a[0]) * M, bx = (b[1] - a[1]) * KX, by = (b[0] - a[0]) * M;
  const l = bx * bx + by * by;
  const t = l > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / l)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}
/** the farthest a point of the full road sits from the thinned line, in metres */
const worst = (full: RoadPt[], thin: RoadPt[]) => Math.max(...full.map((p) => Math.min(...thin.slice(1).map((b, i) => off(p, thin[i], b)))));
const same = (a: RoadPt, b: RoadPt) => a[0] === b[0] && a[1] === b[1];

/** a street every `step` metres from (x0, y0) to (x1, y1), the first point left out */
function street(x0: number, y0: number, x1: number, y1: number, step = 10): RoadPt[] {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n }, (_, i) => at(x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n));
}

describe('thinRoad: the points that shape the road, and only those', () => {
  it('a straight street of 200 points: its two ends', () => {
    const line = [at(0, 0), ...street(0, 0, 2000, 0)];
    expect(line.length).toBe(201);
    expect(thinRoad(line)).toEqual([at(0, 0), at(2000, 0)]);
  });

  it('a route by the streets (east, a corner, north, a corner, east): every corner kept, exactly where it is', () => {
    const line = [at(0, 0), ...street(0, 0, 800, 0), ...street(800, 0, 800, 600), ...street(800, 600, 1500, 600)];
    const thin = thinRoad(line);
    expect(thin).toEqual([at(0, 0), at(800, 0), at(800, 600), at(1500, 600)]);
    // the old way (one straight line from end to end, or one point in N) passed hundreds of metres from the corner
    expect(off(at(800, 0), at(0, 0), at(1500, 600))).toBeGreaterThan(250);
  });

  it('a bend of the road (a quarter circle of 60 m, a point every 2 m): the line stays within the tolerance of every point', () => {
    const arc: RoadPt[] = Array.from({ length: 48 }, (_, i) => { const a = ((i + 1) / 48) * (Math.PI / 2); return at(500 + 60 * Math.sin(a), 60 - 60 * Math.cos(a)); });
    const line = [at(0, 0), ...street(0, 0, 500, 0), ...arc, ...street(560, 60, 560, 700)];
    const thin = thinRoad(line);
    expect(worst(line, thin)).toBeLessThanOrEqual(ROAD_TOL_M);
    // far fewer points than the planner gave, and several of them in the bend
    expect(thin.length).toBeLessThan(line.length / 5);
    expect(thin.filter((p) => arc.some((q) => same(p, q))).length).toBeGreaterThanOrEqual(3);
    // both ends are the road's own
    expect(same(thin[0], line[0]) && same(thin[thin.length - 1], line[line.length - 1])).toBe(true);
  });

  it('a small jog of 2 m (a lane change in the planner’s data) is not a bend; one of 8 m is', () => {
    expect(thinRoad([at(0, 0), at(100, 2), at(200, 0)])).toEqual([at(0, 0), at(200, 0)]);
    expect(thinRoad([at(0, 0), at(100, 8), at(200, 0)])).toEqual([at(0, 0), at(100, 8), at(200, 0)]);
  });

  it('a very long winding road: never more than the most points, the smallest bends go first, the ends stay', () => {
    // 6 000 points: a zigzag of 30 m every 40 m (every point is a bend of its own)
    const line: RoadPt[] = Array.from({ length: 6000 }, (_, i) => at(i * 40, i % 2 ? 30 : 0));
    const thin = thinRoad(line);
    expect(thin.length).toBeLessThanOrEqual(ROAD_MAX);
    expect(thin.length).toBeGreaterThanOrEqual(2);
    expect(same(thin[0], line[0]) && same(thin[thin.length - 1], line[line.length - 1])).toBe(true);
    // a smaller most: obeyed too
    expect(thinRoad(line, 50).length).toBeLessThanOrEqual(50);
    // the same road with one big detour of 2 km in it: the detour is what is kept
    const far = at(120000, 2000);
    const withDetour = [...line.slice(0, 3000), far, ...line.slice(3000)];
    expect(thinRoad(withDetour, 50).some((p) => same(p, far))).toBe(true);
  });

  it('a road that comes back to where it started (a loop) keeps its far end', () => {
    const line = [at(0, 0), ...street(0, 0, 400, 0), ...street(400, 0, 400, 300), ...street(400, 300, 0, 300), ...street(0, 300, 0, 0)];
    expect(thinRoad(line)).toEqual([at(0, 0), at(400, 0), at(400, 300), at(0, 300), at(0, 0)]);
  });

  it('short or broken lists: nothing invented, the list given is never changed', () => {
    expect(thinRoad(null)).toEqual([]);
    expect(thinRoad([])).toEqual([]);
    expect(thinRoad([at(0, 0)])).toEqual([at(0, 0)]);
    expect(thinRoad([at(0, 0), at(50, 0)])).toEqual([at(0, 0), at(50, 0)]);
    // the same point twice in a row (the planner does it at a turn): once; a broken point: dropped
    const given = [at(0, 0), at(0, 0), [NaN, 1] as RoadPt, at(300, 0), at(300, 0), at(300, 400)];
    const copy = JSON.stringify(given);
    expect(thinRoad(given)).toEqual([at(0, 0), at(300, 0), at(300, 400)]);
    expect(JSON.stringify(given)).toBe(copy);
  });
});

describe('« Je pars » asks the road planner for the road in full', () => {
  it('overview=full, thinned by thinRoad; never the « simplified » road, never one point in N', () => {
    expect(handler).toContain('overview=full&geometries=geojson');
    expect(handler).not.toContain('overview=simplified');
    expect(handler).toMatch(/const line = thinRoad\(/);
    expect(handler).not.toMatch(/i % step === 0/);
  });
});
