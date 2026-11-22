/* « Réorganiser la journée » (Part 28, REARRANGE.md §2.3, §2.7): the draft of a day being rearranged, and every move made
   on it. Pure (dayOrder.test.ts); only trucksOf, blocksOf, worksOn and mayOrderDay read the device's copy.
   - A draft holds, for each truck shown (and each block, blocks mode), its stops under way (they never move, they stay
     first) and its BOOKED stops in the order wanted; the place every booked stop had when the draft was based (`base`);
     what it was built from (`was` = day_order_*'s p_was: truck, block, stop_order, window, pin, status per stop, never
     eta / travel / updated_at, which the background re-times all the time); the stops the person picked up and put down
     (`moved`); whether « Laisser l'app choisir » made its order (`auto`).
   - `movedOf` = the stops put down somewhere MINUS those back on their basis truck at their basis place (index among that
     truck's booked stops): a stop put back at its own place is not « moved » and keeps its pinned minute (days F8).
   - `rebase` (someone else changed the day, days F2): every stop NOT moved takes the server's truck and order (another
     person's save is taken as it is); a moved one goes back where the person put it, right after the same stop before
     it in the draft; a stop gone leaves the draft; a new one keeps its server place (marked « Nouveau »); `auto` ends.
   (`dayOrder()` of src/data/select.ts is another thing, the sort of a day's rows: nothing here has that name.) */
import type { Job, Truck } from '../../data/types';
import { blocks as blockRows, daySpan, jobsOn, trucks as allTrucks, truckRanges, windowsOn } from '../../data/select';
import { can, isOwner, myTrucks } from '../../data/auth';
import { overlapMinutes, today, type BlockKey } from '../../lib/dates';

/** the statuses of a stop under way: never moved, always first on its truck */
const LIVE: ReadonlySet<string> = new Set(['en_route', 'on_site']);
export const isLive = (j: Pick<Job, 'status'>): boolean => LIVE.has(j.status);
/** a place at the end of a list (moveTo clamps it) */
export const END = Number.MAX_SAFE_INTEGER;

/** one truck's stops in one block (windows mode: block 'day') */
export interface DayList { truck: string; block: BlockKey; live: string[]; jobs: string[] }
/** where a booked stop is: its truck, its block, its index among that list's booked stops */
export interface Place { truck: string; block: BlockKey; index: number }
/** p_was of one stop: [truck_id, block, stop_order, win_start, win_end, arrive_at, status] (JSON null for a null) */
export type WasRow = [string | null, string, number | null, number | null, number | null, number | null, string];
export type Was = Record<string, WasRow>;
export interface Draft {
  day: string;
  lists: DayList[];
  /** the stops picked up and put down since the draft was based (movedOf removes those back at their place) */
  moved: string[];
  /** « Laisser l'app choisir » made this order */
  auto: boolean;
  /** each booked stop's place when the draft was based */
  base: Record<string, Place>;
  /** what the draft was built from (p_was) */
  was: Was;
  /** stops that arrived since the draft was first opened (« Nouveau ») */
  news: string[];
}

/* ---------- building ---------- */

/** the stored order: stop_order, then the planned arrival, then the number */
const byStop = (a: Job, b: Job) =>
  ((a.stop_order ?? 9999) - (b.stop_order ?? 9999)) || ((a.eta_min ?? 9999) - (b.eta_min ?? 9999)) || (a.number - b.number);

/** p_was: EVERY booked / en route / on site stop of that day on those trucks (any block) */
export function wasOf(rows: readonly Job[], truckIds: readonly string[], day: string): Was {
  const out: Was = {};
  for (const j of rows) {
    if (j.day !== day || j.deleted_at || !j.truck_id || !truckIds.includes(j.truck_id) || !(j.status === 'booked' || isLive(j))) continue;
    out[j.id] = [j.truck_id, j.block, j.stop_order ?? null, j.win_start ?? null, j.win_end ?? null, j.arrive_at ?? null, j.status];
  }
  return out;
}
/** the same basis written the same way (to compare two of them) */
export function wasKey(w: Was): string {
  return JSON.stringify(Object.keys(w).sort().map((k) => [k, w[k]]));
}

