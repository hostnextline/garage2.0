/* Who may do what on a job (mirrors the server's rules, which check again). */
import type { StepRights } from './steps';
import type { Job } from '../../data/types';
import { me, isOwner, myTrucks, hasRole, can } from '../../data/auth';
import { blockLoad, invoiceOf } from '../../data/select';
import { may } from '../rights';

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
  return {
    act: owner || book || mine || opened,
    invoice: owner || can('edit_invoices') || ((mine || opened) && hasRole('mechanic')) || book,
    payLater: owner || can('edit_invoices'),
    mine, office,
    move: office || book,
    // the order of the stops: the owner, the office (« book »), the truck's driver (as the server)
    order: owner || book || mine,
    duration: office && (book || mine),
    reopen: office,
    verbal: office,
    editNotes: office,
    text: owner || book || mine || opened,
    backFromDone: owner || book
  };
}

/** may this appointment change truck now: booked, its block not started, the person may move appointments */
export function mayChangeTruck(j: Job, rights: Pick<JobRights, 'move'>): boolean {
  return j.status === 'booked' && rights.move && !blockLoad(j.day, j.block).started;
}

const live = (j: Job) => j.status === 'booked' || j.status === 'en_route' || j.status === 'on_site';
const invoiceDone = (j: Job) => { const v = invoiceOf(j.id); return !!v && v.status !== 'draft' && v.status !== 'void'; };
/** who may fix what (the server checks the same) */
export function editRights(j: Job, r: JobRights) {
  const anyone = r.act || may.book();
  return {
    customer: j.status === 'booked' && (may.book() || r.mine) && !invoiceDone(j),
    car: live(j) && anyone,
    address: (j.status === 'booked' || j.status === 'en_route') && anyone,
    move: j.status === 'booked' && r.move,
    truck: mayChangeTruck(j, r),
    work: live(j) && r.act && !invoiceDone(j),
    notes: r.editNotes
  };
}
export function mayEditJob(j: Job, r: JobRights): boolean { return Object.values(editRights(j, r)).some(Boolean); }
