// The line of a trip's road, as the customer's tracking page and the team's map draw it.
// The road planner is asked for the road in full: every bend of every street, hundreds of points for a few km. A map
// does not need the points that sit on a straight piece of street: thinRoad drops those and only those, so the line
// stays on the streets. (Hassan, 2026-11-21, looking at the tracking page: « it's a straight line, it doesn't show the
// actual route ». Until then the planner was asked for its « simplified » road, about 15 points for 9 km, which cuts
// across the blocks; a longer one was cut to one point in N, bends or not.)
// No Deno in this file: the app's unit tests read it too.

/** [lat, lng] */
export type RoadPt = [number, number];

/** a point is dropped only when the line without it passes this near it, in metres: under half a street's width */
export const ROAD_TOL_M = 3;
/** never more points than this in a trip's line: the customer's page reads the trip again every few seconds */
export const ROAD_MAX = 400;

const M_LAT = 111320;

/** metres from p to the piece of line a–b (flat ground around it: exact enough at the size of a trip) */
function offPiece(p: RoadPt, a: RoadPt, b: RoadPt): number {
  const kx = M_LAT * Math.cos((a[0] * Math.PI) / 180);
  const px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * M_LAT;
  const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * M_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** the points that shape the line: between two kept points, the farthest point is kept too while it is more than
    `tolM` from the piece that joins them (Douglas–Peucker; a list of pieces to look at, no function calling itself:
    a long road is thousands of points) */
function shape(line: RoadPt[], tolM: number): RoadPt[] {
  const n = line.length;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const todo: [number, number][] = [[0, n - 1]];
  while (todo.length) {
    const [i, j] = todo.pop()!;
    let far = -1, most = tolM;
    for (let k = i + 1; k < j; k++) {
      const d = offPiece(line[k], line[i], line[j]);
      if (d > most) { most = d; far = k; }
    }
    if (far > 0) { keep[far] = 1; todo.push([i, far], [far, j]); }
  }
  return line.filter((_, k) => keep[k] === 1);
}

/** the road's line for a map: both ends, and every point that bends it by more than `tolM` metres. A road so long
    that this is still more than `max` points is shaped more loosely (twice the distance, then twice again: 6 m, 12 m…),
    so it is the smallest bends that go first, never one point in N. A broken point (not two numbers) is dropped. */
export function thinRoad(line: RoadPt[] | null | undefined, max: number = ROAD_MAX, tolM: number = ROAD_TOL_M): RoadPt[] {
  const good: RoadPt[] = [];
  for (const p of line || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = good[good.length - 1];
    // the same point twice in a row (the planner does it at a turn): once
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    good.push([p[0], p[1]]);
  }
  if (good.length < 3) return good;
  const most = Math.max(2, Math.floor(max));
  let out = shape(good, tolM);
  for (let t = tolM * 2; out.length > most && t <= 5000; t *= 2) out = shape(good, t);
  return out;
}
