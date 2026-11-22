/* The panels drawn from the server's treasury_report: the profit with revenue, expenses and taxes to remit; the TPS
   and TVQ table; expenses by category; money collected by payment method. */
import { t } from '../../lib/i18n';
import { money } from '../../lib/money';
import { stamp } from '../../lib/dates';
import type { Expense } from '../../data/types';
import { Panel, Button, Banner, Skeleton, Help } from '../../ui';
import { BigMoney, HBars } from '../../shared/charts/charts';
import type { ReportState } from '../../shared/charts/useReport';
import type { TreasuryReport } from './report';
import { byCategory, methodLabel } from './select';

export function ReportPanel(p: { r: ReportState<TreasuryReport> & { reload: () => void }; l: string }) {
  const { r, l } = p;
  const d = r.data;
  const remit = d ? d.tps_to_remit + d.tvq_to_remit : 0;
  return (
    <Panel class="tre-report tre-o1" data-tour="treasury-report" data-testid="treasury-report">
      {r.offline && (
        <Banner kind="warn" title={d ? t('treasury.offlineCached', { when: stamp(r.at, l) }) : t('treasury.offline')} data-testid="treasury-offline"
          action={<Button size="sm" onClick={r.reload}>{t('treasury.retry')}</Button>}>
          <span>{t('treasury.offlineList')}</span>
        </Banner>
      )}
      {r.error && <Banner kind="bad" title={t('treasury.error')} action={<Button size="sm" onClick={r.reload}>{t('treasury.retry')}</Button>}><span>{r.error}</span></Banner>}
      {d ? (
        <div class="tre-report-body">
          <div class="stack" style={{ gap: '8px' }}>
            <p class="dash-kicker">{t('treasury.report.profit')} <Help text={t('treasury.report.profitHelp')} /></p>
            <BigMoney cents={d.profit} lang={l} class={d.profit < 0 ? 'tre-negative' : ''} data-testid="treasury-profit" />
            <p class="muted small" style={{ margin: 0 }}>{t('treasury.report.profitSub')}</p>
          </div>
          <dl class="tre-lines">
            <div><dt>{t('treasury.report.revenue')} <span class="faint">{t('treasury.report.invoices', { n: d.revenue.count })}</span></dt><dd class="money">{money(d.revenue.subtotal, l)}</dd></div>
            <div><dt>{t('treasury.report.expenses')} <span class="faint">{t('treasury.report.expensesCount', { n: d.expenses.count })}</span></dt><dd class="money">{d.expenses.subtotal ? '−' : ''}{money(d.expenses.subtotal, l)}</dd></div>
            <div class="tre-lines-remit"><dt>{remit < 0 ? t('treasury.report.refund') : t('treasury.report.remit')} <span class="faint">{t('treasury.report.remitSub')}</span></dt><dd class="money" data-testid="treasury-remit">{money(Math.abs(remit), l)}</dd></div>
          </dl>
        </div>
      ) : r.loading ? (
        <div aria-busy="true" aria-label={t('treasury.report.loading')}><Skeleton h={16} w="35%" /><div style={{ height: '12px' }} /><Skeleton h={44} w="55%" /><div style={{ height: '16px' }} /><Skeleton h={18} lines={3} /></div>
      ) : null}
    </Panel>
  );
}

export function TaxesPanel(p: { d: TreasuryReport; l: string }) {
  const { d, l } = p;
  const rows = [
    { k: 'tps', label: t('treasury.taxes.tps'), c: d.revenue.tps, pd: d.expenses.tps, r: d.tps_to_remit },
    { k: 'tvq', label: t('treasury.taxes.tvq'), c: d.revenue.tvq, pd: d.expenses.tvq, r: d.tvq_to_remit }
  ];
  const neg = d.tps_to_remit < 0 || d.tvq_to_remit < 0;
  return (
    <Panel title={t('treasury.taxes.title')} help={t('treasury.taxes.help')} class="tre-o3" data-testid="treasury-taxes">
      <div class="tre-table-wrap">
        <table class="dash-tbl tre-taxes">
          <thead><tr><th scope="col">{t('treasury.taxes.tax')}</th><th scope="col" class="right">{t('treasury.taxes.collected')}</th><th scope="col" class="right">{t('treasury.taxes.paid')}</th><th scope="col" class="right">{t('treasury.taxes.remit')}</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.k}><th scope="row">{x.label}</th><td class="right num">{money(x.c, l)}</td><td class="right num">{money(x.pd, l)}</td><td class={`right num${x.r < 0 ? ' tre-negative' : ''}`}>{money(x.r, l)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">{t('treasury.taxes.both')}</th><td class="right num">{money(d.revenue.tps + d.revenue.tvq, l)}</td><td class="right num">{money(d.expenses.tps + d.expenses.tvq, l)}</td><td class="right num">{money(d.tps_to_remit + d.tvq_to_remit, l)}</td></tr></tfoot>
        </table>
      </div>
      {neg && <p class="small muted" style={{ margin: '8px 0 0' }}>{t('treasury.taxes.negative')}</p>}
    </Panel>
  );
}

/** the server's numbers; with no report at all (no signal, first visit), the same from the phone's copy */
export function CategoriesPanel(p: { d: TreasuryReport | null; rows: Expense[]; l: string }) {
  const { l } = p;
  const items = p.d ? p.d.by_category : byCategory(p.rows);
  return (
    <Panel title={t('treasury.categories.title')} sub={t('treasury.categories.sub')} class="tre-o4" data-testid="treasury-categories">
      {items.length
        ? <HBars label={t('treasury.categories.title')} items={items.map((c) => ({ key: c.category, label: c.category || '—', value: c.subtotal, display: money(c.subtotal, l), sub: t('treasury.categories.count', { n: c.n }) }))} />
        : <p class="muted" style={{ margin: 0 }}>{t('treasury.categories.none')}</p>}
    </Panel>
  );
}

export function CollectedPanel(p: { d: TreasuryReport; l: string }) {
  const { d, l } = p;
  const total = d.collected.reduce((n, c) => n + c.total, 0);
  return (
    <Panel title={t('treasury.collected.title')} sub={t('treasury.collected.sub')} class="tre-o5" data-testid="treasury-collected">
      {d.collected.length ? (
        <>
          <HBars label={t('treasury.collected.title')} items={d.collected.map((c) => ({ key: c.method, label: methodLabel(c.method), value: c.total, display: money(c.total, l), sub: t('treasury.collected.count', { n: c.n }) }))} />
          <p class="tre-total-line"><span>{t('treasury.collected.total')}</span><span class="money">{money(total, l)}</span></p>
        </>
      ) : <p class="muted" style={{ margin: 0 }}>{t('treasury.collected.none')}</p>}
    </Panel>
  );
}
