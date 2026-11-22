/* What takes the red button's place when there is nothing to press: done (time, « paiera plus tard », what is left to
   collect, the truck's next job for its mechanic), closed (stamp, reason, « Rouvrir »), later (the day), or « C'est X qui
   fait cette job ». */
import { CalendarClock, RotateCcw, CircleCheckBig } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Button, Stamp } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { invoiceOf, jobsOn } from '../../data/select';
import type { NextStep } from '../../domain/jobs/steps';
import { isOpen } from '../../domain/jobs/billing';
import type { JobRights } from '../../domain/jobs/rights';
import { dayInSentence, blockRange, clockOf, driverName, capFirst } from '../../shared/jobs/select';
import { doReopen } from '../../shared/jobs/actions';
import { JobTicket } from '../../shared/jobs/JobTicket';

export function StepState(p: { job: Job; step: NextStep; rights: JobRights; onCollect: () => void }) {
  const { job: j, step: s } = p;
  if (s.kind === 'done') {
    const inv = invoiceOf(j.id);
    const next = p.rights.mine ? jobsOn(j.day).find((o) => o.id !== j.id && o.truck_id === j.truck_id && isOpen(o.status)) : undefined;
    return (
      <div class="stack">
        {/* the PAYÉ stamp is on the invoice (one stamp per screen): here, the words */}
        <section class={`panel glass jobs-state${s.paid ? ' is-paid' : ''}`} data-testid="job-done">
          <CircleCheckBig class="jobs-state-icon" aria-hidden="true" />
          <div class="grow">
            <h2 class="jobs-state-title">{t('jobs.done.title')}</h2>
            {j.finished_at && <p class="muted" style={{ margin: 0 }}>{t('jobs.done.at', { time: clockOf(j.finished_at) })}</p>}
            {j.pay_later && !s.paid && <p class="small" style={{ margin: '6px 0 0' }}>{j.pay_later_reason ? t('jobs.done.laterReason', { reason: j.pay_later_reason }) : t('jobs.done.later')}</p>}
            {!!s.due && <p class="jobs-due">{t('jobs.done.due', { amount: money(s.due, lang.value) })}</p>}
          </div>
          {!!s.due && p.rights.invoice && inv?.status === 'issued' && <Button onClick={p.onCollect} data-testid="job-collect">{t('jobs.done.collect')}</Button>}
        </section>
        {next && <div class="stack jobs-next"><h3 class="jobs-h">{t('jobs.done.next')}</h3><JobTicket job={next} /></div>}
      </div>
    );
  }
  if (s.kind === 'closed') {
    return (
      <section class="panel glass jobs-state" data-testid="job-closed">
        <Stamp kind={j.status === 'no_show' ? 'no_show' : 'cancelled'} class="jobs-stamp" />
        <div class="grow">
          <h2 class="jobs-state-title">{j.status === 'no_show' ? t('jobs.done.no_show') : t('jobs.done.cancelled')}</h2>
          {j.lost_reason && <p class="muted" style={{ margin: 0 }}>{t('jobs.done.reason', { reason: j.lost_reason })}</p>}
        </div>
        {p.rights.reopen && <Button icon={<RotateCcw />} onClick={() => doReopen(j)} data-testid="job-reopen">{t('jobs.done.reopen')}</Button>}
      </section>
    );
  }
  if (s.kind === 'later') {
    return (
      <section class="panel glass jobs-state" data-testid="job-later">
        <CalendarClock class="jobs-state-icon" aria-hidden="true" />
        <div class="grow">
          <h2 class="jobs-state-title">{t('jobs.step.later', { when: dayInSentence(j.day) })}</h2>
          <p class="muted" style={{ margin: 0 }}>{capFirst(blockRange(j))}. {t('jobs.step.laterSub')}</p>
        </div>
      </section>
    );
  }
  if (s.kind === 'none' && isOpen(j.status)) {
    const d = driverName(j);
    return <p class="muted jobs-none">{d ? t('jobs.step.none', { name: d }) : t('jobs.step.noneNoDriver')}</p>;
  }
  return null;
}
