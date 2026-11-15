/* DEV ONLY — a small pretend planner for the demo of « Plages d'arrivée » (Part 25): the order of a truck's day and the
   arrival windows still possible for one more stop. Pure (demo-plan.test.ts). The real planner lives in
   supabase/migrations and is tested there; this one only has to be believable on a handful of stops. */

export interface Stop {
  id: string;
  /** minutes of work, minutes of driving to get there */
  dur: number; travel: number;
  /** the window promised to the customer; null: flexible (no promise yet) */
  win: [number, number] | null;
  /** done, en route or on site: it keeps its arrival time and its place at the head of the route */
  fixedEta?: number | null;
  /** its place chosen by hand (1 = first) */
  manual?: number | null;
  /** booked « quand même »: goes at the end of the route, whatever its window */
  forced?: boolean;
}
export interface Planned { id: string; eta: number; late: boolean }

/** the arrival times along a route: arriving before a window means waiting until it opens; after it: « hors plage » */
export function walk(seq: Stop[], start: number): Planned[] {
  let t = start;
  return seq.map((s) => {
    let eta: number;
    if (s.fixedEta != null) eta = s.fixedEta;
    else { eta = t + s.travel; if (s.win && eta < s.win[0]) eta = s.win[0]; }
    t = Math.max(t, eta + s.dur);
    return { id: s.id, eta, late: s.fixedEta == null && !!s.win && eta > s.win[1] };
  });
}
const lates = (p: Planned[]) => p.filter((x) => x.late).length;
/** when the truck is free again after its last stop */
export function endOf(seq: Stop[], start: number): number {
  const p = walk(seq, start);
  return seq.reduce((m, s, i) => Math.max(m, p[i].eta + s.dur), start);
}
/** how many stops at the head may not move (started, or placed by hand) and how many at the tail (forced) */
function locked(seq: Stop[]): { head: number; tail: number } {
  let head = 0, tail = 0;
  while (head < seq.length && (seq[head].fixedEta != null || seq[head].manual != null)) head++;
  while (tail < seq.length - head && seq[seq.length - 1 - tail].forced && seq[seq.length - 1 - tail].fixedEta == null) tail++;
  return { head, tail };
}

/** the order of a truck's day: the stops already started, those placed by hand, the promised windows in the order of
    their start, the flexible ones wherever they cost the least, and the forced ones last */
export function order(stops: Stop[], start: number): Stop[] {
  const fixed = stops.filter((s) => s.fixedEta != null).sort((a, b) => a.fixedEta! - b.fixedEta!);
  const free = stops.filter((s) => s.fixedEta == null);
  const manual = free.filter((s) => s.manual != null).sort((a, b) => a.manual! - b.manual!);
  const rest = free.filter((s) => s.manual == null);
  const forced = rest.filter((s) => s.forced);
  const windowed = rest.filter((s) => !s.forced && s.win).sort((a, b) => a.win![0] - b.win![0] || a.win![1] - b.win![1]);
  let seq = [...fixed, ...manual, ...windowed];
  const head = fixed.length + manual.length;
  for (const f of rest.filter((s) => !s.forced && !s.win)) {
    let best: Stop[] | null = null, cost = Infinity;
    for (let pos = head; pos <= seq.length; pos++) {
      const tryout = [...seq.slice(0, pos), f, ...seq.slice(pos)];
      const c = lates(walk(tryout, start)) * 100000 + endOf(tryout, start);
      if (c < cost) { cost = c; best = tryout; }
    }
    seq = best || [...seq, f];
  }
  return [...seq, ...forced];
}

export interface Choice { eta: number; win: [number, number]; pos: number; /** minutes lost waiting for this window to open */ wait: number; /** the end of the day with this stop in it */ end: number }
/** the windows one more stop could still be given on a route already ordered: at each place of the route, as early as the
    truck can be there, then hour by hour while every promised window still holds and the day does not run over */
export function choices(seq: Stop[], stop: { id: string; dur: number; travel: number }, start: number, end: number, winOf: (eta: number) => [number, number], step = 60): Choice[] {
  const { head, tail } = locked(seq);
  const base = lates(walk(seq, start));
  const out = new Map<number, Choice>();
  for (let pos = head; pos <= seq.length - tail; pos++) {
    const at = (target: number | null) => {
      const s: Stop = { ...stop, win: target == null ? null : [target, target + 24 * 60] };
      const tryout = [...seq.slice(0, pos), s, ...seq.slice(pos)];
      const p = walk(tryout, start);
      const fin = endOf(tryout, start);
      return lates(p) <= base && fin <= end ? { eta: p[pos].eta, fin } : null;
    };
    const first = at(null);
    if (!first) continue;
    const keep = (eta: number, fin: number) => {
      const win = winOf(eta);
      const c: Choice = { eta, win, pos, wait: eta - first.eta, end: fin };
      const cur = out.get(win[0]);
      if (!cur || c.wait < cur.wait || (c.wait === cur.wait && c.end < cur.end)) out.set(win[0], c);
    };
    keep(first.eta, first.fin);
    for (let target = (Math.floor(first.eta / step) + 1) * step; target < end; target += step) {
      const r = at(target);
      if (!r) break;
      keep(r.eta, r.fin);
    }
  }
  return [...out.values()].sort((a, b) => a.wait - b.wait || a.eta - b.eta);
}
/** may this stop still be promised this window on this route? (nobody else's window broken, the day not run over) */
export function fits(stops: Stop[], stop: Stop, start: number, end: number): boolean {
  const before = lates(walk(order(stops, start), start));
  const seq = order([...stops, stop], start);
  return lates(walk(seq, start)) <= before && endOf(seq, start) <= end;
}
