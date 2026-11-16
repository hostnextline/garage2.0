/* « Factures »: the money still to collect first, then the invoices by tab (à payer: oldest first), a search, a period,
   « Relancer » on an unpaid one, and « Exporter » (the list shown, for a spreadsheet). */
import { useCallback, useMemo, useState } from 'preact/hooks';
import { FileDown, Receipt } from 'lucide-preact';
import { setQuery, type ScreenProps } from '../../platform/router';
import type { Invoice, Payment } from '../../data/types';
import { invoicesList, invoiceNumber, settings } from '../../data/select';
import { rowsOf, tableSignal } from '../../data/store';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { dayOf, today } from '../../lib/dates';
import { matches } from '../../lib/text';
import { Page, Panel, Tabs, SearchInput, Select, Button, Empty, Banner, Skeleton } from '../../ui';
import { daysSince } from '../../domain/money/invoice';
import { listPeriodRange, inListPeriod, LIST_PERIODS, type ListPeriod } from '../../domain/money/period';
import { toCsv, type CsvValue } from '../../domain/money/files';
import { LIST_TABS, inTab, tabCounts, sortForTab, footTotal, listDate, type ListTab } from '../../domain/money/list';
import { amountsOf, invoiceCustomer, invoiceWho, owing, invoiceLabel } from '../../shared/invoices/select';
import { sendText, SendSheet, type SendResult } from '../../shared/invoices/send';
import { downloadBlob } from '../../shared/invoices/share';
import { InvoiceRow } from './InvoiceRow';
import '../../shared/invoices/invoices.css';

const PAGE = 100;

