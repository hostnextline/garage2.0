/* The order of a truck's stops in a block (or in its whole day, « Plages d'arrivée »: block 'day'), by hand (Part 21): who is in the route, and moving one of them. Pure:
   tested in stopOrder.test.ts (used by « Ordre des arrêts », features/jobs/StopOrderSheet.tsx). The stops on the way or there stay first; only the booked ones are put in order. */
import type { Job } from '../../data/types';

const LIVE = new Set(['en_route', 'on_site']);
const byStop = (a: Job, b: Job) => (a.stop_order ?? 999) - (b.stop_order ?? 999) || a.number - b.number;

/** the route of the job's truck in its block (block 'day': its whole day): those on the way or there (they do not move), then the booked ones */
export function routeOf(job: Pick<Job, 'truck_id' | 'day' | 'block'>, jobs: Job[]): { live: Job[]; booked: Job[] } {
  if (!job.truck_id) return { live: [], booked: [] };
  const mine = jobs.filter((j) => !j.deleted_at && j.truck_id === job.truck_id && j.day === job.day && j.block === job.block);
  return { live: mine.filter((j) => LIVE.has(j.status)).sort(byStop), booked: mine.filter((j) => j.status === 'booked').sort(byStop) };
}
/** this one first, the others as they were */
export function putFirst(ids: string[], id: string): string[] {
  return ids.includes(id) ? [id, ...ids.filter((x) => x !== id)] : ids.slice();
}
/** this one a place higher (-1) or lower (+1) */
export function moveBy(ids: string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id), k = i + delta;
  if (i < 0 || k < 0 || k >= ids.length) return ids.slice();
  const out = ids.slice();
  [out[i], out[k]] = [out[k], out[i]];
  return out;
}
/** the order was chosen by hand for at least one of them */
export function isManual(booked: Job[]): boolean { return booked.some((j) => j.manual_order != null); }

/** « Plages d'arrivée »: about when each stop would be reached in a new order, from the arrival times shown now. The first
    stop keeps the time the route reaches its first stop today; each next one comes after the work of the one before (which
    waits for its window to open) and its own drive as planned (`fallbackDrive` when unknown). Null when a time is missing:
    nothing can be said. A rough guess: the server plans the real times after saving. */
export function guessEtas(ids: string[], booked: Job[], fallbackDrive = 20): Map<string, number> | null {
  const byId = new Map(booked.map((j) => [j.id, j]));
  const list = ids.map((id) => byId.get(id));
  if (!list.length || list.some((j) => !j || j.eta_min == null)) return null;
  const out = new Map<string, number>();
  let at = Math.min(...list.map((j) => j!.eta_min!));
  list.forEach((j, i) => {
    if (i > 0) at += j!.travel_min ?? fallbackDrive;
    out.set(j!.id, at);
    at = Math.max(at, j!.block === 'day' && j!.win_start != null ? j!.win_start : at) + (j!.duration_min || 0);
  });
  return out;
}
/** the stops a new order would probably reach outside the window promised (only jobs that have one) */
export function brokenWindows(ids: string[], booked: Job[], fallbackDrive = 20): { job: Job; eta: number }[] | null {
  const etas = guessEtas(ids, booked, fallbackDrive);
  if (!etas) return null;
  return booked.filter((j) => j.block === 'day' && j.win_start != null && j.win_end != null && etas.has(j.id))
    .map((j) => ({ job: j, eta: etas.get(j.id)! }))
    // early is no breach: the truck waits for the window to open
    .filter((x) => x.eta > x.job.win_end!)
    .sort((a, b) => ids.indexOf(a.job.id) - ids.indexOf(b.job.id));
}
export function sameOrder(a: string[], b: string[]): boolean { return a.length === b.length && a.every((x, i) => x === b[i]); }