/** the draft of that day as the phone has it now: the stored order, nothing moved */
export function draftOf(rows: readonly Job[], truckIds: readonly string[], day: string, blocks: readonly BlockKey[]): Draft {
  const ofDay = rows.filter((j) => j.day === day && !j.deleted_at && !!j.truck_id);
  const lists: DayList[] = [];
  const base: Record<string, Place> = {};
  for (const truck of truckIds) {
    for (const block of blocks) {
      const here = ofDay.filter((j) => j.truck_id === truck && j.block === block).sort(byStop);
      const jobs = here.filter((j) => j.status === 'booked').map((j) => j.id);
      jobs.forEach((id, index) => { base[id] = { truck, block, index }; });
      lists.push({ truck, block, live: here.filter(isLive).map((j) => j.id), jobs });
    }
  }
  return { day, lists, moved: [], auto: false, base, was: wasOf(rows, truckIds, day), news: [] };
}

/* ---------- reading ---------- */

export function placeOf(d: Draft, id: string): Place | null {
  for (const l of d.lists) {
    const index = l.jobs.indexOf(id);
    if (index >= 0) return { truck: l.truck, block: l.block, index };
  }
  return null;
}
export function listOf(d: Draft, truck: string, block: BlockKey): DayList | undefined {
  return d.lists.find((l) => l.truck === truck && l.block === block);
}
/** the stops moved by the person, minus those back at their own place */
export function movedOf(d: Draft): string[] {
  return d.moved.filter((id) => {
    const p = placeOf(d, id);
    const b = d.base[id];
    return !!p && !(b && b.truck === p.truck && b.block === p.block && b.index === p.index);
  });
}
/** the draft differs from the day as it was based (or the app's order was taken) */
export function changed(d: Draft): boolean {
  return d.auto || d.lists.some((l) => l.jobs.some((id, i) => {
    const b = d.base[id];
    return !b || b.truck !== l.truck || b.block !== l.block || b.index !== i;
  }));
}
/** the trucks whose list differs from the basis (their times must be asked again) */
export function changedTrucks(d: Draft): Set<string> {
  const out = new Set<string>();
  for (const l of d.lists) {
    const before = Object.entries(d.base).filter(([, b]) => b.truck === l.truck && b.block === l.block).sort((a, b) => a[1].index - b[1].index).map(([id]) => id);
    if (d.auto || before.join(',') !== l.jobs.join(',')) out.add(l.truck);
  }
  return out;
}
/** p_lists: each truck (and block) with its booked stops in the order wanted */
export function listsOf(d: Draft): { truck: string; block: BlockKey; jobs: string[] }[] {
  return d.lists.map((l) => ({ truck: l.truck, block: l.block, jobs: [...l.jobs] }));
}

/* ---------- moves ---------- */

/** puts the stop at `index` (its place AFTER the move, among the booked stops: 0 = right after the stops under way) of
    that truck's list of that block; refuses another block (the same draft back) */
export function moveTo(d: Draft, id: string, truck: string, block: BlockKey, index: number): Draft {
  const from = placeOf(d, id);
  if (!from || from.block !== block) return d;
  const ti = d.lists.findIndex((l) => l.truck === truck && l.block === block);
  if (ti < 0) return d;
  const lists = d.lists.map((l) => (l.jobs.includes(id) || l === d.lists[ti] ? { ...l, jobs: l.jobs.filter((x) => x !== id) } : l));
  const target = lists[ti];
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.round(index) : 0, target.jobs.length));
  if (from.truck === truck && at === from.index) return d;
  target.jobs = [...target.jobs.slice(0, at), id, ...target.jobs.slice(at)];
  return { ...d, lists, moved: d.moved.includes(id) ? d.moved : [...d.moved, id] };
}
/** a drop « before position p » of a list as it is drawn (the dragged row still in it) → its index after the move */
export function dropIndex(d: Draft, id: string, truck: string, block: BlockKey, p: number): number {
  const from = placeOf(d, id);
  return from && from.truck === truck && from.block === block && from.index < p ? p - 1 : p;
}
/** one place up (−1) or down (+1) on its own truck */
export function moveBy(d: Draft, id: string, delta: number): Draft {
  const p = placeOf(d, id);
  return p ? moveTo(d, id, p.truck, p.block, p.index + delta) : d;
}
/** first on its own truck (right after the stops under way) */
export function putFirst(d: Draft, id: string): Draft {
  const p = placeOf(d, id);
  return p ? moveTo(d, id, p.truck, p.block, 0) : d;
}
/** at the end of that truck's list (same block) */
export function putOn(d: Draft, id: string, truck: string): Draft {
  const p = placeOf(d, id);
  return p ? moveTo(d, id, truck, p.block, END) : d;
}
/** back on its basis truck at its basis place (« Remettre à sa place »); not « moved » any more */
export function backToPlace(d: Draft, id: string): Draft {
  const b = d.base[id];
  if (!b) return d;
  const r = moveTo(d, id, b.truck, b.block, b.index);
  return { ...r, moved: r.moved.filter((x) => x !== id) };
}
/** the draft whose lists are the planner's (« Laisser l'app choisir »): each listed (truck, block) takes the planner's
    list; a stop the planner did not list stays at the end of its own truck */
