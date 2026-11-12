/* « Ma journée »: the shift (start, end, time worked, the position shared with the office), the next stop with its red
   button (the same next step as on the job sheet), the other stops in order, the finished ones folded, the day in
   numbers, and the first stop of the next working day. */
import { useState } from 'preact/hooks';
import { Power, MapPin, LocateOff, ChevronDown, ChevronUp, CalendarDays, MapPinCheck, Truck } from 'lucide-preact';
import { Panel, Button, Empty, Help, Banner, BigStep, toast, Seg } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { today, addDays, duration } from '../../lib/dates';
import { me, myTrucks } from '../../data/auth';
import { openShift, positionOf, settings, truck as truckRow, activeReturnTrip } from '../../data/select';
import { shiftStart, shiftEnd, errorMessage } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { may } from '../../app/routes';
import type { Job } from '../../data/types';
import { JobTicket } from '../jobs/JobTicket';
import { CarFirst } from '../jobs/CarFirst';
import { StepButton, PRESSABLE } from '../jobs/StepButton';
import { stepOf, jobRights, dayWord, clockOf, seen } from '../jobs/select';
import { doReturn, doReturnEnd } from '../jobs/flow';
import { sharing, retryPosition, agoText } from './position';
import { OPEN, myJobsOn, nextStopOf, summaryOf, nextWorkDay, shiftsOf, workedMinutes, useTick, myRoute, setMyRoute } from './select';

/* ---------- the shift ---------- */
/** calm: another red button leads the screen (the next stop): the shift's own button stays quiet */
export function ShiftCard(p: { compact?: boolean; calm?: boolean }) {
  const a = me.value;
  const now = useTick(30_000);
  if (!a) return null;
  const open = openShift(a.id);
  const shifts = shiftsOf(a.id);
  const worked = workedMinutes(shifts, now);
  const l = lang.value;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, { kind: 'ok' }); } catch (e) { toast(isNetworkError(e) ? t('today.shift.offline') : errorMessage(e), { kind: 'bad' }); }
  };
  const last = shifts[shifts.length - 1];
  return (
    <section class={`panel glass today-shift${open ? ' is-on' : ''}`} data-tour="today-shift" data-testid="today-shift">
      <div class="today-shift-row">
        <span class="today-shift-icon" aria-hidden="true"><Power /></span>
        <div class="grow">
          {open ? <>
            <h2 class="today-shift-title">{t('today.shift.started', { time: clockOf(open.started_at) })}</h2>
            <p class="today-shift-sub">{t('today.shift.worked', { time: duration(worked, l) })}</p>
          </> : last ? <>
            <h2 class="today-shift-title">{t('today.shift.ended', { time: clockOf(last.ended_at) })}</h2>
            <p class="today-shift-sub">{t('today.shift.endedSub', { time: duration(worked, l) })}</p>
          </> : <>
            <h2 class="today-shift-title">{t('today.shift.notStarted')}</h2>
            <p class="today-shift-sub">{t('today.shift.notStartedSub')} <Help text={t('today.shift.help')} /></p>
          </>}
        </div>
        {open
          ? <Button size={p.compact ? 'sm' : 'md'} confirm={t('today.shift.endConfirm')} onClick={() => act(shiftEnd, t('today.shift.endedToast'))} data-testid="shift-end">{t('today.shift.end')}</Button>
          : <Button variant={p.calm ? 'secondary' : 'primary'} onClick={() => act(shiftStart, t('today.shift.startedToast'))} data-testid="shift-start">{last ? t('today.shift.resume') : t('today.shift.start')}</Button>}
      </div>
      {open && <PositionLine now={now} />}
    </section>
  );
}

