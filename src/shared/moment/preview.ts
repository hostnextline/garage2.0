/* « Voir sur la carte » of a moment offered for a booking: the truck's day as it is (from the phone's copy, the shape of
   team_map), and the same day with the new appointment in it. Pure: the screen draws it (RoutePreview.tsx).
   - « Vraies routes » OFF (the rollback state): the phone's own estimate that mirrors the planner of before: the new stop
     where it adds the least distance inside its block (placeNewStop, stopRank; moveStops for « La voiture ferme »). Only
     the place and the number come from it: no km of it is ever said (Hassan's rule, 2026-11-19).
   - ON: the phone decides nothing by straight line (placeOn): the server's row says the vehicle, the place (rank) and the
     day's order (route); without them the day is shown as it is and the new stop is a pin with no number, in no line. */
import type { TeamMapAnswer } from '../map/assemble';
import { metres } from '../places/photon';
import { serverRank, type ServerPlace } from '../../domain/moment/serverPlace';

export const NEW_STOP = 'new-stop';
/** the new appointment on every map of the pickers: black, whatever the vehicle */
export const NEW_STOP_COLOR = '#111827';
/** « 4,2 » km, one decimal at most, in the person's language */
export const fmtKm = (n: number, l: string): string => new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }).format(n);
/* « Plages d'arrivée »: a whole day is one block ('day'), its stops in the planner's order */
const BLOCKS: Record<string, number> = { am: 0, pm: 1, eve: 2, day: 0 };
type Job = TeamMapAnswer['jobs'][number];

export interface Spot { day: string; block: string; truckId: string | null; lat: number; lng: number; name: string; address: string;
  /** « Plages d'arrivée » (block 'day'): the estimated arrival of the moment offered, minutes of the day */
  eta?: number | null;
  /** « Vraies routes » on: the server's row of that moment (null: none, e.g. offline or a block it did not offer) */
  row?: ServerPlace | null }
export interface Placed {
  /** the day without the new appointment, then with it (the truck's stops numbered in their order) */
  before: TeamMapAnswer; after: TeamMapAnswer;
  truckId: string | null;
  /** the extra straight-line km of the day: used only to choose the place (switch off), NEVER shown */
  extraKm: number;
}
/** the day placed from the server's row (switch on): `rank` null = the place is not known, the new stop is not in any line */
export interface PlacedOn { before: TeamMapAnswer; after: TeamMapAnswer; truckId: string | null; rank: { n: number; total: number } | null }

const has = (j: Pick<Job, 'lat' | 'lng'>) => Number.isFinite(j.lat) && Number.isFinite(j.lng) && j.lat != null && j.lng != null;
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => metres(a.lat, a.lng, b.lat, b.lng) / 1000;
/** the stops of a truck in the order of its day (block, then the planner's order, then the job number) */
function dayOrder(jobs: Job[]): Job[] {
  return jobs.slice().sort((a, b) => ((BLOCKS[a.block] ?? 9) - (BLOCKS[b.block] ?? 9)) || ((a.order ?? 999) - (b.order ?? 999)) || ((a.number ?? 0) - (b.number ?? 0)));
}

/** the cheapest place for a stop in a truck's day: its index among the stops, and the extra km (straight line: switch
    off only, to choose the place; never said).
    A day booked by windows (block 'day') has no blocks to stay inside: with the moment's estimated arrival (`eta`) the
    stop goes after the stops planned before that time; without it, wherever it adds the least. */
