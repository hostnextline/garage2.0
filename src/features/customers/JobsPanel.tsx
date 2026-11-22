/* « Rendez-vous »: the coming ones, then the past ones (the last 5, « Voir les N autres »). */
import { useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { jobsOfCustomer } from '../../data/select';
import type { Customer } from '../../data/types';
import { Panel, Button } from '../../ui';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { isUpcoming, jobOrder } from '../../shared/customers/facts';
import { currentDay } from '../../domain/oil/clock';

export function JobsPanel(p: { c: Customer }) {
  const [all, setAll] = useState(false);
  const jobs = jobsOfCustomer(p.c.id);
  const now = currentDay.value;
  const upcoming = jobs.filter((j) => isUpcoming(j, now)).sort(jobOrder);
  const past = jobs.filter((j) => !isUpcoming(j, now)).sort((a, b) => jobOrder(b, a));
  const shown = all ? past : past.slice(0, 5);
  return (
    <Panel title={t('customers.jobs.title')} sub={jobs.length ? t('customers.jobs.count', { n: jobs.length }) : undefined} data-testid="jobs-panel">
      {!jobs.length && <p class="muted" style={{ margin: 0 }}>{t('customers.jobs.none')}</p>}
      {upcoming.length > 0 && (
        <section class="customers-jobs">
          <h3 class="divider-title">{t('customers.jobs.upcoming')}</h3>
          <div class="stack">{upcoming.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section class="customers-jobs">
          <h3 class="divider-title">{t('customers.jobs.past')}</h3>
          <div class="stack">{shown.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div>
          {past.length > shown.length && <Button variant="ghost" onClick={() => setAll(true)} class="customers-showall">{t('customers.jobs.showAll', { n: past.length - shown.length })}</Button>}
        </section>
      )}
    </Panel>
  );
}