/** « Position partagée avec le bureau, il y a 1 min », or what is wrong in plain words */
function PositionLine(p: { now: number }) {
  const a = me.value;
  const s = sharing.value;
  const server = a ? positionOf(a.id)?.at : null;
  const at = Math.max(s.sentAt || 0, server ? Date.parse(server) : 0) || null;
  if (s.status === 'denied') {
    return (
      <div class="today-pos-off" role="status" data-testid="position-denied">
        <b><LocateOff aria-hidden="true" />{t('today.position.deniedTitle')}</b>
        <p>{t('today.position.denied')}</p>
        <p>{t('today.position.deniedHow')}</p>
        <Button size="sm" onClick={retryPosition}>{t('today.position.retry')}</Button>
      </div>
    );
  }
  if (s.status === 'unsupported') return <p class="today-pos is-off"><LocateOff aria-hidden="true" />{t('today.position.unsupported')}</p>;
  if (s.status === 'unavailable' && !at) return <p class="today-pos is-warn"><LocateOff aria-hidden="true" />{t('today.position.unavailable')}</p>;
  if (!at) return <p class="today-pos"><span class="today-pos-dot is-wait" aria-hidden="true" />{t('today.position.starting')}</p>;
  return (
    <p class="today-pos" data-testid="position-shared">
      <span class="today-pos-dot" aria-hidden="true" /><span>{t('today.position.shared', { ago: agoText(at, p.now) })}
        {s.status === 'unavailable' && <span class="faint"> {t('today.position.unavailable')}</span>}</span>
      <Help text={t('today.shift.help')} />
    </p>
  );
}

/* ---------- the way back: after the last stop, the next destination is the start ---------- */
/** where this person's truck goes home: the truck's own start, else « Départ des camions » */
function homeOf(): { label: string; address: string; ok: boolean } {
  const own = myTrucks().map((id) => truckRow(id)?.start).find((s) => s && s.lat != null && s.lng != null);
  const h = own || settings.value.booking?.home;
  return { label: h?.label || 'Centrale', address: h?.address || '', ok: !!h && h.lat != null && h.lng != null };
}
function ReturnCard() {
  const a = me.value;
  if (!a) return null;
  const trip = activeReturnTrip(a.id);
  const home = homeOf();
  const place = trip?.dest_label || home.label;
  if (trip) {
    return (
      <section class="panel glass today-next is-now" data-tour="today-next" data-testid="today-return">
        <div class="panel-head"><h2 class="panel-title">{t('today.return.onWay', { place })}</h2></div>
        <div class="stack">
          <p class="muted" style={{ margin: 0 }} data-testid="today-return-eta">{trip.eta_at ? t('today.return.eta', { time: clockOf(trip.eta_at) }) : t('today.return.noEta')}</p>
          <BigStep icon={<MapPinCheck />} label={t('today.return.arrived')} sub={t('today.return.arrivedSub')} onClick={doReturnEnd} data-testid="today-return-arrived" />
        </div>
      </section>
    );
  }
  const manual = me.value?.texts_online === false;
  return (
    <section class="panel glass today-next" data-tour="today-next" data-testid="today-return">
      <div class="panel-head"><h2 class="panel-title">{t('today.next.allDone')}</h2></div>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('today.return.next', { place })}{home.address ? ` (${home.address})` : ''}</p>
        {home.ok
          ? <BigStep icon={<Truck />} label={t('today.return.leave', { place })} sub={manual ? t('today.return.leaveSubManual') : t('today.return.leaveSub')} onClick={doReturn} data-testid="today-return-leave" />
          : <Banner kind="warn">{t('today.return.noHome')}</Banner>}
      </div>
    </section>
  );
}

/* ---------- the next stop ---------- */
function NextStop(p: { list: Job[] }) {
  const next = nextStopOf(p.list);
  if (!myTrucks().length) {
    return <Panel data-tour="today-next"><Empty icon={<Truck />} title={t('today.next.noTruck')} text={t('today.next.noTruckText')} /></Panel>;
  }
  if (!next) {
    // the day's stops are all done (or there were none): the next destination is the start
    if (p.list.length) return <ReturnCard />;
    return (
      <Panel data-tour="today-next" data-testid="today-next">
        <Empty icon={<CalendarDays />} title={t('today.next.empty')} text={t('today.next.emptyText')}
          action={may.agenda() ? <Button href={`#/agenda/${addDays(today(), 1)}`}>{t('today.next.seeAgenda')}</Button> : undefined} />
      </Panel>
    );
  }
  const step = stepOf(next);
  const now = next.status === 'on_site' || next.status === 'en_route';
  return (
    <section class={`panel glass today-next${now ? ' is-now' : ''}`} data-tour="today-next" data-testid="today-next">
      <div class="panel-head"><h2 class="panel-title">{now ? t('today.next.now') : t('today.next.title')}</h2></div>
      <div class="stack">
        <CarFirst job={next} compact />
        <JobTicket job={next} />
        {PRESSABLE.includes(step.kind)
          ? <StepButton job={next} step={step} rights={jobRights(next)} />
          : <Button href={`#/job/${next.id}`} block>{t('today.next.open')}</Button>}
      </div>
    </section>
  );
}

