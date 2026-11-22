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
/** the most points of the planner's road looked at (about 150 km of road): a longer list is first read one point in N,
    so the work stays small whatever the planner answers (the function has little time to give) */
export const ROAD_IN_MAX = 4000;

const M_LAT = 111320;
const EPS = 1e-9;

/** the road's line for a map: both ends, and every point that bends it by more than `tolM` metres (a point is dropped
    only when the line without it passes within `tolM` of it). A road that still has more than `max` points loses its
    smallest bends first, never one point in N. A broken point (not two numbers) is dropped; the list given is not changed.

    How: between two kept points, the point farthest from the straight piece that joins them is kept while it is more
    than `tolM` from it, and each half is looked at the same way (Douglas–Peucker, with a list of pieces instead of a
    function calling itself). Each kept point remembers how far it was (never more than the point kept before it on its
    piece): the most points = the ones that were the farthest. One pass, on flat ground measured in metres. */
export function thinRoad(line: RoadPt[] | null | undefined, max: number = ROAD_MAX, tolM: number = ROAD_TOL_M): RoadPt[] {
  let pts: RoadPt[] = [];
  for (const p of line || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = pts[pts.length - 1];
    // the same point twice in a row (the planner does it at a turn): once
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    pts.push([p[0], p[1]]);
  }
  if (pts.length < 3) return pts;
  if (pts.length > ROAD_IN_MAX) {
    const step = Math.ceil(pts.length / ROAD_IN_MAX), end = pts.length - 1;
    pts = pts.filter((_, i) => i % step === 0 || i === end);
  }
  const n = pts.length;
  // flat ground around the road's first point, in metres (exact enough at the size of a trip)
  const kx = M_LAT * Math.cos((pts[0][0] * Math.PI) / 180);
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = (pts[i][1] - pts[0][1]) * kx; Y[i] = (pts[i][0] - pts[0][0]) * M_LAT; }

  // far[k]: how far point k was from its piece when it was kept (0: dropped)
  const far = new Float64Array(n);
  far[0] = Infinity; far[n - 1] = Infinity;
  const pieces: number[] = [0, n - 1];
  const tops: number[] = [Infinity];
  while (pieces.length) {
    const j = pieces.pop()!, i = pieces.pop()!, top = tops.pop()!;
    const ax = X[i], ay = Y[i], bx = X[j] - ax, by = Y[j] - ay, len2 = bx * bx + by * by, mid = (i + j) / 2;
    let at = -1, most = tolM;
    for (let k = i + 1; k < j; k++) {
      const px = X[k] - ax, py = Y[k] - ay;
      let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - t * bx, dy = py - t * by, d = Math.sqrt(dx * dx + dy * dy);
      if (d > most + EPS) { most = d; at = k; }
      // as far as the farthest so far: the one nearer the middle of the piece (two halves of the same size: a road of
      // equal bends, a street grid, is then looked at in few steps)
      else if (at >= 0 && d > most - EPS && Math.abs(k - mid) < Math.abs(at - mid)) at = k;
    }
    if (at < 0) continue;
    const kept = Math.min(most, top);
    far[at] = kept;
    pieces.push(i, at, at, j);
    tops.push(kept, kept);
  }

  let floor = 0;
  const most = Math.max(2, Math.floor(max));
  let count = 0;
  for (let k = 0; k < n; k++) if (far[k] > 0) count++;
  if (count > most) {
    // too many: only the points that were farther than the (most − 1)th farthest of them
    const inner = Array.from(far).filter((d, k) => d > 0 && k > 0 && k < n - 1).sort((a, b) => b - a);
    floor = inner[most - 2];
  }
  return pts.filter((_, k) => far[k] > floor);
}
