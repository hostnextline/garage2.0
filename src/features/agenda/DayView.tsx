/* One day: the day in words, the week strip, then its places (the three blocks, or with « Plages d'arrivée » the whole
   day, then the blocks that still hold jobs), and the cancelled / no-show jobs apart. Nobody works that day and no job:
   « Personne ne travaille ce jour-là ». */
import { CalendarSearch } from 'lucide-preact';
import { t } from '../../lib/i18n';
import type { Day } from '../../lib/dates';
import { may } from '../../domain/rights';
import { Panel, Button, Empty } from '../../ui';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { dayJobs, isOff, type DayPlan } from './select';
import { DayHead, WeekStrip } from './DayHead';
import { BlockPanel } from './BlockPanel';

export function DayView(p: { day: Day; plan: DayPlan; onDay: (d: Day) => void }) {
  const { plan } = p;
  const all = dayJobs(p.day);
  const off = all.filter(isOff);
  const active = all.length - off.length;
  const nobody = active === 0 && plan.views.every((v) => v.closed);
  return (
    <div class="agenda-day" data-testid="agenda-day">
      <DayHead day={p.day} onDay={p.onDay} />
      <WeekStrip day={p.day} onDay={p.onDay} />
      {nobody ? (
        <Panel>
          <Empty icon={<CalendarSearch />} title={t('agenda.day.nobody')} text={t('agenda.day.nobodyText')}
            action={may.hours() ? <Button href="#/hours" variant="secondary">{t('agenda.day.hours')}</Button> : undefined} />
        </Panel>
      ) : (
        <div class={`agenda-blocks${plan.window ? ' is-day' : ''}`}>
          {plan.views.map((v, i) => <BlockPanel key={v.key} day={p.day} v={v} first={i === 0} />)}
        </div>
      )}
      {off.length > 0 && (
        <details class="agenda-off glass panel" data-testid="agenda-off">
          <summary><span class="panel-title">{t('agenda.off', { n: off.length })}</span></summary>
          <div class="agenda-tickets agenda-off-list">{off.map((j) => <JobTicket key={j.id} job={j} />)}</div>
        </details>
      )}
    </div>
  );
}
