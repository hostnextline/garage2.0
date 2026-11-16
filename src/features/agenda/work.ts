/* The work of each job, as its tickets on the agenda say it: the lines that are part of the appointment (planned, done,
   accepted; never a line taken off, refused, or an extra the customer has not answered). Indexed once per change of
   the lines: a week shows dozens of jobs, each would otherwise read the whole table. */
import { computed } from '@preact/signals';
import { rowsOf } from '../../data/store';
import type { JobItem } from '../../data/types';
import { BILLABLE } from '../../domain/jobs/steps';

const firstByJob = computed(() => {
  const best = new Map<string, JobItem>();
  for (const i of rowsOf<JobItem>('job_items')) {
    if (i.deleted_at || !BILLABLE.includes(i.status)) continue;
    const cur = best.get(i.job_id);
    // the same order as the job sheet: the sort number, then the creation
    if (!cur || i.sort - cur.sort < 0 || (i.sort === cur.sort && String(i.created_at) < String(cur.created_at))) best.set(i.job_id, i);
  }
  return best;
});
/** the first line of a job's work, in words ('' when it has none) */
export function firstWork(jobId: string): string { return firstByJob.value.get(jobId)?.description || ''; }