export function bestPlace(from: { lat: number; lng: number } | null, stops: Job[], spot: Pick<Spot, 'block' | 'lat' | 'lng' | 'eta'>): { index: number; extraKm: number } {
  const b = BLOCKS[spot.block] ?? 1;
  const whole = spot.block === 'day';
  const pts = stops.filter(has).map((s) => ({ lat: s.lat!, lng: s.lng!, b: BLOCKS[s.block] ?? 9, eta: s.eta_min }));
  const added = (i: number) => {
    const prev = i > 0 ? pts[i - 1] : null;
    const next = i < pts.length ? pts[i] : null;
    const p = prev || from;
    return (p ? km(p, spot) : 0) + (next ? km(spot, next) : 0) - (p && next ? km(p, next) : 0);
  };
  if (whole && spot.eta != null && pts.some((p) => p.eta != null)) {
    let index = 0;
    pts.forEach((p, k) => { if (p.eta != null && p.eta <= spot.eta!) index = k + 1; });
    return { index, extraKm: Math.max(0, added(index)) };
  }
  let best = { index: pts.length, extraKm: Infinity };
  for (let i = 0; i <= pts.length; i++) {
    const prev = i > 0 ? pts[i - 1] : null;
    const next = i < pts.length ? pts[i] : null;
    // only inside its own block: after the stops of earlier blocks, before those of later blocks
    if (!whole && ((prev && prev.b > b) || (next && next.b < b))) continue;
    const add = added(i);
    if (add < best.extraKm) best = { index: i, extraKm: add };
  }
  return { index: best.index, extraKm: Number.isFinite(best.extraKm) ? Math.max(0, best.extraKm) : 0 };
}

/** where a stop goes in a vehicle's whole list (`mine`, in day order) from its place among the LOCATED stops (`index`,
    from bestPlace): before the located stop it goes before; after the last located one, still before the stops of a
    later block that have no position (else « Arrêt 3 sur 3 » would be said of a morning stop that the map numbers 2) */
export function listIndex(mine: readonly Job[], index: number, block: string): number {
  const located = mine.filter(has);
  if (index < located.length) return mine.indexOf(located[index]);
  const b = BLOCKS[block] ?? 1;
  let at = located.length ? mine.indexOf(located[located.length - 1]) + 1 : 0;
  while (at < mine.length && (BLOCKS[mine[at].block] ?? 9) <= b) at++;
  return at;
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
  // the place among the located stops → the place in the whole list (a stop without a position keeps its rank)
  const at = listIndex(mine, pick.index, spot.block);
  const fresh: Job = { id: NEW_STOP, number: null, truck_id: pick.id, order: null, eta_min: spot.eta ?? null, status: 'booked', block: spot.block,
    name: spot.name, address: spot.address, lat: spot.lat, lng: spot.lng };
  return {
    before: { ...a, jobs: [...others, ...renumber(mine)] },
    after: { ...a, jobs: [...others, ...renumber([...mine.slice(0, at), fresh, ...mine.slice(at)])] },
    truckId: pick.id,
    extraKm: Math.round(pick.extraKm * 10) / 10
  };
}

/** the new appointment's rank in its route that day (« arrêt 2 sur 4 »), the same estimate as the map's; null when no
    vehicle works that day yet */
export function stopRank(a: TeamMapAnswer, spot: Spot): { n: number; total: number } | null {
  const p = placeNewStop(a, spot);
  if (!p.truckId) return null;
  const mine = p.after.jobs.filter((j) => j.truck_id === p.truckId && j.status !== 'cancelled' && j.status !== 'no_show');
  const n = mine.find((j) => j.id === NEW_STOP)?.order;
  return n ? { n, total: mine.length } : null;
}

/** « Vraies routes » on: the day with the new appointment where the SERVER puts it. The vehicle: the one chosen by hand,
    else the row's. The place: the row's rank, only for that vehicle (serverRank); with the row's route (window mode) the
    vehicle's stops follow the route's order and each stop's `order` is its place in the route; a stop the route does not
    name (booked a moment ago elsewhere) comes after, with NO number (`order` null: never above « sur N », review-moments
    L2). Rank and route are read only from a window-mode row (serverRank: blocks mode says nothing of the order). No
    vehicle, no rank, or a vehicle that does not work that day: the day exactly as it is, and the new stop with no vehicle
    (an unplaced pin: no number, no line to it). */