export function withLists(d: Draft, lists: readonly { truck: string; block: string; jobs: readonly string[] }[]): Draft {
  const all = new Set(d.lists.flatMap((l) => l.jobs));
  const taken = new Set<string>();
  const next = d.lists.map((l) => {
    const p = lists.find((x) => x.truck === l.truck && x.block === l.block);
    const jobs = (p?.jobs || []).filter((id) => all.has(id) && !taken.has(id));
    jobs.forEach((id) => taken.add(id));
    return { ...l, jobs };
  });
  for (const l of d.lists) for (const id of l.jobs) if (!taken.has(id)) next.find((x) => x.truck === l.truck && x.block === l.block)!.jobs.push(id);
  return { ...d, lists: next, moved: [], auto: true };
}

/* ---------- where it may go ---------- */

/** why a stop may not go on that truck ('kind': it may, but asked first: it then stays on that kind of vehicle) */
export type DropRefusal = 'machine' | 'off' | 'right' | 'block' | 'kind';
export interface DropCtx {
  /** the owner or « Réserver »: may put a stop on another truck */
  book: boolean;
  /** the vehicles of the day (tire_machine false = la voiture) */
  trucks: readonly Pick<Truck, 'id' | 'tire_machine'>[];
  /** does that truck work that block of the day */
  works: (truck: string, block: BlockKey) => boolean;
}
const hasMachine = (trucks: DropCtx['trucks'], id: string) => trucks.find((x) => x.id === id)?.tire_machine !== false;
/** may this stop go on that truck (that block)? null = yes */
export function canDrop(d: Draft, job: Pick<Job, 'id'> & Partial<Pick<Job, 'needs_machine'>>, truck: string, block: BlockKey, ctx: DropCtx): DropRefusal | null {
  const from = placeOf(d, job.id);
  if (!from) return null;
  if (from.block !== block) return 'block';
  const home = d.base[job.id]?.truck ?? from.truck;
  if (truck === from.truck || truck === home) return null;
  if (!ctx.book) return 'right';
  if (!ctx.works(truck, block)) return 'off';
  if (job.needs_machine && !hasMachine(ctx.trucks, truck)) return 'machine';
  const both = ctx.trucks.some((x) => x.tire_machine === false) && ctx.trucks.some((x) => x.tire_machine !== false);
  if (both && hasMachine(ctx.trucks, truck) !== hasMachine(ctx.trucks, home)) return 'kind';
  return null;
}
/** the vehicle a stop would go with ('car' / 'truck'), for the question of a drop onto the other kind */
export const kindOfTruck = (trucks: DropCtx['trucks'], id: string): 'car' | 'truck' => (hasMachine(trucks, id) ? 'truck' : 'car');

/* ---------- someone else changed the day ---------- */

