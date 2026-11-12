/* A vehicle closes a day (or a block of it) that has appointments: which appointments are touched, and which vehicle of
   the other kind (the car ↔ the truck) can take each one. An appointment keeps its kind (jobs_kind_follow), so the planner
   never slides it to the other vehicle by itself: Horaires asks (CloseDaySheet). Pure. */
import { dow, type Block, type Day, type Range } from '../../lib/dates';
import type { Job, Truck } from '../../data/types';

/** these hours still cover a part of that block */
export const blockOpen = (rs: Range[] = [], b: Block) => rs.some(([s, e]) => s < b.end && e > b.start);

/** the booked appointments of this vehicle whose block is closed by the new hours (`week`: the weekdays changed) on these dates */
export function closedJobs(jobs: Job[], truckId: string, week: Record<number, Range[]>, dates: Day[], blockOf: (k: Job['block']) => Block): Job[] {
  const order: Record<string, number> = { am: 0, pm: 1, eve: 2 };
  return jobs
    .filter((j) => j.truck_id === truckId && j.status === 'booked' && !j.deleted_at && dates.includes(j.day) && !!week[dow(j.day)] && !blockOpen(week[dow(j.day)], blockOf(j.block)))
    .sort((a, b) => a.day.localeCompare(b.day) || (order[a.block] ?? 9) - (order[b.block] ?? 9) || (a.stop_order ?? 999) - (b.stop_order ?? 999));
}

const isCar = (tr: Pick<Truck, 'tire_machine'>) => tr.tire_machine === false;
/** the working vehicles of the other kind */
export function otherKind(trucks: Truck[], truckId: string): Truck[] {
  const me = trucks.find((x) => x.id === truckId);
  return me ? trucks.filter((x) => x.id !== truckId && x.active !== false && !x.deleted_at && isCar(x) !== isCar(me)) : [];
}

export interface Move { job: Job; target: string | null; why: 'machine' | 'closed' | null }
/** where each appointment can go: a vehicle of the other kind open in its block that day (work for the tire machine never
    goes to the car) */
export function movesFor(hit: Job[], targets: Truck[], rangesOf: (truckId: string, day: Day) => Range[], blockOf: (k: Job['block']) => Block): Move[] {
  return hit.map((job) => {
    const able = targets.filter((x) => !(job.needs_machine && isCar(x)));
    if (!able.length) return { job, target: null, why: 'machine' as const };
    const open = able.find((x) => blockOpen(rangesOf(x.id, job.day), blockOf(job.block)));
    return open ? { job, target: open.id, why: null } : { job, target: null, why: 'closed' as const };
  });
}
