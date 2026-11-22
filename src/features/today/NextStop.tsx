/* « Ma journée »: the stop to look at now, with its red button (the same next step as on the job sheet). Once the day's
   stops are done, the way back; with no stop at all, the agenda of tomorrow. */
import { CalendarDays, Truck } from 'lucide-preact';
import { Panel, Button, Empty, Banner } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { addDays, clock } from '../../lib/dates';
import { myTrucks } from '../../data/auth';
import { may } from '../../domain/rights';
import type { Job } from '../../data/types';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { CarFirst } from '../../shared/jobs/CarFirst';
import { StepButton, PRESSABLE } from '../../shared/jobs/StepButton';
import { stepOf, outsideWindow, blockRange } from '../../shared/jobs/select';
import { jobRights } from '../../domain/jobs/rights';
import { nextStopOf } from './rules';
import { ReturnCard } from './ReturnCard';

export function NextStop(p: { day: string; list: Job[] }) {
  const next = nextStopOf(p.list);
  if (!myTrucks().length) {
    return <Panel data-tour="today-next"><Empty icon={<Truck />} title={t('today.next.noTruck')} text={t('today.next.noTruckText')} /></Panel>;
  }
  if (!next) {
    // the day's stops are done: the next destination is the start. Every stop cancelled or a no-show: nothing was
    // done, there is no way back to offer.
    if (p.list.some((j) => j.status === 'done')) return <ReturnCard day={p.day} list={p.list} />;
    return (
      <Panel data-tour="today-next" data-testid="today-next">
        <Empty icon={<CalendarDays />} title={p.list.length ? t('today.next.allDone') : t('today.next.empty')} text={p.list.length ? t('today.next.noneLeft') : t('today.next.emptyText')}
          action={may.agenda() ? <Button href={`#/agenda/${addDays(p.day, 1)}`}>{t('today.next.seeAgenda')}</Button> : undefined} />
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
        {/* « Plages d'arrivée »: the planned arrival is outside the window told to this customer */}
        {outsideWindow(next) && <Banner kind="warn" data-testid="today-next-late">{t('jobs.win.lateText', { time: clock(next.eta_min!, lang.value), window: blockRange(next) })}</Banner>}
        {PRESSABLE.includes(step.kind)
          ? <StepButton job={next} step={step} rights={jobRights(next)} />
          : <Button href={`#/job/${next.id}`} block>{t('today.next.open')}</Button>}
      </div>
    </section>
  );
}
