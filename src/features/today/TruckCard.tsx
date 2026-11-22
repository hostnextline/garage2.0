/* « La journée »: one truck now: where it is (on the way, there, waiting), its progress, the next stop and its arrival,
   the window told to that customer, how old its position is. On the way, the arrival is the trip's real one (« Je pars »
   asked TomTom, else OSRM); without it no time is said, as on the map's legend. A tap on the card opens the job it
   speaks of. Under it, « Voir les N arrêts » lists the truck's stops of the day as tickets, each with the agenda's
   shortcut menu (right-click, long press: « Déplacer » on this screen; Hassan, 2026-11-21).
   « Dit au client » (Part 28, R5a, REARRANGE.md §3.8) says what the customer was TOLD (told_*), else the planned window;
   while he is due (new / changed: not when his sure arrival is still inside what he was told) it adds « nouvelle plage
   … : pas encore envoyée »; never told anything: « Pas encore averti ». « Hors plage » keeps comparing the arrival with
   the PLANNED window (what the truck must keep). */
import { useState } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { Avatar, Pill, Button } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { staff, staffName, truckColor, activeTrip } from '../../data/select';
import { may } from '../../domain/rights';
import { jobFirstName, clockOf, minuteOf, isWindowJob, outsideWindow, plannedTime, etaUnsure } from '../../shared/jobs/select';
import { tellCtx, tellNow, tellState, isDue, toldWindow } from '../../domain/jobs/told';
import { windowWords } from '../../domain/moment/words';
import type { Job } from '../../data/types';
import { agoText } from '../../services/position';
import type { TruckNow } from './select';
import { arrivalOf } from './rules';
import { StopTicket } from './StopTicket';

/** « Dit au client : entre 9 h et 13 h » (+ « nouvelle plage … : pas encore envoyée » while due), or « Pas encore averti » */
export function toldLine(j: Job, l = lang.value): { said: string; notSent: string | null } {
  if (j.told_at == null) return { said: t('tell.neverTold'), notSent: null };
  const said = t('today.win.told', { window: windowWords(toldWindow(j), l) });
  const ctx = tellCtx();
  if (!isDue(tellState(j, ctx))) return { said, notSent: null };
  const n = tellNow(j, ctx);
  return { said, notSent: t('tell.notSent', { window: windowWords(n.start != null && n.end != null ? [n.start, n.end] : null, l) }) };
}

function nowLine(x: TruckNow): string {
  const c = x.current;
  if (c && x.state === 'en_route') {
    // on the way: the trip's real arrival, or no time (never the plan's time said as an arrival: F10)
    const eta = arrivalOf(c, minuteOf(activeTrip(c.id)?.eta_at));
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
    ? (plannedTime(x.next) != null ? t('today.trucks.next', { name: jobFirstName(x.next), time: clock(plannedTime(x.next)!, lang.value) })
      // « Vraies routes » on, a trip before that stop not measured yet: no time, and it says why (final-guess G1)
      : x.next.status === 'booked' && etaUnsure(x.next) ? `${t('today.trucks.nextNoTime', { name: jobFirstName(x.next) })}, ${t('jobs.order.etaUnmeasured')}`
      : t('today.trucks.nextNoTime', { name: jobFirstName(x.next) }))
    : '';
  // « Plages d'arrivée »: the window told to the next customer, beside the planned arrival
  const told = x.next && isWindowJob(x.next) ? x.next : null;
  const said = told ? toldLine(told) : null;
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
      {told && said && (
        <span class="small today-truck-win" data-testid="today-truck-window">
          {said.said}
          {said.notSent && <>, <span data-testid="today-truck-notsent">{said.notSent}</span></>}
          {outsideWindow(told) && <> <Pill tone="warn" data-testid="today-truck-late">{t('common.window.late')}</Pill></>}
        </span>
      )}
      <span class="small faint">{x.posAt ? t('today.trucks.position', { ago: agoText(x.posAt, p.now) }) : x.shiftOpen ? t('today.trucks.noPosition') : ''}</span>
    </>
  );
  return (
    <div class="today-truck" data-testid="today-truck">
      {href ? <a class="today-truck-link" href={href}>{inner}</a> : <div class="today-truck-link">{inner}</div>}
      {x.total > 0 && <TruckStops x={x} />}
    </div>
  );
}

/** the truck's stops of the day, folded at first (the screen stays calm); each one the app's ticket with its menu */
function TruckStops(p: { x: TruckNow }) {
  const [open, setOpen] = useState(false);
  const id = p.x.truck.id;
  return (
    <div class="today-truck-stops">
      <Button variant="ghost" class="today-fold" icon={open ? <ChevronUp /> : <ChevronDown />} onClick={() => setOpen(!open)} data-testid={`today-truck-stops-${id}`}>
        {open ? t('today.trucks.stopsHide') : t('today.trucks.stopsShow', { n: p.x.total })}
      </Button>
      {open && (
        <div class="today-tickets" data-testid={`today-truck-list-${id}`}>
          {p.x.jobs.map((j) => <StopTicket key={j.id} job={j} />)}
          <p class="small faint today-truck-hint">{t(may.book() ? 'today.trucks.stopsHintMove' : 'today.trucks.stopsHint')}</p>
        </div>
      )}
    </div>
  );
}
