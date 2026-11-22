/* « Ma journée »: the jobs left open on a past day first, the shift (start, end, time worked, the position shared with the
   office), the next stop with its red button, the other stops in order, the finished ones folded, the day in numbers,
   and the first stop of the next working day. */
import { useState } from 'preact/hooks';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-preact';
import { Panel, Button } from '../../ui';
import { t } from '../../lib/i18n';
import { addDays, duration } from '../../lib/dates';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { PRESSABLE } from '../../shared/jobs/StepButton';
import { stepOf, dayWord, seen } from '../../shared/jobs/select';
import { myJobsOn, nextWorkDay } from './select';
import { OPEN, nextStopOf, summaryOf } from './rules';
import { useToday } from './hooks';
import { ShiftCard } from './ShiftCard';
import { NextStop } from './NextStop';
import { RouteChoice } from './RouteChoice';
import { OpenBefore } from './OpenBefore';

export function MechanicDay() {
  const day = useToday();
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
        <OpenBefore day={day} mineOnly />
        <RouteChoice />
        <NextStop day={day} list={list} />
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
