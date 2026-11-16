/* The month's numbers: the hero (revenue against the goal, the pace, the month before), the eight numbers, revenue per
   truck, the services done most, six months side by side. The goal on screen is the synced setting (shownGoal). */
import { Target } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { money } from '../../lib/money';
import { getRow } from '../../data/store';
import { truckLabel, truckColor } from '../../data/select';
import { can } from '../../data/auth';
import type { Settings } from '../../data/types';
import { Panel, Button } from '../../ui';
import { noShowRate, perKm, goalShare, projection, versusLastMonth, truckShares, shownGoal, monthsAverage, closedMonth, type DashboardData } from './kpis';
import { BigMoney, Meter, HBars, MonthBars, Stat, StatGrid } from '../../shared/charts/charts';
import { pct, compactMoney, decimal } from '../../shared/charts/format';
import { monthWord, dollars } from './words';

export function Numbers(p: { d: DashboardData; month: string; now: string; l: string; sameYear: boolean; onGoal: () => void }) {
  const { d, l } = p;
  const goal = shownGoal(getRow<Settings>('settings', '1'), d.goal_cents);
  const share = goalShare(d.revenue_cents, goal);
  const pace = projection(d.revenue_cents, p.month, p.now);
  const vs = versusLastMonth(d, p.now);
  const rate = noShowRate(d);
  const ended = d.jobs_done + d.jobs_no_show + d.jobs_cancelled;
  const km = perKm(d.revenue_cents, d.km);
  const name = monthWord(p.month, l, 'long', !p.sameYear);
  const title = l !== 'en' && /^[aeiouyàâéèêîôû]/i.test(name) ? t('dashboard.revenueOfVowel', { month: name }) : t('dashboard.revenueOf', { month: name });
  const trucks = truckShares(d.by_truck);
  const avg6 = monthsAverage(d.months, p.now);
  const mayGoal = can('settings');
  // « À recevoir » opens the invoices only for whoever may open them (« Argent » alone landed on a closed screen)
  const toInvoices = can('invoices') ? '#/invoices' : undefined;
  const closed = closedMonth(p.month, p.now);

  return (
    <>
      <Panel class="dash-hero" data-testid="dash-hero">
        <div class="dash-hero-main">
          <p class="dash-kicker">{title} <span class="faint">{t('dashboard.beforeTax')}</span></p>
          <BigMoney cents={d.revenue_cents} lang={l} data-testid="dash-revenue" />
          <p class="muted small dash-hero-sub">{t('dashboard.invoicesCount', { n: d.invoices })}</p>
        </div>
        <div class="dash-hero-side">
          {goal ? (
            <div class="stack" style={{ gap: '8px' }}>
              <Meter value={share} label={t('dashboard.goal.meter')} data-testid="dash-goal" />
              <p class="dash-goal-text">
                <b>{share != null && share >= 1 ? t('dashboard.goal.reached', { goal: dollars(goal, l) }) : t('dashboard.goal.of', { pct: pct(share, l), goal: dollars(goal, l) })}</b>
                {share != null && share < 1 && <> {t('dashboard.goal.left', { amount: dollars(goal - d.revenue_cents, l) })}</>}
              </p>
            </div>
          ) : <p class="muted" style={{ margin: 0 }}>{t('dashboard.goal.none')}</p>}
          {pace != null && <p class="small muted" style={{ margin: 0 }}>{t('dashboard.pace', { amount: dollars(pace, l) })}</p>}
          {vs.prev != null && (
            <p class="small muted" style={{ margin: 0 }}>
              {t('dashboard.lastMonth', { amount: money(vs.prev, l) })}
              {vs.change != null && <> {Math.abs(vs.change) < 0.005 ? t('dashboard.same') : vs.change > 0 ? t('dashboard.up', { pct: pct(vs.change, l) }) : t('dashboard.down', { pct: pct(-vs.change, l) })}</>}
            </p>
          )}
          {mayGoal && <div><Button variant="ghost" icon={<Target />} onClick={p.onGoal} data-testid="goal-edit">{goal ? t('dashboard.goal.edit') : t('dashboard.goal.set')}</Button></div>}
        </div>
      </Panel>

      <Panel title={t('dashboard.kpis')} data-tour="dashboard-kpis" data-testid="dash-kpis">
        <div class="dash-stats-wrap">
          <StatGrid>
            <Stat label={t('dashboard.collected')} value={money(d.collected_cents, l)} sub={t('dashboard.collectedSub')} data-testid="kpi-collected" />
            <Stat label={t('dashboard.receivable')} value={money(d.receivable_cents, l)} help={t('dashboard.receivableHelp')} href={toInvoices} linkLabel={`${t('dashboard.receivableLink')} : ${money(d.receivable_cents, l)}`}
              tone={d.receivable_cents > 0 ? 'warn' : undefined} data-testid="kpi-receivable"
              sub={<>{t('dashboard.receivableSub', { n: d.receivable_count })}{d.drafts > 0 && <><br />{t('dashboard.drafts', { n: d.drafts })}</>}</>} />
            <Stat label={t('dashboard.avgTicket')} value={money(d.avg_ticket_cents, l)} sub={t('dashboard.avgTicketSub')} help={t('dashboard.avgTicketHelp')} data-testid="kpi-avg" />
            <Stat label={t('dashboard.jobsDone')} value={d.jobs_done} sub={closed ? undefined : t('dashboard.jobsToCome', { n: d.jobs_booked })} data-testid="kpi-jobs" />
            <Stat label={t('dashboard.noShow')} value={rate == null ? '—' : pct(rate, l)} help={t('dashboard.noShowHelp')} tone={rate != null && rate >= 0.1 ? 'warn' : undefined}
              sub={rate == null ? t('dashboard.noShowNone') : t('dashboard.noShowSub', { n: d.jobs_no_show, total: ended })} data-testid="kpi-noshow" />
            <Stat label={t('dashboard.cancelled')} value={d.jobs_cancelled} help={t('dashboard.lostHelp')} sub={t('dashboard.lost', { amount: money(d.lost_cents, l) })} data-testid="kpi-cancelled" />
            <Stat label={t('dashboard.km')} value={d.km > 0 ? <>{decimal(d.km, l, 0)}<span class="dash-unit"> {t('dashboard.kmUnit')}</span></> : '—'} sub={d.km > 0 ? t('dashboard.kmSub') : t('dashboard.noKm')} data-testid="kpi-km" />
            <Stat label={t('dashboard.perKm')} help={t('dashboard.perKmHelp')} data-testid="kpi-perkm"
              value={km.centsPerKm == null ? '—' : <>{money(Math.round(km.centsPerKm), l)}<span class="dash-unit"> {t('dashboard.perKmUnit')}</span></>}
              sub={km.kmPer100 == null ? t('dashboard.noKm') : t('dashboard.per100', { n: decimal(km.kmPer100, l, 1) })} />
          </StatGrid>
        </div>
      </Panel>

      <div class="dash-cols">
        <div class="stack-lg dash-col">
          <Panel title={t('dashboard.byTruck')} sub={t('dashboard.byTruckSub')} data-testid="dash-trucks">
            {trucks.length ? (
              <HBars label={t('dashboard.byTruck')} items={trucks.map((x) => ({
                key: x.truck_id || 'none',
                label: x.truck_id ? truckLabel(x.truck_id) || t('dashboard.noTruck') : t('dashboard.noTruck'),
                color: x.truck_id ? truckColor(x.truck_id) : null,
                value: x.revenue_cents,
                display: money(x.revenue_cents, l),
                sub: t('dashboard.truckSub', { n: x.invoices, share: pct(x.share, l), avg: dollars(x.avg, l) })
              }))} />
            ) : <p class="muted" style={{ margin: 0 }}>{t('dashboard.noRevenue')}</p>}
          </Panel>
          <Panel title={t('dashboard.top')} sub={t('dashboard.topSub')} data-testid="dash-top">
            {d.top_services.length
              ? <HBars label={t('dashboard.top')} items={d.top_services.map((s, i) => ({ key: `${i}-${s.name}`, label: s.name, value: s.n, display: t('dashboard.times', { n: s.n }) }))} />
              : <p class="muted" style={{ margin: 0 }}>{t('dashboard.noTop')}</p>}
          </Panel>
        </div>
        <Panel title={t('dashboard.months')} sub={t('dashboard.monthsSub')} class="dash-col" data-testid="dash-months">
          <MonthBars title={t('dashboard.months')} tableLabel={t('dashboard.table')} colMonth={t('dashboard.colMonth')} colValue={t('dashboard.colRevenue')}
            goal={goal ? { value: goal, label: t('dashboard.goal.line') } : null}
            items={d.months.map((m) => ({
              key: m.month, label: monthWord(m.month, l, 'short'), long: monthWord(m.month, l, 'long', true), value: m.revenue_cents,
              display: compactMoney(m.revenue_cents, l, 1), short: compactMoney(m.revenue_cents, l, 0), exact: money(m.revenue_cents, l), current: m.month === p.month
            }))} />
          <p class="small muted" style={{ margin: '4px 0 0' }}>{t('dashboard.monthsAvg', { amount: dollars(avg6, l) })}</p>
        </Panel>
      </div>
    </>
  );
}
