/* The order of a truck's stops in a block, by hand (Part 21): who is in the route, and moving one of them. Pure:
   tested in stopOrder.test.ts. The stops on the way or there stay first; only the booked ones are put in order. */
import type { Job } from '../../data/types';

const LIVE = new Set(['en_route', 'on_site']);
const byStop = (a: Job, b: Job) => (a.stop_order ?? 999) - (b.stop_order ?? 999) || a.number - b.number;

/** the route of the job's truck in its block: those on the way or there (they do not move), then the booked ones */
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
export function sameOrder(a: string[], b: string[]): boolean { return a.length === b.length && a.every((x, i) => x === b[i]); }
