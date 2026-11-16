/* An appointment of « Vue d'ensemble »: its stop number in the truck's colour (✓ done, ? unplaced), the planned arrival,
   the customer, the car and the first two lines of work, the truck, the window told, the status. Opens the job. */
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { customer as customerRow, customerName, vehicle as vehicleRow, vehicleLabel, itemsOf } from '../../data/select';
import type { JobStatus } from '../../data/types';
import { BILLABLE } from '../../domain/jobs/steps';
import { RowItem, StatusPill, Pill } from '../../ui';
import { isWindowJob, blockRange, outsideWindow } from '../../shared/jobs/select';
import type { OverviewRow } from './rows';

export function JobRow(p: { r: OverviewRow; on: boolean }) {
  const { job: j, n, color, truckName } = p.r;
  const l = lang.value;
  const c = customerRow(j.customer_id);
  const car = vehicleLabel(vehicleRow(j.vehicle_id));
  // the work of the appointment: never a line taken off, refused, or an extra the customer has not answered
  const work = itemsOf(j.id).filter((i) => BILLABLE.includes(i.status)).map((i) => i.description).filter(Boolean);
  const what = [car, work.slice(0, 2).join(', ') + (work.length > 2 ? '…' : '') || (j.problem || '').slice(0, 60)].filter(Boolean).join(', ');
  return (
    <div class={`overview-row${p.on ? ' is-on' : ''}`} data-ov-job={j.id}>
      <RowItem href={`#/job/${j.id}`} chevron data-testid={`overview-job-${j.id}`}
        start={<span class="overview-n" style={{ '--c': color }} aria-label={n != null ? t('overview.stop', { n }) : t('overview.unplaced')}>{j.status === 'done' ? '✓' : n ?? '?'}</span>}
        title={<><span class="num overview-time">{j.eta_min != null ? clock(j.eta_min, l) : '—'}</span> {customerName(c) || '—'}</>}
        sub={<>{what && <span class="overview-what">{what}</span>}<span class="overview-truck">{truckName}</span>
          {isWindowJob(j) && <span class="overview-window" data-testid={`overview-window-${j.id}`}>{blockRange(j, l)}{outsideWindow(j) && <> <Pill tone="warn">{t('common.window.late')}</Pill></>}</span>}</>}
        end={<StatusPill status={j.status as JobStatus} />} />
    </div>
  );
}
