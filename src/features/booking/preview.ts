/* « Voir sur la carte » of a moment offered for a booking: the truck's day as it is (from the phone's copy, the shape of
   team_map), and the same day with the new appointment put where it costs the least driving in its block (like the planner:
   between two stops of that block, never in another block). Pure: the screen draws it (RoutePreview.tsx). */
import type { TeamMapAnswer } from '../map/assemble';
import { metres } from '../customers/photon';

export const NEW_STOP = 'new-stop';
const BLOCKS: Record<string, number> = { am: 0, pm: 1, eve: 2 };
type Job = TeamMapAnswer['jobs'][number];

export interface Spot { day: string; block: string; truckId: string | null; lat: number; lng: number; name: string; address: string }
export interface Placed {
  /** the day without the new appointment, then with it (the truck's stops numbered in their order) */
  before: TeamMapAnswer; after: TeamMapAnswer;
  truckId: string | null;
  /** the extra straight-line km of the day (an estimate until the road route answers) */
  extraKm: number;
}

const has = (j: Pick<Job, 'lat' | 'lng'>) => Number.isFinite(j.lat) && Number.isFinite(j.lng) && j.lat != null && j.lng != null;
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => metres(a.lat, a.lng, b.lat, b.lng) / 1000;
/** the stops of a truck in the order of its day (block, then the planner's order, then the job number) */
function dayOrder(jobs: Job[]): Job[] {
  return jobs.slice().sort((a, b) => ((BLOCKS[a.block] ?? 9) - (BLOCKS[b.block] ?? 9)) || ((a.order ?? 999) - (b.order ?? 999)) || ((a.number ?? 0) - (b.number ?? 0)));
}

/** the cheapest place for a stop in a truck's day: its index among the stops, and the extra km (straight line) */
export function bestPlace(from: { lat: number; lng: number } | null, stops: Job[], spot: Pick<Spot, 'block' | 'lat' | 'lng'>): { index: number; extraKm: number } {
  const b = BLOCKS[spot.block] ?? 1;
  const pts = stops.filter(has).map((s) => ({ lat: s.lat!, lng: s.lng!, b: BLOCKS[s.block] ?? 9 }));
  let best = { index: pts.length, extraKm: Infinity };
  for (let i = 0; i <= pts.length; i++) {
    const prev = i > 0 ? pts[i - 1] : null;
    const next = i < pts.length ? pts[i] : null;
    // only inside its own block: after the stops of earlier blocks, before those of later blocks
    if ((prev && prev.b > b) || (next && next.b < b)) continue;
    const p = prev || from;
    const add = (p ? km(p, spot) : 0) + (next ? km(spot, next) : 0) - (p && next ? km(p, next) : 0);
    if (add < best.extraKm) best = { index: i, extraKm: add };
  }
  return { index: best.index, extraKm: Number.isFinite(best.extraKm) ? Math.max(0, best.extraKm) : 0 };
}

/** the truck's day with the new appointment in it; without a truck (no suggestion), the truck where it adds the least */
export function placeNewStop(a: TeamMapAnswer, spot: Spot): Placed {
  const home = a.home && a.home.lat != null && a.home.lng != null ? { lat: a.home.lat, lng: a.home.lng } : null;
  const fromOf = (id: string) => { const tr = a.trucks.find((x) => x.id === id); return tr?.start ? { lat: tr.start.lat, lng: tr.start.lng } : home; };
  const live = (id: string) => dayOrder(a.jobs.filter((j) => j.truck_id === id && j.status !== 'cancelled' && j.status !== 'no_show'));
  const candidates = spot.truckId ? [spot.truckId]
    // no truck said: those already working that block, else every truck
    : (() => { const busy = a.trucks.filter((tr) => a.jobs.some((j) => j.truck_id === tr.id && j.block === spot.block)).map((tr) => tr.id); return busy.length ? busy : a.trucks.map((tr) => tr.id); })();
  let pick: { id: string | null; index: number; extraKm: number } = { id: null, index: 0, extraKm: 0 };
  let bestKm = Infinity;
  for (const id of candidates) {
    const r = bestPlace(fromOf(id), live(id), spot);
    if (r.extraKm < bestKm) { bestKm = r.extraKm; pick = { id, ...r }; }
  }
  const renumber = (list: Job[]) => list.map((j, i) => ({ ...j, order: i + 1 }));
  const others = a.jobs.filter((j) => j.truck_id !== pick.id);
  const mine = pick.id ? live(pick.id) : [];
  const located = mine.filter(has);
  // the place among the located stops → the place in the whole list (a stop without a position keeps its rank)
  const at = pick.index < located.length ? mine.indexOf(located[pick.index]) : mine.length;
  const fresh: Job = { id: NEW_STOP, number: null, truck_id: pick.id, order: null, eta_min: null, status: 'booked', block: spot.block,
    name: spot.name, address: spot.address, lat: spot.lat, lng: spot.lng };
  return {
    before: { ...a, jobs: [...others, ...renumber(mine)] },
    after: { ...a, jobs: [...others, ...renumber([...mine.slice(0, at), fresh, ...mine.slice(at)])] },
    truckId: pick.id,
    extraKm: Math.round(pick.extraKm * 10) / 10
  };
}
