/* The appointment of a stop of the map, for « Déplacer » and the shortcut menu: this phone's row (as this phone sees it,
   steps waiting to be sent included), or nothing when the phone does not hold it (the server's map may show more). A stop
   the server already sees on the way, there or done is never offered a move, even while this phone still says booked. */
import { job as jobRow } from '../../data/select';
import type { Job, JobStatus } from '../../data/types';
import { seen } from '../../shared/jobs/select';
import type { Stop } from '../../shared/map/assemble';

export function stopJob(s: Pick<Stop, 'id' | 'status'>): Job | null {
  const row = jobRow(s.id);
  if (!row) return null;
  const j = seen(row);
  return j.status === 'booked' && s.status !== 'booked' ? { ...j, status: s.status as JobStatus } : j;
}
