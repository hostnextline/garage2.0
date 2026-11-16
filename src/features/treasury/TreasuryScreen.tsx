/* « Trésorerie » (#/treasury, right « treasury »): for a period, the profit (the key number), the TPS/TVQ to remit,
   expenses by category, money collected by payment method (the server's treasury_report), last night's
   reconciliation, the period's expenses (the device's copy: still there with no signal), « Ajouter une dépense » (also
   #/treasury?add=1) and the files for the accountant (Excel with the sheets Revenus, Dépenses, Taxes; CSV).
   The report is asked again by itself once a change of the period's rows has reached the server: before, an expense
   added here left the profit and the taxes as they were, with a false « not synced » warning that never went away. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Plus } from 'lucide-preact';
import { setQuery, type ScreenProps } from '../../platform/router';
import { t, lang } from '../../lib/i18n';
import { today } from '../../lib/dates';
import { rpcNow } from '../../data/api';
import { expensesList, invoicesList, invoiceNumber, customer, customerName, customersList, truckLabel, trucks, staffList, settings } from '../../data/select';
import { can, me } from '../../data/auth';
import { net } from '../../data/sync';
import type { Expense } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, Chips, Field, DateInput, invoiceStatusWord } from '../../ui';
import { useReport } from '../../shared/charts/useReport';
import { PERIODS, isPeriod, periodRange, rangeLabel, type PeriodKey } from '../../domain/money/period';
import { normalizeReport, type TreasuryReport } from './report';
import { methodLabel, periodExpenses, rowsSignature } from './select';
import { expenseLines, revenueLines, type LineNames } from './exportRows';
import { ReportPanel, TaxesPanel, CategoriesPanel, CollectedPanel } from './ReportPanels';
import { ReconPanel } from './ReconPanel';
import { ExpensesPanel } from './ExpensesPanel';
import { ExportPanel } from './ExportPanel';
import { ExpenseSheet } from './ExpenseSheet';
import { startReceiptQueue } from './receipts';
import '../../shared/charts/charts.css';
import './treasury.css';

const NAMES: LineNames = {
  invoiceNumber, customer: (id) => customerName(customer(id)), status: (s) => invoiceStatusWord(s),
  method: methodLabel, truck: truckLabel
};
/** time for a burst of changes (a save, then its answer) to settle before the report is asked again */
const REFRESH_MS = 1200;

export default function TreasuryScreen({ query }: ScreenProps) {
  const l = lang.value;
  const p = query.get('p');
  const key: PeriodKey = isPeriod(p) ? p : 'month';
  const range = periodRange(key, today(), { from: query.get('from') || undefined, to: query.get('to') || undefined });
  const reportKey = `his.report.${me.value?.id || 'x'}.treasury.${range.from}.${range.to}`;
  const report = useReport<TreasuryReport>(reportKey,
    async () => normalizeReport(await rpcNow('treasury_report', { p_from: range.from, p_to: range.to }), range.from, range.to));
  const [sheet, setSheet] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });
  const openExpense = useCallback((e: Expense) => setSheet({ open: true, expense: e }), []);

  // the phone's rows of the period, computed once per change of the store (the list, the files and the check share them)
  const seesInvoices = can('invoices');
  const expenses = useMemo(() => periodExpenses(expensesList.value, range), [expensesList.value, range.from, range.to]);
  // the names in the lines (customer, truck and its driver, the invoice prefix) are read from the store too: a name
  // changed or arrived during the visit must reach the accountant's file
  const customersNow = customersList.value, trucksNow = trucks.value, staffNow = staffList.value, billing = settings.value.billing;
  const rev = useMemo(() => (seesInvoices ? revenueLines(invoicesList.value, range, NAMES) : []), [seesInvoices, invoicesList.value, range.from, range.to, l, customersNow, billing]);
  const exp = useMemo(() => expenseLines(expenses, range, NAMES), [expenses, l, trucksNow, staffNow]);
  const stale = useRefreshOnChange(reportKey, useMemo(() => rowsSignature([...expenses, ...rev.map((r) => [r.day, r.number, r.subtotal, r.tps, r.tvq, r.total, r.paid])]), [expenses, rev]), report.reload);
  const settled = net.value.pending === 0 && !net.value.sending;

  // receipt photos left waiting on this phone by an earlier visit go now
  useEffect(() => startReceiptQueue(), []);

  // « + », « Dépense ou reçu » and the guide open #/treasury?add=1: clean the address first, then open the sheet
  // (the sheet's own history step must not keep ?add=1, or « Retour » would open it again)
  const add = query.get('add');
  useEffect(() => {
    if (add !== '1') return;
    setQuery({ add: null });
    // not cancelled when the address changes (cleaning it changes it): the sheet must open
    setTimeout(() => setSheet({ open: true, expense: null }), 0);
  }, [add]);

  const choose = (k: PeriodKey) => setQuery({ p: k === 'month' ? null : k, from: k === 'custom' ? range.from : null, to: k === 'custom' ? range.to : null });
  const openExpenseById = (id: string) => { const e = expensesList.value.find((x) => x.id === id); if (e) openExpense(e); };

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
          <ReconPanel onOpenExpense={openExpenseById} />
          {report.data && <TaxesPanel d={report.data} l={l} />}
          <CategoriesPanel d={report.data} rows={expenses} l={l} />
          {report.data && <CollectedPanel d={report.data} l={l} />}
        </div>
        <div class="tre-col-b">
          <ExpensesPanel rows={expenses} l={l} onOpen={openExpense} />
          <ExportPanel range={range} rev={rev} exp={exp} seesInvoices={seesInvoices} l={l} report={report.data} offline={report.offline}
            comparable={!report.loading && !report.offline && !report.error && !report.fromCache && !stale && settled} />
          <Panel flush>
            <Rows><RowItem href={`#/coffre`} chevron data-testid="treasury-coffre" title={t('coffre.open')} sub={t('coffre.openSub')} /></Rows>
          </Panel>
        </div>
      </div>
      <ExpenseSheet open={sheet.open} expense={sheet.expense} onClose={() => setSheet({ open: false, expense: null })} />
    </Page>
  );
}

/** asks the report again once the period's rows changed and the phone has sent everything it was waiting to send
    (asked sooner, the server would answer the numbers of before). Returns true while the report is older than the
    rows: the screen then does not compare the two. A new period is the report's own new load, not a refresh. */
function useRefreshOnChange(reportKey: string, signature: string, reload: () => void): boolean {
  const [seen, setSeen] = useState({ key: reportKey, signature });
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const settled = net.value.pending === 0 && !net.value.sending;
  const current = seen.key === reportKey ? seen : { key: reportKey, signature };
  useEffect(() => {
    if (seen.key !== reportKey) { setSeen({ key: reportKey, signature }); return; }
    if (signature === seen.signature || !settled) return;
    const timer = setTimeout(() => { setSeen({ key: reportKey, signature }); reloadRef.current(); }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [reportKey, signature, seen, settled]);
  return current.signature !== signature;
}
