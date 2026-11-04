/* A job as a ticket (a work order with its stub). Stub: the stop number (big) and the block (small), in the truck's
   colour. Body: the customer, the car and the work, when (and which truck), the status in words.
   Used by Aujourd'hui, the agenda and the customer's file. */
import type { Job } from '../../data/types';
import { Ticket, StatusPill } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { truckColor, truckLabel, vehicle, vehicleLabel, invoiceOf } from '../../data/select';
import { jobName, servicesText, shortDayWord, etaWord, clockOf, proposedOf, seen } from './select';
import './jobs.css';

export interface JobTicketProps { job: Job; showDay?: boolean; showTruck?: boolean }

/** when, in a few words: « vers 12 h 15 », « arrivé à 9 h 44 », « fini à 10 h 50 » */
function timeWord(j: Job, l: string): string {
  if ((j.status === 'booked' || j.status === 'en_route') && j.eta_min != null) return etaWord(j.eta_min, l as 'fr' | 'en');
  if (j.status === 'on_site' && j.arrived_at) return t('jobs.arrivedAt', { time: clockOf(j.arrived_at, l as 'fr' | 'en') });
  if (j.status === 'done' && j.finished_at) return t('jobs.finishedAt', { time: clockOf(j.finished_at, l as 'fr' | 'en') });
  return '';
}

export function JobTicket({ job, showDay, showTruck }: JobTicketProps) {
  const j = seen(job);
  const l = lang.value;
  const off = j.status === 'cancelled' || j.status === 'no_show';
  const car = vehicleLabel(vehicle(j.vehicle_id));
  const work = servicesText(j);
  const inv = invoiceOf(j.id);
  // one quiet flag at most: money to collect, or an answer the customer still owes
  const flag = j.status === 'done' && inv && inv.status === 'issued' ? t('jobs.ticket.toCollect')
    : !off && j.status !== 'done' && proposedOf(j.id).length ? t('jobs.ticket.waitingAnswer') : '';
  const bits = [showDay ? shortDayWord(j.day, l) : '', off ? '' : timeWord(j, l), showTruck ? (truckLabel(j.truck_id) || t('jobs.ticket.noTruck')) : '', flag].filter(Boolean);
  const meta = bits.length ? bits.map((b, i) => (i === 0 ? b.charAt(0).toUpperCase() + b.slice(1) : b)).join(', ') : undefined;
  return (
    <Ticket
      big={j.stop_order != null && !off ? j.stop_order : '—'}
      small={t(`common.blocks.${j.block}`)}
      color={j.truck_id ? truckColor(j.truck_id) : null}
      title={jobName(j)}
      sub={[car, work].filter(Boolean).join(', ') || undefined}
      meta={meta}
      status={<StatusPill status={j.status} />}
      off={off}
      href={`#/job/${j.id}`}
      class={`jobs-ticket${flag ? ' has-flag' : ''}`}
      data-testid="job-ticket"
    />
  );
}
