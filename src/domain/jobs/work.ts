/* The rules of a job's work lines: who may take one off and how, whose added work is an extra the customer must accept,
   when a price may change, when the customer may still answer. Pure (tested in work.test.ts). */
import type { JobItem, JobStatus } from '../../data/types';
import { isOpen } from './billing';

/** a line that may be taken off: not billed on a finished invoice (« Modifier la facture » first), and still work */
export function mayRemove(i: Pick<JobItem, 'status'>, billed: boolean): boolean {
  return !billed && ['planned', 'done', 'approved', 'proposed'].includes(i.status);
}
/** how a line is taken off: on site the work stays on the job as « Pas fait » (it can be put back); before the visit, or a
    proposal, it leaves the job (deleted: the toast offers to put it back) */
export function removal(jobStatus: JobStatus, i: Pick<JobItem, 'status'>): 'not_done' | 'delete' {
  return jobStatus === 'on_site' && i.status !== 'proposed' ? 'not_done' : 'delete';
}
/** once on site, work a mechanic adds is an extra: the customer must accept it (the owner and the office add planned work) */
export function addsExtra(office: boolean, jobStatus: JobStatus): boolean { return !office && jobStatus === 'on_site'; }
/** « Changer le prix »: while the job is coming or under way, on a line that is work (the invoice decides the rest) */
export function mayReprice(jobStatus: JobStatus, i: Pick<JobItem, 'status'>): boolean {
  return isOpen(jobStatus) && ['planned', 'approved', 'done', 'proposed'].includes(i.status);
}
/** the customer may still answer a proposal: the job is open (an answer on a finished or cancelled job is never billed) */
export function mayAnswer(act: boolean, jobStatus: JobStatus, i: Pick<JobItem, 'status'>): boolean {
  return act && isOpen(jobStatus) && i.status === 'proposed';
}
