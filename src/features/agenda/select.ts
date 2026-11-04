/* What this person sees in the agenda. A mechanic without the « agenda » right only receives his truck's jobs (the
   database decides); the screen also keeps to his truck's lanes, so other trucks never look empty when they are not. */
import { can, me, myTrucks } from '../../data/auth';
import { jobsOn, blockLoad, type TruckBlock } from '../../data/select';
import type { Job } from '../../data/types';
import type { BlockKey, Day } from '../../lib/dates';

export function seesAll(): boolean { return can('agenda'); }
export function laneShown(truckId: string): boolean { return seesAll() || myTrucks().includes(truckId); }
export function jobShown(j: Pick<Job, 'truck_id' | 'created_by'>): boolean {
  if (seesAll()) return true;
  return (j.truck_id != null && myTrucks().includes(j.truck_id)) || (!!j.created_by && j.created_by === me.value?.id);
}
export const isOff = (j: Pick<Job, 'status'>) => j.status === 'cancelled' || j.status === 'no_show';

export interface BlockView {
  key: BlockKey; start: number; end: number;
  lanes: TruckBlock[]; unplaced: Job[];
  open: boolean; started: boolean; past: boolean;
  /** some truck still has room for a short job */
  room: boolean;
  jobs: number;
}
export function blockView(day: Day, b: { key: BlockKey; start: number; end: number }, todayDay: Day): BlockView {
  const load = blockLoad(day, b.key);
  const lanes = load.trucks.filter((x) => laneShown(x.truck.id));
  const unplaced = load.unplaced.filter(jobShown);
  const jobs = lanes.reduce((n, x) => n + x.jobs.length, 0) + unplaced.length;
  return {
    key: b.key, start: b.start, end: b.end, lanes, unplaced, open: load.open, started: load.started, past: day < todayDay,
    room: lanes.some((x) => x.cap >= 45 && x.left >= 45), jobs
  };
}
/** the jobs of a day this person sees (cancelled and no-shows included) */
export function dayJobs(day: Day): Job[] { return jobsOn(day).filter(jobShown); }
