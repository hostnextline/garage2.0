/* « La journée »: one truck now: where it is (on the way, there, waiting), its progress, the next stop and its arrival,
   the window told to that customer, how old its position is. */
import { Avatar, Pill } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { staff, staffName, truckColor, activeTrip } from '../../data/select';
import { may } from '../../domain/rights';
import { jobFirstName, blockRange, clockOf, minuteOf, isWindowJob, outsideWindow } from '../../shared/jobs/select';
import { agoText } from '../../services/position';
import type { TruckNow } from './select';

function nowLine(x: TruckNow): string {
  const c = x.current;
  if (c && x.state === 'en_route') {
    const trip = activeTrip(c.id);
    const eta = minuteOf(trip?.eta_at) ?? c.eta_min;
    return eta != null ? t('today.trucks.enRouteEta', { name: jobFirstName(c), time: clock(eta, lang.value) }) : t('today.trucks.enRoute', { name: jobFirstName(c) });
  }
  if (c && x.state === 'on_site') return c.arrived_at ? t('today.trucks.onSiteSince', { name: jobFirstName(c), time: clockOf(c.arrived_at) }) : t('today.trucks.onSite', { name: jobFirstName(c) });
  if (x.state === 'waiting') return t('today.trucks.waiting');
  if (x.state === 'not_started') return t('today.trucks.notStarted');
  if (x.state === 'finished') return t('today.trucks.finished');
  return t('today.trucks.empty');
}

export function TruckCard(p: { x: TruckNow; now: number; day: string }) {
  const { x } = p;
  const driver = staff(x.truck.driver_id);
  const target = x.current || x.next;
  const href = target ? `#/job/${target.id}` : may.agenda() ? `#/agenda/${p.day}` : undefined;
  const next = x.next && x.next.id !== x.current?.id
    ? (x.next.eta_min != null ? t('today.trucks.next', { name: jobFirstName(x.next), time: clock(x.next.eta_min, lang.value) }) : t('today.trucks.nextNoTime', { name: jobFirstName(x.next) }))
    : '';
  // « Plages d'arrivée »: the window told to the next customer, beside the planned arrival
  const told = x.next && isWindowJob(x.next) ? x.next : null;
  const inner = (
    <>
      <span class="today-truck-top">
        <span class="today-truck-dot" style={{ background: truckColor(x.truck.id) }} aria-hidden="true" />
        <span class="today-truck-name">{x.truck.name}</span>
        <span class="today-truck-driver">
          {driver ? <><Avatar name={driver.full_name} color={driver.color} size="sm" /><span>{staffName(driver.id)}</span></> : <span class="faint">{t('today.trucks.noDriver')}</span>}
        </span>
      </span>
      <span class={`today-truck-now is-${x.state}`}>{nowLine(x)}</span>
      {x.total > 0 && (
        <span class="today-progress" role="img" aria-label={t('today.trucks.progressLabel', { done: x.done, total: x.total })}>
          {x.jobs.map((j) => <span key={j.id} class={`is-${j.status}`} />)}
        </span>
      )}
      {(x.total > 0 || next) && (
        <span class="today-truck-foot">
          {x.total > 0 && <span class="num">{t('today.trucks.progress', { done: x.done, total: x.total })}</span>}
          {next && <span class="ellipsis">{next}</span>}
        </span>
      )}
      {told && (
        <span class="small today-truck-win" data-testid="today-truck-window">
          {t('today.win.told', { window: blockRange(told) })}
          {outsideWindow(told) && <> <Pill tone="warn" data-testid="today-truck-late">{t('common.window.late')}</Pill></>}
        </span>
      )}
      <span class="small faint">{x.posAt ? t('today.trucks.position', { ago: agoText(x.posAt, p.now) }) : x.shiftOpen ? t('today.trucks.noPosition') : ''}</span>
    </>
  );
  return href
    ? <a class="today-truck" href={href} data-testid="today-truck">{inner}</a>
    : <div class="today-truck" data-testid="today-truck">{inner}</div>;
}
