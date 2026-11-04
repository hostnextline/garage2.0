/* « Ma journée »: the shift (start, end, time worked, the position shared with the office), the next stop with its red
   button (the same next step as on the job sheet), the other stops in order, the finished ones folded, the day in
   numbers, and the first stop of the next working day. */
import { useState } from 'preact/hooks';
import { Power, MapPin, LocateOff, ChevronDown, ChevronUp, CalendarDays, CircleCheckBig, Truck } from 'lucide-preact';
import { Panel, Button, Empty, Help, toast } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { today, addDays, duration } from '../../lib/dates';
import { me, myTrucks } from '../../data/auth';
import { openShift, positionOf } from '../../data/select';
import { shiftStart, shiftEnd, errorMessage } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import { may } from '../../app/routes';
import type { Job } from '../../data/types';
import { JobTicket } from '../jobs/JobTicket';
import { StepButton, PRESSABLE } from '../jobs/StepButton';
import { stepOf, jobRights, dayWord, clockOf, seen } from '../jobs/select';
import { sharing, retryPosition, agoText } from './position';
import { OPEN, myJobsOn, nextStopOf, summaryOf, nextWorkDay, shiftsOf, workedMinutes, useTick } from './select';

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

/* ---------- the next stop ---------- */
function NextStop(p: { list: Job[] }) {
  const next = nextStopOf(p.list);
  if (!myTrucks().length) {
    return <Panel data-tour="today-next"><Empty icon={<Truck />} title={t('today.next.noTruck')} text={t('today.next.noTruckText')} /></Panel>;
  }
  if (!next) {
    const none = !p.list.length;
    return (
      <Panel data-tour="today-next" data-testid="today-next">
        <Empty icon={none ? <CalendarDays /> : <CircleCheckBig />} title={none ? t('today.next.empty') : t('today.next.allDone')} text={none ? t('today.next.emptyText') : t('today.next.allDoneText')}
          action={none && may.agenda() ? <Button href={`#/agenda/${addDays(today(), 1)}`}>{t('today.next.seeAgenda')}</Button> : undefined} />
      </Panel>
    );
  }
  const step = stepOf(next);
  const now = next.status === 'on_site' || next.status === 'en_route';
  return (
    <section class={`panel glass today-next${now ? ' is-now' : ''}`} data-tour="today-next" data-testid="today-next">
      <div class="panel-head"><h2 class="panel-title">{now ? t('today.next.now') : t('today.next.title')}</h2></div>
      <div class="stack">
        <JobTicket job={next} />
        {PRESSABLE.includes(step.kind)
          ? <StepButton job={next} step={step} rights={jobRights(next)} />
          : <Button href={`#/job/${next.id}`} block>{t('today.next.open')}</Button>}
      </div>
    </section>
  );
}

/* ---------- the day ---------- */
export function MechanicDay() {
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
