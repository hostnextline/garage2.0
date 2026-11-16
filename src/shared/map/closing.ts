/* A vehicle closes a day (or a block of it; with arrival windows: the hours of a window told to a customer) that has appointments: which appointments are touched, and which vehicle of
   the other kind (the car ↔ the truck) can take each one. An appointment keeps its kind (jobs_kind_follow), so the planner
   never slides it to the other vehicle by itself: Horaires asks (CloseDaySheet), and « Départ et heure » on the map asks
   before closing them. Pure (what the phone knows of rights and room is passed in).
   Only what the phone can know: the server's planner still has the last word (a block that only shrinks, the room of the
   other vehicle when several move together); a move it refuses stops the closing (HoursScreen). */
import { dow, type Block, type Day, type Range } from '../../lib/dates';
import type { Job, Truck } from '../../data/types';
import { compareStops, type Orderable } from './stopOrder';

/** these hours still cover a part of that block */
export const blockOpen = (rs: Range[] = [], b: Block) => rs.some(([s, e]) => s < b.end && e > b.start);

type Timed = Pick<Job, 'block' | 'win_start' | 'win_end' | 'duration_min'>;
/** « Plages d'arrivée »: with these hours the vehicle can still reach the customer inside the window told and do the work:
    one stretch of hours where an arrival in [from, to] leaves the time of the job before the vehicle closes */
export function windowOpen(rs: Range[] = [], win: Range, durationMin = 0): boolean {
  return rs.some(([s, e]) => { const at = Math.max(s, win[0]); return at <= win[1] && at + Math.max(0, durationMin) <= e && at < e; });
}
/** these hours still hold this appointment: a part of its block; booked by arrival window (block 'day'): its window
    (a « flexible » one, no window yet: any time of the day) */
export function jobOpen(rs: Range[] = [], j: Timed, blockOf: (k: Job['block']) => Block): boolean {
  if (j.block !== 'day') return blockOpen(rs, blockOf(j.block));
  const day = j.win_start != null && j.win_end != null ? null : blockOf('day');
  const win: Range = j.win_start != null && j.win_end != null ? [j.win_start, j.win_end] : [day?.start ?? 0, day?.end ?? 1440];
  return windowOpen(rs, win, j.duration_min || 0);
}
/** a job as the one stop order reads it (a job by arrival window not planned yet: the start of its window) */
const orderable = (j: Job): Orderable => ({ block: j.block, status: j.status, order: j.stop_order ?? null, etaMin: j.eta_min ?? j.win_start ?? null, number: j.number ?? null });
/** inside a day: the order of the route, as the map shows it */
const inDay = (a: Job, b: Job) => compareStops(orderable(a), orderable(b));

/** the booked appointments of this vehicle that the new hours (`week`: the weekdays changed) no longer hold on these dates:
    their block is closed, or (arrival windows) the vehicle can no longer be there inside the window told */
export function closedJobs(jobs: Job[], truckId: string, week: Record<number, Range[]>, dates: Day[], blockOf: (k: Job['block']) => Block): Job[] {
  return jobs
    .filter((j) => j.truck_id === truckId && j.status === 'booked' && !j.deleted_at && dates.includes(j.day) && !!week[dow(j.day)] && !jobOpen(week[dow(j.day)], j, blockOf))
    .sort((a, b) => a.day.localeCompare(b.day) || inDay(a, b));
}

const isCar = (tr: Pick<Truck, 'tire_machine'>) => tr.tire_machine === false;
/** the working vehicles of the other kind */
export function otherKind(trucks: Truck[], truckId: string): Truck[] {
  const me = trucks.find((x) => x.id === truckId);
  return me ? trucks.filter((x) => x.id !== truckId && x.active !== false && !x.deleted_at && isCar(x) !== isCar(me)) : [];
}

/** why an appointment stays (it goes to « À placer » if the hours are closed anyway): the tire machine, the other vehicle
    closed then, no right to move it there, its moment already started, no room left there */
export type StayWhy = 'machine' | 'closed' | 'rights' | 'started' | 'full';
export interface Move { job: Job; target: string | null; why: StayWhy | null }
/** what the phone knows of the other vehicle's block that day: the minutes still free, and whether it has started */
export interface Room { left: number; started: boolean }
export interface MoveRules {
  /** may this person put appointments of this vehicle on that one (move_job's rule) */
  mayMove?: (targetId: string) => boolean;
  /** the room of a vehicle in a block that day (blockLoad), the job itself left out */
  roomOf?: (targetId: string, job: Job) => Room | null;
  /** the driving counted for a job moved onto a route (its real driving is not known yet) */
  travelMin?: number;
}
/** where each appointment can go: a vehicle of the other kind open in its block that day, or (arrival windows) working
    inside the window told: the appointment keeps its day and its window (work for the tire machine never goes to the car).
    Only offered when the person may move it there and the block, not started, still has room for it and for the ones
    already sent there before it. */
export function movesFor(hit: Job[], targets: Truck[], rangesOf: (truckId: string, day: Day) => Range[], blockOf: (k: Job['block']) => Block, rules: MoveRules = {}): Move[] {
  const taken = new Map<string, number>();
  return hit.map((job): Move => {
    const able = targets.filter((x) => !(job.needs_machine && isCar(x)));
    if (!able.length) return { job, target: null, why: 'machine' };
    const open = able.filter((x) => jobOpen(rangesOf(x.id, job.day), job, blockOf));
    if (!open.length) return { job, target: null, why: 'closed' };
    const allowed = rules.mayMove ? open.filter((x) => rules.mayMove!(x.id)) : open;
    if (!allowed.length) return { job, target: null, why: 'rights' };
    let why: StayWhy = 'full';
    for (const x of allowed) {
      const room = rules.roomOf?.(x.id, job);
      if (!room) return { job, target: x.id, why: null };
      if (room.started) { why = 'started'; continue; }
      const key = `${x.id}|${job.day}|${job.block}`;
      const need = (job.duration_min || 0) + (rules.travelMin ?? 0);
      if (room.left - (taken.get(key) || 0) < need) continue;
      taken.set(key, (taken.get(key) || 0) + need);
      return { job, target: x.id, why: null };
    }
    return { job, target: null, why };
  });
}

/** move_job's rule, as the phone knows it: « book », or both vehicles are this person's (his own, or every one with
    « Routes partagées ») */
export function mayMoveBetween(fromId: string, toId: string, o: { book: boolean; mine: string[] }): boolean {
  return o.book || (o.mine.includes(fromId) && o.mine.includes(toId));
}

/** this phone holds every appointment of that vehicle (the owner, « Agenda », or his own vehicle): without it, the count of
    appointments touched by new hours can only be partial */
export function holdsJobsOf(truckId: string, o: { owner: boolean; agenda: boolean; mine: string[] }): boolean {
  return o.owner || o.agenda || o.mine.includes(truckId);
}
