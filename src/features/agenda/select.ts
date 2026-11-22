/* What the agenda shows of a day: who sees what, and each place of the day (a block, or the whole day with « Plages
   d'arrivée ») with its trucks, its jobs and whether it still books.
   A mechanic without the « agenda » right only receives his truck's jobs (the database decides); the screen also keeps
   to his truck's lanes, so other trucks never look empty when they are not. */
import { can, me, myTrucks } from '../../data/auth';
import { blockLoad, activeTrucks, blocks, blockOfKey, settings, windowsOn, truckRanges, type TruckBlock } from '../../data/select';
import type { Job, Truck } from '../../data/types';
import { nowMinute, minuteOf, overlapMinutes, type BlockKey, type Day } from '../../lib/dates';
import { byArrival, isWindowDay } from './layout';
import { dayState, blockState, hasRoom } from './load';
import { jobsOfDay } from './days';

export function seesAll(): boolean { return can('agenda'); }
export function laneShown(truckId: string): boolean { return seesAll() || myTrucks().includes(truckId); }
export function jobShown(j: Pick<Job, 'truck_id' | 'created_by'>): boolean {
  if (seesAll()) return true;
  return (j.truck_id != null && myTrucks().includes(j.truck_id)) || (!!j.created_by && j.created_by === me.value?.id);
}
export const isOff = (j: Pick<Job, 'status'>) => j.status === 'cancelled' || j.status === 'no_show';
/** a job's arrival as minutes of the garage's day (Montréal), the same clock as nowMinute(): read on the device's own
    clock, a phone set to another zone counted a job under way hours off */
export function arrivedMinute(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = minuteOf(new Date(iso));
  return Number.isFinite(m) ? m : null;
}

export interface BlockView {
  key: BlockKey; start: number; end: number;
  lanes: TruckBlock[]; unplaced: Job[];
  /** the trucks in service that do not work in this block (said, so nobody looks for them) */
  idle: Truck[];
  open: boolean; started: boolean; past: boolean;
  /** nobody works there (a block no truck works in; a day no truck has hours) */
  closed: boolean;
  /** some truck still has room for a short job */
  room: boolean;
  jobs: number;
}
export function blockView(day: Day, b: { key: BlockKey; start: number; end: number }, todayDay: Day): BlockView {
  const load = blockLoad(day, b.key);
  const whole = b.key === 'day';
  const minBlock = settings.value.booking.min_block_min;
  // today: a job under way counts only for the time it still needs (as the planner counts it), not whole against
  // the hours left: blockLoad's own used / left, the numbers the pickers show (an arrival of yesterday counts as
  // yesterday, S06); a whole day: its stops by the hour (the planned arrival, then the stop number)
  const lanes = load.trucks.filter((x) => laneShown(x.truck.id)).map((x) => (whole ? { ...x, jobs: [...x.jobs].sort(byArrival) } : x));
  // a whole day is over at its last hour, not when it starts (a block is « commencé » at its first minute)
  const st = whole
    ? dayState(day, todayDay, nowMinute(), [b.start, b.end], load.trucks.map((x) => x.cap), minBlock, activeTrucks.value.some((tr) => overlapMinutes(truckRanges(tr.id, day), b.start, b.end) > 0))
    : blockState(load);
  const unplaced = load.unplaced.filter(jobShown);
  const jobs = lanes.reduce((n, x) => n + x.jobs.length, 0) + unplaced.length;
  const idle = activeTrucks.value.filter((tr) => laneShown(tr.id) && !lanes.some((x) => x.truck.id === tr.id));
  return {
    key: b.key, start: b.start, end: b.end, lanes, unplaced, idle, open: st.open, started: st.started, closed: st.closed, past: day < todayDay,
    room: hasRoom(lanes, minBlock), jobs
  };
}
/** the jobs of a day this person sees (cancelled and no-shows included) */
export function dayJobs(day: Day): Job[] { return jobsOfDay(day).filter(jobShown); }
/** how many jobs this person sees that day, the cancelled and no-shows left out */
export function activeCount(day: Day): number { return dayJobs(day).filter((j) => !isOff(j)).length; }

/** how a day is drawn. « Plages d'arrivée » (window: true): ONE view for the whole day, then the blocks that still hold
    jobs (right after the switch, or a copy of the phone not yet up to date); else its blocks, as always. */
export interface DayPlan { day: Day; window: boolean; views: BlockView[] }
export function dayPlan(day: Day, todayDay: Day): DayPlan {
  const kinds = jobsOfDay(day).filter((j) => !isOff(j)).map((j) => j.block);
  const byBlock = () => blocks.value.map((b) => blockView(day, b, todayDay));
  if (!isWindowDay(day, todayDay, windowsOn.value, kinds)) return { day, window: false, views: byBlock() };
  const left = kinds.some((k) => k !== 'day') ? byBlock().filter((v) => v.jobs > 0) : [];
  return { day, window: true, views: [blockView(day, blockOfKey('day'), todayDay), ...left] };
}
/** the trucks that work a day (on a past day: the ones that had jobs) */
export function workingTrucks(plan: DayPlan): number {
  return new Set(plan.views.flatMap((v) => v.lanes.filter((x) => x.cap > 0 || x.jobs.length > 0).map((x) => x.truck.id))).size;
}