export interface Rebased {
  draft: Draft;
  /** what changed under the draft: stops added, gone (cancelled, moved away, done), started (under way), moved by
      someone else (another truck or block) */
  what: { added: string[]; gone: string[]; started: string[]; moved: string[] };
}
/** a draft to rebase from (a kept one has no stops under way nor basis) */
export type DraftLike = Pick<Draft, 'day' | 'moved' | 'auto'> & Partial<Pick<Draft, 'base' | 'news'>> & { lists: (Omit<DayList, 'live'> & { live?: string[] })[] };
/** the draft on the server's rows now, the person's moves kept (§2.7) */
export function rebase(d: DraftLike, rows: readonly Job[], truckIds: readonly string[], blocks: readonly BlockKey[]): Rebased {
  const fresh = draftOf(rows, truckIds, d.day, blocks);
  const oldBooked = new Set(d.lists.flatMap((l) => l.jobs));
  const oldLive = new Set(d.lists.flatMap((l) => l.live || []));
  const newBooked = new Set(fresh.lists.flatMap((l) => l.jobs));
  const newLive = new Set(fresh.lists.flatMap((l) => l.live));
  const old: Draft = { day: d.day, lists: d.lists.map((l) => ({ ...l, live: l.live || [] })), moved: d.moved, auto: d.auto, base: d.base || {}, was: {}, news: d.news || [] };
  // every stop the person put down (also one back at its own index: placed after the same neighbour, it stays there)
  const keep = new Set(old.moved.filter((id) => oldBooked.has(id)));
  const what = {
    added: [...newBooked].filter((id) => !oldBooked.has(id) && !oldLive.has(id)),
    gone: [...oldBooked].filter((id) => !newBooked.has(id) && !newLive.has(id)),
    started: [...oldBooked].filter((id) => newLive.has(id)),
    moved: [...oldBooked].filter((id) => {
      const a = old.base[id], b = fresh.base[id];
      return !keep.has(id) && !!a && !!b && (a.truck !== b.truck || a.block !== b.block);
    })
  };
  const lists = fresh.lists.map((l) => ({ ...l, jobs: [...l.jobs] }));
  const placed: string[] = [];
  // the person's moves, top to bottom of the draft: a moved stop before another is already back when that one is placed
  for (const ol of d.lists) {
    ol.jobs.forEach((id, i) => {
      if (!keep.has(id) || !newBooked.has(id)) return;
      const now = fresh.base[id];
      if (!now || now.block !== ol.block) return;                     // put in another block by someone: its server place
      const target = lists.find((l) => l.truck === ol.truck && l.block === ol.block);
      if (!target) return;                                             // that truck is no longer listed
      for (const l of lists) { const k = l.jobs.indexOf(id); if (k >= 0) l.jobs.splice(k, 1); }
      const before = ol.jobs.slice(0, i).reverse().find((x) => target.jobs.includes(x));
      target.jobs.splice(before ? target.jobs.indexOf(before) + 1 : 0, 0, id);
      placed.push(id);
    });
  }
  const news = [...new Set([...old.news.filter((id) => newBooked.has(id)), ...what.added])];
  return { draft: { ...fresh, lists, moved: placed, auto: false, news }, what };
}

/* ---------- the device's copy ---------- */

/** the blocks a day is ordered by: windows mode the whole day; else the garage's blocks, in their order */
export function blocksOf(): BlockKey[] {
  if (windowsOn.value) return ['day'];
  return [...blockRows.value].filter((b) => b.key !== 'day').sort((a, b) => a.start - b.start).map((b) => b.key);
}
/** does that truck work that block of that day (its hours that day cross the block; windows mode: the booking day) */
export function worksOn(truck: string, day: string, block: BlockKey): boolean {
  const r = truckRanges(truck, day);
  if (!r.length) return false;
  const b = block === 'day' ? daySpan.value : (() => { const x = blockRows.value.find((y) => y.key === block); return x ? [x.start, x.end] as [number, number] : daySpan.value; })();
  return overlapMinutes(r, b[0], b[1]) > 0;
}
/** the owner or « Réserver »: every truck, another truck as a target, « Laisser l'app choisir », the send button */
export const ordersAll = (): boolean => isOwner() || can('book');
/** the trucks shown that day: owner / « Réserver »: every active truck that works that day or holds a stop of it; else
    only the person's own (myTrucks, the server's set_stop_order rule) */
export function trucksOf(day: string, rows: readonly Job[] = jobsOn(day)): string[] {
  const all = ordersAll();
  const mine = new Set(myTrucks());
  const holds = new Set(rows.filter((j) => j.day === day && !!j.truck_id && (j.status === 'booked' || isLive(j))).map((j) => j.truck_id as string));
  return allTrucks.value
    .filter((tr) => (all || mine.has(tr.id)) && ((tr.active && truckRanges(tr.id, day).length > 0) || holds.has(tr.id)))
    .map((tr) => tr.id);
}
/** may this person rearrange that day: today or later, and a booked stop on a truck they may order */
export function mayOrderDay(day: string): boolean {
  if (!day || day < today()) return false;
  const all = ordersAll();
  const mine = myTrucks();
  return jobsOn(day).some((j) => j.status === 'booked' && !!j.truck_id && (all || mine.includes(j.truck_id)));
}
