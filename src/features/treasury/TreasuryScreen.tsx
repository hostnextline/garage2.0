/* « Trésorerie » (#/treasury, right « treasury »): for a period, the profit (the key number), the TPS/TVQ to remit,
   expenses by category, money collected by payment method (the server's treasury_report), the period's expenses
   (the device's copy: still there with no signal), « Ajouter une dépense » (also #/treasury?add=1) and the files for
   the accountant (Excel with the sheets Revenus, Dépenses, Taxes; CSV). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Plus, Paperclip, FileSpreadsheet, FileText, Share2 } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { setQuery } from '../../app/router';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { today, stamp, parseDay } from '../../lib/dates';
import { rpcNow } from '../../data/api';
import { settings, garageName } from '../../data/select';
import { can, me } from '../../data/auth';
import type { Expense } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, Banner, Empty, Chips, Field, DateInput, SearchInput, Select, Skeleton, Help, toast } from '../../ui';
import { BigMoney, HBars } from '../dashboard/charts';
import { useReport } from '../dashboard/useReport';
import { PERIODS, isPeriod, periodRange, rangeLabel, type PeriodKey, type DayRange } from './period';
import { normalizeReport, type TreasuryReport } from './report';
import { periodExpenses, filterCategories, matches, methodLabel, revenueLines, expenseLines } from './data';
import { buildWorkbook, buildCsv, type ExportLabels } from './exports';
import { XLSX_MIME } from './xlsx';
import { ExpenseSheet } from './ExpenseSheet';
import '../dashboard/charts.css';
import './treasury.css';

export default function TreasuryScreen({ query }: ScreenProps) {
  const l = lang.value;
  const now = today();
  const p = query.get('p');
  const key: PeriodKey = isPeriod(p) ? p : 'month';
  const range = periodRange(key, now, { from: query.get('from') || undefined, to: query.get('to') || undefined });
  const report = useReport<TreasuryReport>(`his.report.${me.value?.id || 'x'}.treasury.${range.from}.${range.to}`,
    async () => normalizeReport(await rpcNow('treasury_report', { p_from: range.from, p_to: range.to }), range.from, range.to));
  const [sheet, setSheet] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });

  // « + », « Dépense ou reçu » and the guide open #/treasury?add=1: clean the address first, then open the sheet
  // (the sheet's own history step must not keep ?add=1, or « Retour » would open it again)
  const add = query.get('add');
  useEffect(() => {
    if (add !== '1') return;
    setQuery({ add: null });
    const tm = setTimeout(() => setSheet({ open: true, expense: null }), 0);
    return () => clearTimeout(tm);
  }, [add]);

  const choose = (k: PeriodKey) => setQuery({ p: k === 'month' ? null : k, from: k === 'custom' ? range.from : null, to: k === 'custom' ? range.to : null });

  return (
    <Page title={t('treasury.title')} sub={rangeLabel(range, l)} help={t('treasury.help')} wide data-testid="treasury-screen"
      actions={<Button variant="primary" icon={<Plus size={20} />} onClick={() => setSheet({ open: true, expense: null })} data-tour="treasury-add" data-testid="treasury-add">{t('treasury.add')}</Button>}>
      <div class="tre-period">
        <Chips label={t('treasury.period.label')} value={[key]} data-testid="treasury-period"
          options={PERIODS.map((k) => ({ value: k, label: t(`treasury.period.${k}`) }))}
          onValue={(v) => { if (v[0]) choose(v[0]); }} />
        {key === 'custom' && (
          <div class="tre-dates">
            <Field label={t('treasury.period.from')}><DateInput value={range.from} max={range.to} onValue={(v) => v && setQuery({ from: v })} /></Field>
            <Field label={t('treasury.period.to')}><DateInput value={range.to} min={range.from} onValue={(v) => v && setQuery({ to: v })} /></Field>
          </div>
        )}
      </div>

      <div class="tre-grid">
        <div class="tre-col-a">
          <ReportPanel r={report} l={l} />
          {report.data && <TaxesPanel d={report.data} l={l} />}
          <CategoriesPanel d={report.data} range={range} l={l} />
          {report.data && <CollectedPanel d={report.data} l={l} />}
        </div>
        <div class="tre-col-b">
          <ExpensesPanel range={range} l={l} offline={report.offline} onOpen={(e) => setSheet({ open: true, expense: e })} />
          <ExportPanel range={range} report={report.data} l={l} />
        </div>
      </div>
      <ExpenseSheet open={sheet.open} expense={sheet.expense} onClose={() => setSheet({ open: false, expense: null })} />
    </Page>
  );
}

function ReportPanel(p: { r: ReturnType<typeof useReport<TreasuryReport>>; l: string }) {
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
            <div><dt>{t('treasury.report.expenses')} <span class="faint">{t('treasury.report.expensesCount', { n: d.expenses.count })}</span></dt><dd class="money">−{money(d.expenses.subtotal, l)}</dd></div>
            <div class="tre-lines-remit"><dt>{remit < 0 ? t('treasury.report.refund') : t('treasury.report.remit')} <span class="faint">{t('treasury.report.remitSub')}</span></dt><dd class="money" data-testid="treasury-remit">{money(Math.abs(remit), l)}</dd></div>
          </dl>
        </div>
      ) : r.loading ? (
        <div aria-busy="true" aria-label={t('treasury.report.loading')}><Skeleton h={16} w="35%" /><div style={{ height: '12px' }} /><Skeleton h={44} w="55%" /><div style={{ height: '16px' }} /><Skeleton h={18} lines={3} /></div>
      ) : null}
    </Panel>
  );
}

function TaxesPanel(p: { d: TreasuryReport; l: string }) {
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

function CategoriesPanel(p: { d: TreasuryReport | null; range: DayRange; l: string }) {
  const { l } = p;
  // the server's numbers; with no signal, the same from the phone's copy
  const local = () => {
    const m = new Map<string, { subtotal: number; n: number }>();
    for (const e of periodExpenses(p.range)) { const c = m.get(e.category) || { subtotal: 0, n: 0 }; c.subtotal += e.subtotal_cents; c.n++; m.set(e.category, c); }
    return [...m.entries()].map(([category, v]) => ({ category, subtotal: v.subtotal, n: v.n })).sort((a, b) => b.subtotal - a.subtotal);
  };
  const items = p.d ? p.d.by_category : local();
  return (
    <Panel title={t('treasury.categories.title')} sub={t('treasury.categories.sub')} class="tre-o4" data-testid="treasury-categories">
      {items.length
        ? <HBars label={t('treasury.categories.title')} items={items.map((c) => ({ key: c.category, label: c.category || '—', value: c.subtotal, display: money(c.subtotal, l), sub: t('treasury.categories.count', { n: c.n }) }))} />
        : <p class="muted" style={{ margin: 0 }}>{t('treasury.categories.none')}</p>}
    </Panel>
  );
}

function CollectedPanel(p: { d: TreasuryReport; l: string }) {
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

const dayFmt = new Map<string, Intl.DateTimeFormat>();
function DateStub(p: { day: string; l: string }) {
  const k = p.l;
  let f = dayFmt.get(k);
  if (!f) { f = new Intl.DateTimeFormat(p.l === 'en' ? 'en-CA' : 'fr-CA', { month: 'short' }); dayFmt.set(k, f); }
  const d = parseDay(p.day);
  return <span class="tre-date" aria-hidden="true"><b>{d.getDate()}</b><span>{f.format(d)}</span></span>;
}

function ExpensesPanel(p: { range: DayRange; l: string; offline: boolean; onOpen: (e: Expense) => void }) {
  const { l } = p;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const all = periodExpenses(p.range).slice().sort((a, b) => b.day.localeCompare(a.day) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const cats = filterCategories(all);
  const rows = all.filter((e) => (!cat || e.category === cat) && matches(e, q));
  const sum = rows.reduce((n, e) => n + e.total_cents, 0);
  const filtered = !!q.trim() || !!cat;
  return (
    <Panel flush title={t('treasury.list.title')} sub={t('treasury.list.summary', { n: rows.length, amount: money(sum, l) })} class="tre-o2" data-testid="treasury-expenses">
      {all.length > 0 && (
        <div class="tre-filters">
          <SearchInput value={q} onValue={setQ} placeholder={t('treasury.list.search')} />
          <Select value={cat} aria-label={t('treasury.list.category')} onValue={setCat}
            options={[{ value: '', label: t('treasury.list.allCategories') }, ...cats.map((c) => ({ value: c, label: c }))]} />
        </div>
      )}
      {rows.length ? (
        <Rows data-testid="expense-rows">
          {rows.map((e) => (
            <RowItem key={e.id} onClick={() => p.onOpen(e)} data-testid="expense-row"
              start={<DateStub day={e.day} l={l} />}
              title={e.vendor || <span class="muted">{t('treasury.list.noVendor')}</span>}
              sub={e.category}
              end={<>
                <span class="money">{money(e.total_cents, l)}</span>
                {e.receipt_id ? <span class="tre-clip" role="img" aria-label={t('treasury.list.receipt')} title={t('treasury.list.receipt')}><Paperclip size={16} /></span> : <span class="tre-clip" aria-hidden="true" />}
              </>} chevron />
          ))}
        </Rows>
      ) : filtered ? (
        <Empty title={t('treasury.list.noMatch')} text={t('treasury.list.noMatchText')} action={<Button onClick={() => { setQ(''); setCat(''); }}>{t('treasury.list.clear')}</Button>} />
      ) : (
        <Empty title={t('treasury.list.empty')} text={t('treasury.list.emptyText')} />
      )}
    </Panel>
  );
}

function exportLabels(): ExportLabels {
  const c = (k: string) => t(`treasury.export.cols.${k}`);
  const x = (k: string) => t(`treasury.export.taxSheet.${k}`);
  return {
    sheets: { revenue: t('treasury.export.sheets.revenue'), expenses: t('treasury.export.sheets.expenses'), taxes: t('treasury.export.sheets.taxes') },
    revenue: { day: c('day'), number: c('number'), customer: c('customer'), subtotal: c('subtotal'), tps: c('tps'), tvq: c('tvq'), total: c('total'), paid: c('paid'), status: c('status') },
    expenses: { day: c('day'), vendor: c('vendor'), category: c('category'), description: c('description'), subtotal: c('subtotal'), tps: c('tps'), tvq: c('tvq'), total: c('total'), method: c('method'), truck: c('truck'), receipt: c('receipt') },
    taxes: {
      title: x('title'), period: x('period'), from: t('treasury.period.from'), to: t('treasury.period.to'), company: x('company'), tpsNo: x('tpsNo'), tvqNo: x('tvqNo'),
      tax: t('treasury.taxes.tax'), collected: t('treasury.taxes.collected'), paid: t('treasury.taxes.paid'), remit: t('treasury.taxes.remit'),
      tps: t('treasury.taxes.tps'), tvq: t('treasury.taxes.tvq'), both: t('treasury.taxes.both'), revenue: x('revenue'), expenses: x('expenses'), profit: x('profit'), note: x('note')
    },
    totalRow: t('treasury.export.totalRow'), yes: t('treasury.export.yes'), no: t('treasury.export.no'),
    csv: { day: c('day'), type: c('type'), number: c('number'), name: c('name'), category: c('category'), description: c('description'), subtotal: c('subtotal'), tps: c('tps'), tvq: c('tvq'), total: c('total'), method: c('method'), revenue: t('treasury.export.revenueType'), expense: t('treasury.export.expenseType') }
  };
}
function save(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function canShareFiles(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof File === 'function'
      && navigator.canShare({ files: [new File([''], 'x.xlsx', { type: XLSX_MIME })] });
  } catch { return false; }
}

function ExportPanel(p: { range: DayRange; report: TreasuryReport | null; l: string }) {
  const { range, l } = p;
  const seesInvoices = can('invoices');
  const rev = seesInvoices ? revenueLines(range) : [];
  const exp = expenseLines(range);
  const mismatch = !!p.report && ((seesInvoices && p.report.revenue.count !== rev.length) || p.report.expenses.count !== exp.length);
  const share = useMemo(canShareFiles, []);
  const company = settings.value.company || {};
  const input = () => ({ from: range.from, to: range.to, revenue: rev, expenses: exp, company: { name: company.legal_name || company.name || garageName.value, tps_no: company.tps_no, tvq_no: company.tvq_no }, labels: exportLabels() });
  const base = t('treasury.export.file', { from: range.from, to: range.to });
  const done = (name: string) => toast(t('treasury.export.ready', { name }), { kind: 'ok' });
  const xlsx = () => { const name = `${base}.xlsx`; save(buildWorkbook(input()), name, XLSX_MIME); done(name); };
  const csv = () => { const name = `${base}.csv`; save(buildCsv(input(), l), name, 'text/csv;charset=utf-8'); done(name); };
  const send = async () => {
    const name = `${base}.xlsx`;
    try {
      await navigator.share({ files: [new File([new Uint8Array(buildWorkbook(input()))], name, { type: XLSX_MIME })], title: name });
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') xlsx();
    }
  };
  return (
    <Panel title={t('treasury.export.title')} sub={t('treasury.export.sub')} help={t('treasury.export.help')} class="tre-o6" data-testid="treasury-export">
      <div class="stack">
        {mismatch && <Banner kind="warn" data-testid="export-mismatch">{t('treasury.export.mismatch')}</Banner>}
        {!seesInvoices && <Banner kind="info">{t('treasury.export.noInvoices')}</Banner>}
        <div class="tre-export-buttons">
          <Button icon={<FileSpreadsheet size={18} />} onClick={xlsx} data-testid="export-xlsx">{t('treasury.export.xlsx')}</Button>
          <Button icon={<FileText size={18} />} onClick={csv} data-testid="export-csv">{t('treasury.export.csv')}</Button>
          {share && <Button variant="ghost" icon={<Share2 size={18} />} onClick={send} data-testid="export-share">{t('treasury.export.share')}</Button>}
        </div>
      </div>
    </Panel>
  );
}
