/* « Chiffres du garage » (#/dashboard, right « money »): the month's revenue against the goal, then the numbers
   Hassan asked for: collected, to collect, average ticket, jobs, no-shows, cancellations, km and money per km,
   revenue per truck, six months side by side, the services done most. The server computes them (dashboard). */
import { useEffect, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Target, CloudOff } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { setQuery } from '../../app/router';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { today, stamp, parseDay } from '../../lib/dates';
import { rpcNow, saveSettings } from '../../data/api';
import { settings, truckLabel, truckColor } from '../../data/select';
import { can, me } from '../../data/auth';
import { Page, Panel, Banner, Button, IconButton, Skeleton, Sheet, Field, MoneyInput, Form, Empty, attempt } from '../../ui';
import { addMonths, monthKey } from '../treasury/period';
import { normalizeDashboard, noShowRate, perKm, goalShare, projection, versusLastMonth, truckShares, type DashboardData } from './kpis';
import { BigMoney, Meter, HBars, MonthBars, Stat, StatGrid, pct, compactMoney, decimal } from './charts';
import { useReport } from './useReport';
import './dashboard.css';

const mf = new Map<string, Intl.DateTimeFormat>();
/** an estimate or a goal reads in whole dollars */
const dollars = (c: number, l: string) => money(Math.round(c / 100) * 100, l, { whole: true });
function monthWord(first: string, l: string, style: 'long' | 'short', withYear = false): string {
  const k = `${l}${style}${withYear}`;
  let f = mf.get(k);
  if (!f) { f = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', withYear ? { month: style, year: 'numeric' } : { month: style }); mf.set(k, f); }
  return f.format(parseDay(first));
}

export default function DashboardScreen({ query }: ScreenProps) {
  const l = lang.value;
  const now = today();
  const thisMonth = now.slice(0, 7);
  const asked = monthKey(query.get('month'));
  const month = asked && asked <= thisMonth ? asked : thisMonth;
  const first = `${month}-01`;
  const r = useReport<DashboardData>(`his.report.${me.value?.id || 'x'}.dashboard.${month}`,
    async () => normalizeDashboard(await rpcNow('dashboard', { p_month: first }), first));
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

function Numbers(p: { d: DashboardData; month: string; now: string; l: string; sameYear: boolean; onGoal: () => void }) {
  const { d, l } = p;
  const goal = settings.value.billing.goal_cents ?? d.goal_cents ?? null;
  const share = goalShare(d.revenue_cents, goal);
  const pace = projection(d.revenue_cents, p.month, p.now);
  const vs = versusLastMonth(d, p.now);
  const rate = noShowRate(d);
  const ended = d.jobs_done + d.jobs_no_show + d.jobs_cancelled;
  const km = perKm(d.revenue_cents, d.km);
  const name = monthWord(p.month, l, 'long', !p.sameYear);
  const title = l !== 'en' && /^[aeiouyàâéèêîôû]/i.test(name) ? t('dashboard.revenueOfVowel', { month: name }) : t('dashboard.revenueOf', { month: name });
  const trucks = truckShares(d.by_truck);
  const avg6 = Math.round(d.months.reduce((n, m) => n + m.revenue_cents, 0) / Math.max(1, d.months.length));
  const mayGoal = can('settings');

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
            <Stat label={t('dashboard.receivable')} value={money(d.receivable_cents, l)} help={t('dashboard.receivableHelp')} href="#/invoices" linkLabel={`${t('dashboard.receivableLink')} : ${money(d.receivable_cents, l)}`}
              tone={d.receivable_cents > 0 ? 'warn' : undefined} data-testid="kpi-receivable"
              sub={<>{t('dashboard.receivableSub', { n: d.receivable_count })}{d.drafts > 0 && <><br />{t('dashboard.drafts', { n: d.drafts })}</>}</>} />
            <Stat label={t('dashboard.avgTicket')} value={money(d.avg_ticket_cents, l)} sub={t('dashboard.avgTicketSub')} help={t('dashboard.avgTicketHelp')} data-testid="kpi-avg" />
            <Stat label={t('dashboard.jobsDone')} value={d.jobs_done} sub={t('dashboard.jobsToCome', { n: d.jobs_booked })} data-testid="kpi-jobs" />
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

function GoalSheet(p: { open: boolean; onClose: () => void }) {
  const cur = settings.value.billing.goal_cents ?? null;
  const [cents, setCents] = useState<number | null>(cur);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (p.open) { setCents(cur); setErr(null); } }, [p.open]);
  const save = async (value: number | null) => {
    if (value != null && value <= 0) { setErr(t('dashboard.goal.invalid')); return; }
    const ok = await attempt(() => saveSettings('billing', { ...settings.value.billing, goal_cents: value }), { ok: value == null ? t('dashboard.goal.removed') : t('dashboard.goal.saved') });
    if (ok) p.onClose();
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('dashboard.goal.title')} data-testid="goal-sheet"
      footer={<>
        {cur != null && <Button variant="ghost" onClick={() => save(null)}>{t('dashboard.goal.remove')}</Button>}
        <Button variant="primary" type="submit" form="goal-form" data-testid="goal-save">{t('dashboard.goal.save')}</Button>
      </>}>
      <Form id="goal-form" onSubmit={() => save(cents)}>
        <Field label={t('dashboard.goal.field')} hint={t('dashboard.goal.hint')} error={err}>
          <MoneyInput cents={cents} onCents={(c) => { setCents(c); setErr(null); }} autoFocus aria-label={t('dashboard.goal.field')} />
        </Field>
      </Form>
    </Sheet>
  );
}
