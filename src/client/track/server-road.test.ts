/* The line of a trip's road as the server keeps it (supabase/functions/_shared/road.ts, used by « Je pars »): the road
   planner's full road, thinned to the points that shape it. Hassan, 2026-11-21, on the tracking page: « it's a straight
   line, it doesn't show the actual route »: the line must stay on the streets, bends and all. */
import { describe, it, expect } from 'vitest';
import { thinRoad, ROAD_MAX, ROAD_IN_MAX, ROAD_TOL_M, type RoadPt } from '../../../supabase/functions/_shared/road';
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

  it('too many bends for a map: never more than the most points, the smallest bends go first, the ends stay', () => {
    // a street with 120 small jogs of 6 m and 10 big detours of 300 m (out and back)
    const line: RoadPt[] = [at(0, 0)];
    for (let i = 1; i <= 130; i++) line.push(at(i * 200 - 100, i % 13 === 0 ? 300 : 6), at(i * 200, 0));
    const ends = (l: RoadPt[]) => same(l[0], line[0]) && same(l[l.length - 1], line[line.length - 1]);
    expect(thinRoad(line).length).toBe(line.length);   // every jog is a bend of its own: all kept while they fit
    // room for the big detours only: they are all still drawn, what is lost is the small jogs (6 m), nothing more
    const thin = thinRoad(line, 60);
    expect(thin.length).toBeLessThanOrEqual(60);
    expect(ends(thin)).toBe(true);
    expect(worst(line, thin)).toBeLessThanOrEqual(6.01);
    // the old way, one point in N for the same number of points, lost detours themselves
    const step = Math.ceil(line.length / 60);
    const oneInN = line.filter((_, i) => i % step === 0 || i === line.length - 1);
    expect(worst(line, oneInN)).toBeGreaterThan(250);
    // fewer still: never more than asked, the two ends always
    for (const most of [30, 12, 5, 3]) {
      const few = thinRoad(line, most);
      expect(few.length).toBeLessThanOrEqual(most);
      expect(ends(few)).toBe(true);
    }
    expect(thinRoad(line, 2)).toEqual([line[0], line[line.length - 1]]);
  });

  it('a very long winding road (3 000 points, each one a bend): the most points, in little work', () => {
    const line: RoadPt[] = Array.from({ length: 3000 }, (_, i) => at(i * 40, i % 2 ? 30 : 0));
    const thin = thinRoad(line);
    expect(thin.length).toBeLessThanOrEqual(ROAD_MAX);
    expect(thin.length).toBeGreaterThan(ROAD_MAX / 2);
    expect(same(thin[0], line[0]) && same(thin[thin.length - 1], line[line.length - 1])).toBe(true);
    expect(thinRoad(line, 50).length).toBeLessThanOrEqual(50);
  });

  it('the worst road for the work (each bend a little bigger than the one before) and a road longer than what is looked at: still quick, still within the most points', () => {
    // every piece splits at its far end: the slowest case there is, at the most points looked at
    const teeth: RoadPt[] = Array.from({ length: ROAD_IN_MAX }, (_, i) => at(i * 40, i % 2 ? 30 + i * 0.01 : 0));
    const t0 = performance.now();
    const thin = thinRoad(teeth);
    const ms = performance.now() - t0;
    expect(thin.length).toBeLessThanOrEqual(ROAD_MAX);
    expect(same(thin[0], teeth[0]) && same(thin[thin.length - 1], teeth[teeth.length - 1])).toBe(true);
    // a second on the slowest test machine; a few ms on a real road (the function has about 2 s of work in all)
    expect(ms).toBeLessThan(1000);
    // 30 000 points (a road across the province): read one point in N first, the last point kept
    const long: RoadPt[] = Array.from({ length: 30000 }, (_, i) => at(i * 15, 400 * Math.sin(i / 300)));
    const cut = thinRoad(long);
    expect(cut.length).toBeLessThanOrEqual(ROAD_MAX);
    expect(same(cut[0], long[0]) && same(cut[cut.length - 1], long[long.length - 1])).toBe(true);
    // its shape is still there: no point of the road more than 25 m from the line
    expect(worst(long.filter((_, i) => i % 50 === 0), cut)).toBeLessThan(25);
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

  it('two planners, in the order of the app’s own maps; a test copy never reaches the real second one', async () => {
    const roads = await import('../../shared/map/roads');
    // the same two servers as the app's maps (src/shared/map/roads.ts), the first one first
    expect(handler).toContain(`'${roads.OSRM}'`);
    expect(handler).toContain(`'${roads.OSRM_BACKUP}'`);
    expect(handler).toContain(`return [{ base: first || '${roads.OSRM}', source: 'osrm' }, { base: second, source: 'osrm-backup' }];`);
    // a server whose first planner is sent elsewhere (the tests' OSRM_BASE) asks « <OSRM_BASE>-backup », not the internet
    expect(handler).toMatch(/env\('OSRM_BACKUP_BASE'\) \|\| \(first \? `\$\{first\}-backup` : 'https:\/\/routing\.openstreetmap\.de\/routed-car'\)/);
    // each planner is waited for a few seconds only: both fit well inside the app's own wait for « Je pars » (40 s)
    const wait = Number(/const ROAD_WAIT_MS = (\d+);/.exec(handler)?.[1]);
    expect(wait).toBeGreaterThanOrEqual(3000);
    expect(wait * 2).toBeLessThanOrEqual(15000);
  });
});
