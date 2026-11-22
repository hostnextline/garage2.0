/* « Coffre » (family and friends, Part 20): which jobs can go in it together. The report and its exports are in features/coffre/logic.ts. */
import type { Job, Invoice } from '../../data/types';

/** the jobs that may go in the Coffre together with this one: same customer, not cancelled, not in it, nothing paid */
export function coffreCandidates(job: Pick<Job, 'id' | 'customer_id'>, jobs: Job[], invoiceOf: (jobId: string) => Invoice | undefined, prepaid: (jobId: string) => boolean): Job[] {
  return jobs
    .filter((j) => !j.deleted_at && j.customer_id === job.customer_id && !j.coffre_id && j.status !== 'cancelled' && j.status !== 'no_show')
    .filter((j) => { const v = invoiceOf(j.id); return !(v && v.status !== 'void' && !v.deleted_at && v.paid_cents > 0) && !prepaid(j.id); })
    .sort((a, b) => (a.id === job.id ? -1 : b.id === job.id ? 1 : b.day.localeCompare(a.day) || b.number - a.number));
}
