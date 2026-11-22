/* A stop of a truck on Aujourd'hui (« Les camions », « Ma journée »): the app's ticket, which opens the appointment on a
   tap, with the agenda's shortcut menu on a right-click (computer) or a long press (phone): each shortcut for who may,
   « Déplacer » opening the move sheet on this screen (Hassan, 2026-11-21; TodayScreen mounts the MoveHost). */
import type { Job } from '../../data/types';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { menuProps } from '../../shared/jobs/shortcuts';
import { openMove } from '../../shared/jobs/MoveHost';
import { seen } from '../../shared/jobs/select';
import { MoveWaiting } from '../../shared/jobs/MoveWaiting';

/** `shown`: the job as its ticket says it (« Ma journée »'s next stop: the trip's real arrival); the menu reads `job` */
export function StopTicket(p: { job: Job; shown?: Job }) {
  return (
    <div class="today-stopwrap" {...menuProps(seen(p.job), { onMove: openMove })} data-testid={`today-stop-${p.job.id}`}>
      <MoveWaiting id={p.job.id} />
      <JobTicket job={p.shown ?? p.job} />
    </div>
  );
}
