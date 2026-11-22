/* « Pas terminé »: the jobs of a past day still booked, on the way or there. Shown first on both day screens while there
   is one, so nobody forgets a job the customer pays later, a « Terminer » never tapped, or the stops of a sick mechanic.
   Each ticket opens its job, where it is finished, moved, marked absent or cancelled. A stop left on the way says no
   plan time as its arrival (ticketJob). */
import { t } from '../../lib/i18n';
import { Help } from '../../ui';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { seen } from '../../shared/jobs/select';
import { openBeforeFor, ticketJob } from './select';
import { OPEN } from './rules';

export function OpenBefore(p: { day: string; mineOnly: boolean }) {
  // as the jobs will be once the steps waiting on this phone are sent (a « Terminer » tapped offline is done already)
  const list = openBeforeFor(p.day, p.mineOnly).map(seen).filter((j) => OPEN.includes(j.status));
  if (!list.length) return null;
  return (
    <section class="today-section" aria-labelledby="today-open" data-testid="today-open">
      <h2 class="today-h" id="today-open">{t('today.open.title', { n: list.length })} <Help text={t('today.open.help')} /></h2>
      <div class="today-tickets">{list.map((j) => <JobTicket key={j.id} job={ticketJob(j)} />)}</div>
    </section>
  );
}
