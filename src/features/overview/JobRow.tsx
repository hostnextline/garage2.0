/* An appointment of « Vue d'ensemble »: its stop number in the truck's colour (✓ done, ? unplaced), the planned arrival
   (on the way: the trip's real one, or « — »),
   the customer, the car and the first two lines of work, the truck, the window told, the status. Opens the job.
   A right-click (computer) or a long press (phone): the agenda's shortcut menu of that appointment, its « Déplacer »
   opening the move sheet on « Vue d'ensemble » (Hassan, 2026-11-21). */
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { customer as customerRow, customerName, vehicle as vehicleRow, vehicleLabel, itemsOf, activeTrip } from '../../data/select';
import { enRouteTicket, etaUnsure } from '../../domain/jobs/when';
import type { JobStatus } from '../../data/types';
import { BILLABLE } from '../../domain/jobs/steps';
import { RowItem, StatusPill, Pill } from '../../ui';
import { isWindowJob, blockRange, outsideWindow, seen } from '../../shared/jobs/select';
import { menuProps } from '../../shared/jobs/shortcuts';
import { openMove } from '../../shared/jobs/MoveHost';
import { MoveWaiting } from '../../shared/jobs/MoveWaiting';
import type { OverviewRow } from './rows';

export function JobRow(p: { r: OverviewRow; on: boolean }) {
  const { job: j, n, color, truckName } = p.r;
  const l = lang.value;
  // a stop on the way says the trip's REAL arrival or none, never the plan's time as an arrival (JobTicket's rule)
  const eta = enRouteTicket(j, seen(j).status, activeTrip(j.id)?.eta_at).eta_min;
  // « Vraies routes » on, a trip before this stop not measured yet: « — » and the words say why (final-guess G1)
  const unsure = seen(j).status === 'booked' && etaUnsure(j);
  const c = customerRow(j.customer_id);
  const car = vehicleLabel(vehicleRow(j.vehicle_id));
  // the work of the appointment: never a line taken off, refused, or an extra the customer has not answered
  const work = itemsOf(j.id).filter((i) => BILLABLE.includes(i.status)).map((i) => i.description).filter(Boolean);
  const what = [car, work.slice(0, 2).join(', ') + (work.length > 2 ? '…' : '') || (j.problem || '').slice(0, 60)].filter(Boolean).join(', ');
  return (
    <div class={`overview-row${p.on ? ' is-on' : ''}`} data-ov-job={j.id} {...menuProps(seen(j), { onMove: openMove })}>
      <RowItem href={`#/job/${j.id}`} chevron data-testid={`overview-job-${j.id}`}
        start={<span class="overview-n" style={{ '--c': color }} aria-label={n != null ? t('overview.stop', { n }) : t('overview.unplaced')}>{j.status === 'done' ? '✓' : n ?? '?'}</span>}
        title={<><span class="num overview-time">{eta != null ? clock(eta, l) : '—'}</span> {customerName(c) || '—'}</>}
        sub={<><MoveWaiting id={j.id} />{unsure && <span class="overview-unsure" data-testid={`overview-unsure-${j.id}`}>{t('jobs.order.etaUnmeasured')}</span>}{what && <span class="overview-what">{what}</span>}<span class="overview-truck">{truckName}</span>
          {isWindowJob(j) && <span class="overview-window" data-testid={`overview-window-${j.id}`}>{blockRange(j, l)}{outsideWindow(j) && <> <Pill tone="warn">{t('common.window.late')}</Pill></>}</span>}</>}
        end={<StatusPill status={j.status as JobStatus} />} />
    </div>
  );
}