export default function InvoicesScreen({ query }: ScreenProps) {
  const tab: ListTab = LIST_TABS.includes(query.get('tab') as ListTab) ? (query.get('tab') as ListTab) : 'unpaid';
  const period: ListPeriod = LIST_PERIODS.includes(query.get('period') as ListPeriod) ? (query.get('period') as ListPeriod) : 'all';
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [manual, setManual] = useState<SendResult | null>(null);
  const l = lang.value;
  const all = invoicesList.value;
  const n = net.value;
  const day = today();

  const counts = useMemo(() => tabCounts(all), [all]);
  // the list and its amounts are worked out once per change (the invoices, the customers searched and the jobs that
  // name them, the tax rates, the numbers' prefix). Read here, not only inside the memo: the screen stays subscribed
  // to them while the memo is not worked out again.
  const customers = tableSignal('customers').value;
  const jobs = tableSignal('jobs').value;
  const rates = settings.value.taxes;
  const billing = settings.value.billing;
  const { list, total } = useMemo(() => {
    const range = listPeriodRange(period, day);
    const found = sortForTab(all.filter((v) => inTab(v, tab) && inListPeriod(listDate(v), range)
      && (!q.trim() || matches(q, invoiceLabel(v, l), v.number != null ? String(v.number) : '', invoiceWho(v), invoiceCustomer(v)?.company, invoiceCustomer(v)?.phone))), tab);
    return { list: found, total: footTotal(found.map((v) => ({ status: v.status, ...amountsOf(v) })), tab) };
  }, [all, customers, jobs, rates, billing, tab, period, q, l, day]);
  const month = day.slice(0, 7);
  const monthPaid = rowsOf<Payment>('payments').filter((p) => !p.deleted_at && p.paid_at && dayOf(new Date(p.paid_at)).slice(0, 7) === month).reduce((s, p) => s + Number(p.amount_cents), 0);
  const o = owing.value;
  const oldestDays = daysSince(o.oldest);
  // the bell's room is kept on every row when one row has it, so the amounts stay in one column
  const keepRoom = list.some((x) => x.status === 'issued' && !!x.job_id);

  // the same function at every redraw, so the rows (memo) are not all redrawn for nothing
  const remind = useCallback(async (v: Invoice) => { if (!v.job_id) return; const r = await sendText('payment_reminder', v.job_id); if (r) setManual(r); }, []);
  const exportCsv = () => {
    const head: CsvValue[] = ['number', 'date', 'customer', 'phone', 'status', 'subtotal', 'tps', 'tvq', 'total', 'paid', 'balance'].map((k) => t(`invoices.csv.${k}`));
    const rows: CsvValue[][] = list.map((v) => {
      const a = amountsOf(v), c = invoiceCustomer(v);
      const status = v.status === 'issued' && a.paid > 0 ? 'partial' : v.status;
      return [v.number != null ? invoiceNumber(v) : t('invoices.draftWord'), listDate(v) ? dayOf(new Date(listDate(v))) : '', invoiceWho(v), c?.phone || '', t(`invoices.status.${status}`),
        { cents: a.subtotal }, { cents: a.tps }, { cents: a.tvq }, { cents: a.total }, { cents: a.paid }, { cents: a.balance }];
    });
    const name = `${t('invoices.csv.file')} ${today()}.csv`;
    downloadBlob(new Blob([toCsv([head, ...rows], l === 'en' ? 'en' : 'fr')], { type: 'text/csv;charset=utf-8' }), name);
  };

  const emptyFor = (): { title: string; text: string } => q.trim()
    ? { title: t('invoices.list.noMatch', { q: q.trim() }), text: t('invoices.list.noMatchText') }
    : { title: t(`invoices.list.empty.${tab}`), text: t(`invoices.list.emptyText.${tab}`) };

  return (
    <Page title={t('invoices.title')} sub={t('invoices.list.sub')} help={t('invoices.list.help')} wide
      actions={<Button icon={<FileDown />} onClick={exportCsv} disabled={!list.length} data-testid="invoices-export">{t('invoices.list.export')}</Button>}>
      <Panel data-testid="invoices-owing">
        <div class="inv-top">
          <div class="inv-hero">
            <span class="inv-hero-label">{t('invoices.list.owing')}</span>
            <span class="inv-hero-amount money" data-testid="owing-total">{money(o.cents, l)}</span>
            <span class="muted small">{o.n ? t('invoices.list.owingCount', { n: o.n }) : t('invoices.list.owingNone')}</span>
            {o.n > 0 && oldestDays != null && <span class={`small${oldestDays > 30 ? ' inv-late' : ' muted'}`}>{t('invoices.list.oldest', { when: t('invoices.ago', { n: oldestDays }) })}</span>}
          </div>
          <div class="inv-kpi"><span>{t('invoices.list.monthPaid')}</span><b class="money">{money(monthPaid, l)}</b></div>
          <div class="inv-kpi"><span>{t('invoices.list.drafts')}</span><b class="num">{counts.draft}</b></div>
        </div>
      </Panel>

      <div class="stack">
        <Tabs value={tab} onValue={(v) => { setShown(PAGE); setQuery({ tab: v === 'unpaid' ? null : v }); }} label={t('invoices.title')}
          tabs={LIST_TABS.map((x) => ({ value: x, label: t(`invoices.tabs.${x}`), count: x === 'unpaid' || x === 'draft' ? counts[x] : undefined }))} />
        <div class="inv-filters">
          <SearchInput value={q} onValue={(v) => { setQ(v); setShown(PAGE); }} placeholder={t('invoices.list.search')} />
          <Select<ListPeriod> value={period} onValue={(v) => setQuery({ period: v === 'all' ? null : v })} aria-label={t('invoices.list.period')}
            options={LIST_PERIODS.map((p) => ({ value: p, label: t(`invoices.periods.${p}`) }))} />
        </div>
      </div>

      {!n.online && <Banner kind="warn">{t('invoices.list.offline')}</Banner>}

      <Panel flush data-testid="invoices-list">
        {!n.ready && !all.length ? (
          <div style={{ padding: 'var(--sp-5)' }}><Skeleton h={44} lines={4} /></div>
        ) : !list.length ? (
          <Empty icon={<Receipt />} {...emptyFor()} action={q.trim() ? <Button onClick={() => setQ('')}>{t('invoices.list.clearSearch')}</Button> : undefined} />
        ) : (
          <>
            <div class="inv-rows" role="list">
              {list.slice(0, shown).map((v) => <InvoiceRow key={v.id} v={v} onRemind={remind} keepRoom={keepRoom} />)}
            </div>
            {list.length > shown && (
              <div style={{ padding: 'var(--sp-3) var(--sp-5)' }}><Button block onClick={() => setShown(shown + PAGE)}>{t('invoices.list.more', { n: list.length - shown })}</Button></div>
            )}
            <div class="inv-list-foot">
              <span>{t('invoices.list.count', { n: list.length })}</span>
              <span>{tab === 'unpaid' ? t('invoices.list.footOwing', { amount: money(total, l) }) : t('invoices.list.footTotal', { amount: money(total, l) })}</span>
            </div>
          </>
        )}
      </Panel>
      <SendSheet result={manual} onClose={() => setManual(null)} />
    </Page>
  );
}
