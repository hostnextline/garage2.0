/* A vehicle closes a day (or a block of it; with arrival windows: the hours of a window told to a customer) that has appointments: which appointments are touched, and which vehicle of
   the other kind (the car ↔ the truck) can take each one. An appointment keeps its kind (jobs_kind_follow), so the planner
   never slides it to the other vehicle by itself: Horaires asks (CloseDaySheet), and « Départ et heure » on the map asks
   before closing them. Pure (what the phone knows of rights and room is passed in).
   Only what the phone can know: the server's planner still has the last word (a block that only shrinks, the room of the
   other vehicle: the phone's estimate never hides a move, the planner's real insertion may still take it); a move it
   refuses stops the closing (HoursScreen), and that appointment is then offered no more (`stayed`), with the reason. */
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
    closed then, no right to move it there, its moment already started, no room left there (the server said so), the
    server refused it for another reason, its move is kept on the phone and will be sent later */
export type StayWhy = 'machine' | 'closed' | 'rights' | 'started' | 'full' | 'refused' | 'waiting';
export interface Move { job: Job; target: string | null; why: StayWhy | null }
/** what the phone knows of the other vehicle's block that day: whether it has started (the room is the planner's to say) */
export interface Room { started: boolean }
export interface MoveRules {
  /** may this person put appointments of this vehicle on that one (move_job's rule) */
  mayMove?: (targetId: string) => boolean;
  /** the other vehicle's block that day (blockLoad), the job itself left out; null: nothing known */
  roomOf?: (targetId: string, job: Job) => Room | null;
  /** appointments whose move the server already refused (or still holds on the phone) in this closing: never offered again */
  stayed?: ReadonlyMap<string, StayWhy>;
}
/** where each appointment can go: a vehicle of the other kind open in its block that day, or (arrival windows) working
    inside the window told: the appointment keeps its day and its window (work for the tire machine never goes to the car).
    Only offered when the person may move it there and the block has not started. The room is NOT judged here: the
    phone's estimate (straight lines, a fixed driving time) says « full » where the planner's real insertion may fit it,
    so the move is offered and a « truck_full » / « block_full » refusal comes back through `stayed` (map-hours-01). */
export function movesFor(hit: Job[], targets: Truck[], rangesOf: (truckId: string, day: Day) => Range[], blockOf: (k: Job['block']) => Block, rules: MoveRules = {}): Move[] {
  return hit.map((job): Move => {
    const said = rules.stayed?.get(job.id);
    if (said) return { job, target: null, why: said };
    const able = targets.filter((x) => !(job.needs_machine && isCar(x)));
    if (!able.length) return { job, target: null, why: 'machine' };
    const open = able.filter((x) => jobOpen(rangesOf(x.id, job.day), job, blockOf));
    if (!open.length) return { job, target: null, why: 'closed' };
    const allowed = rules.mayMove ? open.filter((x) => rules.mayMove!(x.id)) : open;
    if (!allowed.length) return { job, target: null, why: 'rights' };
    const ready = allowed.find((x) => !rules.roomOf?.(x.id, job)?.started);
    return ready ? { job, target: ready.id, why: null } : { job, target: null, why: 'started' };
  });
}

/** why the server refused a move (its short code: `hint` from the database, `code` from a function) */
export function refusedWhy(e: unknown): StayWhy {
  const err = e as { hint?: string; code?: string } | null;
  const code = String(err?.hint || (/^[a-z_]+$/.test(String(err?.code || '')) ? err?.code : '') || '');
  if (code === 'not_allowed') return 'rights';
  if (code === 'block_started' || code === 'not_booked') return 'started';
  if (code === 'block_closed') return 'closed';
  if (code === 'truck_full' || code === 'block_full' || code === 'window_full') return 'full';
  if (code === 'needs_truck') return 'machine';
  return 'refused';
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
