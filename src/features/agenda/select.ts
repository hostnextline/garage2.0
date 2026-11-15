/* What this person sees in the agenda. A mechanic without the « agenda » right only receives his truck's jobs (the
   database decides); the screen also keeps to his truck's lanes, so other trucks never look empty when they are not. */
import { can, me, myTrucks } from '../../data/auth';
import { jobsOn, blockLoad, activeTrucks, blocks, blockOfKey, settings, windowsOn, type TruckBlock } from '../../data/select';
import type { Job, Truck } from '../../data/types';
import { nowMinute, type BlockKey, type Day } from '../../lib/dates';
import { byPlan, dayState, isWindowDay } from './layout';

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
  /** the trucks in service that do not work in this block (said, so nobody looks for them) */
  idle: Truck[];
  open: boolean; started: boolean; past: boolean;
  /** some truck still has room for a short job */
  room: boolean;
  jobs: number;
}
export function blockView(day: Day, b: { key: BlockKey; start: number; end: number }, todayDay: Day): BlockView {
  const load = blockLoad(day, b.key);
  const whole = b.key === 'day';
  // a whole day: its stops in the order planned
  const lanes = load.trucks.filter((x) => laneShown(x.truck.id)).map((x) => (whole ? { ...x, jobs: [...x.jobs].sort(byPlan) } : x));
  // a whole day is over at its last hour, not when it starts (a block is « commencé » at its first minute)
  const st = whole ? dayState(day, todayDay, nowMinute(), [b.start, b.end], load.trucks.map((x) => x.cap), settings.value.booking.min_block_min) : load;
  const unplaced = load.unplaced.filter(jobShown);
  const jobs = lanes.reduce((n, x) => n + x.jobs.length, 0) + unplaced.length;
  const idle = activeTrucks.value.filter((tr) => laneShown(tr.id) && !lanes.some((x) => x.truck.id === tr.id));
  return {
    key: b.key, start: b.start, end: b.end, lanes, unplaced, idle, open: st.open, started: st.started, past: day < todayDay,
    room: lanes.some((x) => x.cap >= 45 && x.left >= 45), jobs
  };
}
/** the jobs of a day this person sees (cancelled and no-shows included) */
export function dayJobs(day: Day): Job[] { return jobsOn(day).filter(jobShown); }

/** how a day is drawn. « Plages d'arrivée » (window: true): ONE view for the whole day, then the blocks that still hold
    jobs (right after the switch, or a copy of the phone not yet up to date); else its blocks, as always. */
export interface DayPlan { window: boolean; views: BlockView[] }
export function dayPlan(day: Day, todayDay: Day): DayPlan {
  const kinds = jobsOn(day).filter((j) => !isOff(j)).map((j) => j.block);
  const byBlock = () => blocks.value.map((b) => blockView(day, b, todayDay));
  if (!isWindowDay(day, todayDay, windowsOn.value, kinds)) return { window: false, views: byBlock() };
  const left = kinds.some((k) => k !== 'day') ? byBlock().filter((v) => v.jobs > 0) : [];
  return { window: true, views: [blockView(day, blockOfKey('day'), todayDay), ...left] };
}