export function placeOn(a: TeamMapAnswer, spot: Spot): PlacedOn {
  const row = spot.row ?? null;
  const truckId = spot.truckId || row?.truck || null;
  const rank = serverRank(row, truckId);
  const fresh: Job = { id: NEW_STOP, number: null, truck_id: null, order: null, eta_min: spot.eta ?? null, status: 'booked', block: spot.block,
    name: spot.name, address: spot.address, lat: spot.lat, lng: spot.lng };
  if (!truckId || !rank || !a.trucks.some((x) => x.id === truckId)) {
    return { before: a, after: { ...a, jobs: [...a.jobs, fresh] }, truckId: truckId && a.trucks.some((x) => x.id === truckId) ? truckId : null, rank: null };
  }
  const gone = (j: Job) => j.status === 'cancelled' || j.status === 'no_show';
  const others = a.jobs.filter((j) => j.truck_id !== truckId || gone(j));
  const mine = dayOrder(a.jobs.filter((j) => j.truck_id === truckId && !gone(j)));
  const route = Array.isArray(row?.route) ? row!.route! : null;
  const placed = { ...fresh, truck_id: truckId, order: rank.n };
  let after: Job[];
  if (route) {
    const at = (id: string) => { const i = route.indexOf(id); return i < 0 ? Infinity : i; };
    const named = mine.filter((j) => at(j.id) < Infinity).sort((x, y) => at(x.id) - at(y.id)).map((j) => ({ ...j, order: at(j.id) + 1 }));
    const rest = mine.filter((j) => at(j.id) === Infinity).map((j) => ({ ...j, order: null }));
    after = [...named, placed, ...rest];
  } else {
    const k = Math.max(0, Math.min(mine.length, rank.n - 1));
    after = [...mine.slice(0, k), placed, ...mine.slice(k)].map((j, i) => ({ ...j, order: i + 1 }));
  }
  return {
    before: { ...a, jobs: [...others, ...mine.map((j, i) => ({ ...j, order: i + 1 }))] },
    after: { ...a, jobs: [...others, ...after] },
    truckId, rank
  };
}

/** the day with these appointments moved to another vehicle (« La voiture ferme »: its stops go to the truck), each at
    the cheapest place inside its own block, in the order given; the vehicle's stops numbered again */
export function moveStops(a: TeamMapAnswer, ids: string[], truckId: string): TeamMapAnswer {
  const home = a.home && a.home.lat != null && a.home.lng != null ? { lat: a.home.lat, lng: a.home.lng } : null;
  const tr = a.trucks.find((x) => x.id === truckId);
  const from = tr?.start ? { lat: tr.start.lat, lng: tr.start.lng } : home;
  const live = (j: Job) => j.truck_id === truckId && j.status !== 'cancelled' && j.status !== 'no_show';
  let jobs = a.jobs.slice();
  for (const id of ids) {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.truck_id === truckId) continue;
    jobs = jobs.filter((x) => x.id !== id);
    const mine = dayOrder(jobs.filter(live));
    let at: number;
    if (has(j)) {
      /* the rule CloseDaySheet has always shown (its owner did not ask for booking-b-20's): after the last located stop,
         the moved stop goes at the end of the list */
      const located = mine.filter(has);
      const r = bestPlace(from, mine, { block: j.block, lat: j.lat!, lng: j.lng! });
      at = r.index < located.length ? mine.indexOf(located[r.index]) : mine.length;
    } else {
      // no position: at the end of its block
      const b = BLOCKS[j.block] ?? 1;
      at = mine.filter((x) => (BLOCKS[x.block] ?? 9) <= b).length;
    }
    const next = [...mine.slice(0, at), { ...j, truck_id: truckId }, ...mine.slice(at)].map((x, i) => ({ ...x, order: i + 1 }));
    jobs = [...jobs.filter((x) => !live(x)), ...next];
  }
  return { ...a, jobs };
}
