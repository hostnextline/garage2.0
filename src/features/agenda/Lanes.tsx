/* The pieces of a place of the day: a job as a ticket (with its menu), a truck as a lane (how full it is, its jobs in
   stop order), a truck that does not work there, and the jobs « À placer ». */
import { TriangleAlert, CloudUpload } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { truckLabel, truckColor, type TruckBlock } from '../../data/select';
import type { Job, Truck } from '../../data/types';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { freeWords } from '../../domain/moment/words';
import { jobMenu, jobPress } from './actions';
import { Meter } from './Meter';
import { movesWaiting } from './move';

/** a ticket with its right-click menu (copy, open); the ticket itself says the window told to the customer, « Flexible »
    and « Hors plage » (JobTicket); a move of it still kept on the phone is said above it (agenda-14) */
export function Ticketed(p: { job: Job }) {
  const waits = movesWaiting.value.has(p.job.id);
  return (
    <div class={`agenda-ticketwrap${waits ? ' is-waiting' : ''}`} onContextMenu={(e) => jobMenu(e as MouseEvent, p.job)} {...jobPress(p.job)}>
      {waits && <span class="agenda-wait" title={t('agenda.move.waitingText')} data-testid={`ticket-wait-${p.job.id}`}><CloudUpload size={12} aria-hidden="true" />{t('agenda.move.waiting')}</span>}
      <JobTicket job={p.job} />
    </div>
  );
}

/** the jobs no truck could take, with what to do about it */
export function UnplacedLane(p: { jobs: Job[]; grid?: boolean }) {
  return (
    <div class="agenda-lane is-unplaced" data-testid="lane-unplaced">
      <div class="agenda-lane-head">
        <TriangleAlert size={18} aria-hidden="true" class="agenda-warn-icon" />
        <span class="agenda-lane-name">{t('agenda.lane.unplaced')}</span>
      </div>
      <p class="agenda-unplaced-text">{t('agenda.lane.unplacedText')}</p>
      <div class={`agenda-tickets${p.grid ? ' agenda-grid-strip' : ''}`}>{p.jobs.map((j) => <Ticketed key={j.id} job={j} />)}</div>
    </div>
  );
}

export function Lane(p: { lane: TruckBlock; started: boolean; whole?: boolean }) {
  const l = lang.value;
  const { truck, cap, used, jobs } = p.lane;
  const name = truckLabel(truck.id);
  return (
    <div class="agenda-lane" style={{ '--tc': truckColor(truck.id) }} data-testid={`lane-${truck.id}`}>
      <div class="agenda-lane-head">
        <span class="agenda-dot" aria-hidden="true" />
        <span class="agenda-lane-name">{name}</span>
      </div>
      {!p.started && (
        <div class="agenda-lane-fill">
          {cap > 0 && <Meter used={used} cap={cap} label={name} />}
          <span class={`agenda-free${cap - used <= 0 ? ' is-full' : ''}`}>{freeWords(used, cap, l, false, p.whole)}</span>
        </div>
      )}
      {jobs.length > 0 && <div class="agenda-tickets">{jobs.map((j) => <Ticketed key={j.id} job={j} />)}</div>}
    </div>
  );
}
export function IdleLane(p: { truck: Truck }) {
  return (
    <div class="agenda-lane is-idle" style={{ '--tc': truckColor(p.truck.id) }} data-testid={`lane-idle-${p.truck.id}`}>
      <div class="agenda-lane-head">
        <span class="agenda-dot" aria-hidden="true" />
        <span class="agenda-lane-name">{truckLabel(p.truck.id)}</span>
        <span class="agenda-idle">{t('agenda.lane.closed')}</span>
      </div>
    </div>
  );
}
