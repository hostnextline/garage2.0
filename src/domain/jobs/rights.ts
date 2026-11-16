/* Who may do what on a job. Each right mirrors the server's own rule (which checks again): the app never offers a button
   the server will refuse. The office ROLE alone is not a right: a person of the office whose « Réserver » was taken off may
   not move an appointment (move_job asks « book »), and what job_actor / jobs_upd allow is asked the same way here. */
import type { StepRights } from './steps';
import type { Job } from '../../data/types';
import { me, isOwner, myTrucks, hasRole, can } from '../../data/auth';
import { blockLoad, invoiceOf } from '../../data/select';
import { may } from '../rights';
import { isFinished, isOpen } from './billing';

export interface JobRights extends StepRights {
  /** the person drives this job's truck: they are the one at the customer's door */
  mine: boolean;
  /** the owner or the office */
  office: boolean;
  move: boolean; order: boolean; duration: boolean; reopen: boolean; verbal: boolean; editNotes: boolean; text: boolean; backFromDone: boolean;
}
export function jobRights(j: Job): JobRights {
  const a = me.value;
  const owner = isOwner();
  const mine = !!j.truck_id && myTrucks().includes(j.truck_id);
  // the server also lets the person who opened a job (a walk-in) work it
  const opened = !!a && j.created_by === a.id && (owner || hasRole('office') || hasRole('mechanic'));
  const office = owner || hasRole('office');
  const book = can('book');
  // job_actor (job_step, extra_answer): the owner, the booking right, the job's truck, its author on the team
  const actor = owner || book || mine || opened;
  return {
    act: actor,
    invoice: owner || can('edit_invoices') || ((mine || opened) && hasRole('mechanic')) || book,
    payLater: owner || can('edit_invoices'),
    mine, office,
    // move_job: the booking right (« Changer de camion » between one's own trucks is the server's other door)
    move: book,
    // the order of the stops: the owner, the office (« book »), the truck's driver (as the server)
    order: owner || book || mine,
    duration: office && (book || mine),
    // the office's own buttons, where the server's rule is the job's actor
    reopen: office && actor,
    verbal: office && actor,
    // jobs_upd: the booking right, the job's truck, its author
    editNotes: office && (book || mine || (!!a && j.created_by === a.id)),
    text: actor,
    backFromDone: owner || book
  };
}

/** may this appointment change truck now: booked, its block not started, the person may move appointments */
export function mayChangeTruck(j: Job, rights: Pick<JobRights, 'move'>): boolean {
  return j.status === 'booked' && rights.move && !blockLoad(j.day, j.block).started;
}

/** who may fix what (the server checks the same) */
export function editRights(j: Job, r: JobRights) {
  const anyone = r.act || may.book();
  const billed = isFinished(invoiceOf(j.id));
  return {
    customer: j.status === 'booked' && (may.book() || r.mine) && !billed,
    car: isOpen(j.status) && anyone,
    address: (j.status === 'booked' || j.status === 'en_route') && anyone,
    move: j.status === 'booked' && r.move,
    truck: mayChangeTruck(j, r),
    work: isOpen(j.status) && r.act && !billed,
    notes: r.editNotes
  };
}
export function mayEditJob(j: Job, r: JobRights): boolean { return Object.values(editRights(j, r)).some(Boolean); }
