/* « Chiffres du garage » (#/dashboard, right « money »): the month's revenue against the goal, then the numbers
   Hassan asked for: collected, to collect, average ticket, jobs, no-shows, cancellations, km and money per km,
   revenue per truck, six months side by side, the services done most. The server computes them (dashboard). */
import { useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, CloudOff } from 'lucide-preact';
import { setQuery, type ScreenProps } from '../../platform/router';
import { t, lang } from '../../lib/i18n';
import { today, stamp } from '../../lib/dates';
import { rpcNow } from '../../data/api';
import { me } from '../../data/auth';
import { Page, Panel, Banner, Button, IconButton, Skeleton, Empty } from '../../ui';
import { addMonths, monthKey } from '../../domain/money/period';
import { normalizeDashboard, type DashboardData } from './kpis';
import { useReport } from '../../shared/charts/useReport';
import { Numbers } from './Numbers';
import { GoalSheet } from './GoalSheet';
import { monthWord } from './words';
import './dashboard.css';

export default function DashboardScreen({ query }: ScreenProps) {
  const l = lang.value;
  const now = today();
  const thisMonth = now.slice(0, 7);
  const asked = monthKey(query.get('month'));
  const month = asked && asked <= thisMonth ? asked : thisMonth;
  const first = `${month}-01`;
  const r = useReport<DashboardData>(`his.report.${me.value?.id || 'x'}.dashboard.${month}`,
    async () => normalizeDashboard(await rpcNow('dashboard', { p_month: first }), first), (raw) => normalizeDashboard(raw, first));
  const [goalOpen, setGoalOpen] = useState(false);
  const go = (m: string) => setQuery({ month: m === thisMonth ? null : m });
  const sameYear = month.slice(0, 4) === thisMonth.slice(0, 4);

  return (
    <Page title={t('dashboard.title')} help={t('dashboard.help')} wide data-testid="dashboard-screen">
      <div class="dash-monthbar" role="group" aria-label={t('dashboard.month.label')}>
        <IconButton icon={<ChevronLeft />} label={t('dashboard.month.prev')} onClick={() => go(addMonths(first, -1).slice(0, 7))} data-testid="month-prev" />
        <h2 class="dash-month" aria-live="polite" data-testid="month-name">{monthWord(first, l, 'long', true)}</h2>
        <IconButton icon={<ChevronRight />} label={t('dashboard.month.next')} disabled={month >= thisMonth} onClick={() => go(addMonths(first, 1).slice(0, 7))} data-testid="month-next" />
        <span class="grow" />
        {month !== thisMonth && <Button variant="ghost" onClick={() => go(thisMonth)}>{t('dashboard.month.current')}</Button>}
      </div>

      {r.offline && r.data && (
        <Banner kind="warn" title={t('dashboard.offlineCached', { when: stamp(r.at, l) })} data-testid="dash-offline"
          action={<Button size="sm" onClick={r.reload}>{t('dashboard.retry')}</Button>} />
      )}
      {r.error && (
        <Banner kind="bad" title={t('dashboard.error')} action={<Button size="sm" onClick={r.reload}>{t('dashboard.retry')}</Button>} data-testid="dash-error">
          <span>{r.error}</span>
        </Banner>
      )}

      {r.data ? <Numbers d={r.data} month={first} now={now} l={l} sameYear={sameYear} onGoal={() => setGoalOpen(true)} />
        : r.loading ? <Loading />
        : r.offline ? <div data-testid="dash-offline"><Empty icon={<CloudOff />} title={t('dashboard.offline')} text={t('dashboard.offlineNone')} action={<Button onClick={r.reload}>{t('dashboard.retry')}</Button>} /></div>
        : null}
      {r.data && r.fromCache && !r.offline && r.at && <p class="faint small" style={{ margin: 0 }}>{t('dashboard.updated', { when: stamp(r.at, l) })}</p>}
      <GoalSheet open={goalOpen} onClose={() => setGoalOpen(false)} />
    </Page>
  );
}

function Loading() {
  return (
    <div class="stack-lg" aria-busy="true" aria-label={t('common.loading')}>
      <Panel><Skeleton h={18} w="40%" /><div style={{ height: '14px' }} /><Skeleton h={44} w="60%" /><div style={{ height: '18px' }} /><Skeleton h={10} /></Panel>
      <Panel><Skeleton h={60} lines={3} /></Panel>
    </div>
  );
}