/* ---------- several routes are mine (« Routes partagées »): the one I am doing now; one tap to change ---------- */
function RouteChoice() {
  const ids = myTrucks().filter((id) => truckRow(id)?.active);
  if (ids.length < 2) return null;
  const rows = ids.map((id) => truckRow(id)!);
  // « Voiture » / « Camion » when that tells them apart, else the vehicles' names
  const cars = rows.filter((r) => r.tire_machine === false).length;
  const byKind = cars === 1 && rows.length === 2;
  const value = myRoute.value && ids.includes(myRoute.value) ? myRoute.value : 'all';
  return (
    <div class="today-route" data-testid="today-route">
      <Seg<string> value={value} onValue={(v) => setMyRoute(v === 'all' ? null : v)} label={t('today.route.label')}
        options={[{ value: 'all', label: t('today.route.all') }, ...rows.map((r) => ({ value: r.id, label: byKind ? t(r.tire_machine === false ? 'today.route.car' : 'today.route.truck') : r.name }))]} />
    </div>
  );
}

/* ---------- the day ---------- */
export function MechanicDay() {
  void myRoute.value;
  const day = today();
  const list = myJobsOn(day).map(seen);
  const next = nextStopOf(list);
  const then = list.filter((j) => OPEN.includes(j.status) && j.id !== next?.id);
  const closed = list.filter((j) => !OPEN.includes(j.status));
  const [showClosed, setShowClosed] = useState(false);
  const sum = summaryOf(list);
  const ahead = nextWorkDay(day);
  return (
    <div class="today-grid">
      <div class="today-side"><ShiftCard calm={!!next && PRESSABLE.includes(stepOf(next).kind)} /></div>
      <div class="today-main">
        <RouteChoice />
        <NextStop list={list} />
        {then.length > 0 && (
          <section class="today-section" aria-labelledby="today-then">
            <h2 class="today-h" id="today-then">{t('today.then')}</h2>
            <div class="today-tickets">{then.map((j) => <JobTicket key={j.id} job={j} />)}</div>
          </section>
        )}
        {closed.length > 0 && (
          <section class="today-section">
            <Button variant="ghost" class="today-fold" icon={showClosed ? <ChevronUp /> : <ChevronDown />} onClick={() => setShowClosed(!showClosed)} data-testid="today-closed-toggle">
              {showClosed ? t('today.closed.hide') : t('today.closed.show', { n: closed.length })}
            </Button>
            {showClosed && <div class="today-tickets">{closed.map((j) => <JobTicket key={j.id} job={j} />)}</div>}
          </section>
        )}
      </div>
      {list.length > 0 && (
        <div class="today-side">
          <Panel title={t('today.summary.title')} help={t('today.summary.help')} data-testid="today-summary">
            <div class="today-stats">
              <div class="stat"><b>{sum.stops}</b><span>{t('today.summary.stops', { n: sum.stops })}</span></div>
              {/* big figures stay short in both languages: « 1 h 21 » */}
              <div class="stat"><b>{duration(sum.drive, 'fr')}</b><span>{t('today.summary.drive')}</span></div>
              <div class="stat"><b>{duration(sum.work, 'fr')}</b><span>{t('today.summary.work')}</span></div>
            </div>
          </Panel>
        </div>
      )}
      <div class="today-side">
        <Panel title={ahead && ahead.day !== addDays(day, 1) ? t('today.tomorrow.titleDay', { day: dayWord(ahead.day) }) : t('today.tomorrow.title')} data-testid="today-ahead">
          {ahead ? (
            <div class="stack">
              <p class="small muted today-ahead-sub"><MapPin aria-hidden="true" size={14} />{t('today.tomorrow.first')}</p>
              <JobTicket job={ahead.first} />
            </div>
          ) : <p class="muted" style={{ margin: 0 }}>{t('today.tomorrow.none')}</p>}
        </Panel>
      </div>
    </div>
  );
}
