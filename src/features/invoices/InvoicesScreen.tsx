/* « Factures »: the money still to collect first, then the invoices by tab (à payer: oldest first), a search, a period,
   « Relancer » on an unpaid one, and « Exporter » (the list shown, for a spreadsheet). */
import { useState } from 'preact/hooks';
import { FileDown, BellRing, Receipt } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { setQuery } from '../../app/router';
import type { Invoice, Payment } from '../../data/types';
import { invoicesList, invoiceNumber } from '../../data/select';
import { rowsOf } from '../../data/store';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { shortDate, dayOf, today } from '../../lib/dates';
import { matches } from '../../lib/text';
import { Page, Panel, Tabs, SearchInput, Select, Button, IconButton, Empty, Banner, Skeleton, InvoicePill, Money } from '../../ui';
import { daysSince, periodRange, inPeriod, toCsv, PERIODS, type PeriodKey, type CsvValue } from './logic';
import { amountsOf, invoiceCustomer, invoiceWho, owing, invoiceLabel } from './select';
import { sendText, SendSheet, type SendResult } from './send';
import { downloadBlob } from './share';
import './invoices.css';

type Tab = 'unpaid' | 'draft' | 'paid' | 'void' | 'all';
const TABS: Tab[] = ['unpaid', 'draft', 'paid', 'void', 'all'];
const PAGE = 100;

const dateOf = (v: Invoice) => v.issued_at || v.created_at || '';
function inTab(v: Invoice, tab: Tab): boolean {
  if (tab === 'unpaid') return v.status === 'issued';
  if (tab === 'all') return true;
  return v.status === (tab === 'draft' ? 'draft' : tab === 'paid' ? 'paid' : 'void');
}

export default function InvoicesScreen({ query }: ScreenProps) {
  const tab: Tab = TABS.includes(query.get('tab') as Tab) ? (query.get('tab') as Tab) : 'unpaid';
  const period: PeriodKey = PERIODS.includes(query.get('period') as PeriodKey) ? (query.get('period') as PeriodKey) : 'all';
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [manual, setManual] = useState<SendResult | null>(null);
  const l = lang.value;
  const all = invoicesList.value;
  const n = net.value;

  const counts: Record<Tab, number> = { unpaid: 0, draft: 0, paid: 0, void: 0, all: all.length };
  for (const v of all) { if (v.status === 'issued') counts.unpaid++; else if (v.status === 'draft') counts.draft++; else if (v.status === 'paid') counts.paid++; else if (v.status === 'void') counts.void++; }
  const range = periodRange(period, today());
  const list = all.filter((v) => inTab(v, tab) && inPeriod(dateOf(v), range)
    && (!q.trim() || matches(q, invoiceLabel(v, l), v.number != null ? String(v.number) : '', invoiceWho(v), invoiceCustomer(v)?.company, invoiceCustomer(v)?.phone)));
  if (tab === 'unpaid') list.sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || Number(a.number) - Number(b.number));
  else list.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || Number(b.number ?? 0) - Number(a.number ?? 0));
  const month = today().slice(0, 7);
  const monthPaid = rowsOf<Payment>('payments').filter((p) => !p.deleted_at && p.paid_at && dayOf(new Date(p.paid_at)).slice(0, 7) === month).reduce((s, p) => s + Number(p.amount_cents), 0);
  const o = owing.value;
  const oldestDays = daysSince(o.oldest);
  const listTotal = list.reduce((s, v) => s + (tab === 'unpaid' ? amountsOf(v).balance : amountsOf(v).total), 0);

  const remind = async (v: Invoice) => { if (!v.job_id) return; const r = await sendText('payment_reminder', v.job_id); if (r) setManual(r); };
  const exportCsv = () => {
    const head: CsvValue[] = ['number', 'date', 'customer', 'phone', 'status', 'subtotal', 'tps', 'tvq', 'total', 'paid', 'balance'].map((k) => t(`invoices.csv.${k}`));
    const rows: CsvValue[][] = list.map((v) => {
      const a = amountsOf(v), c = invoiceCustomer(v);
      const status = v.status === 'issued' && a.paid > 0 ? 'partial' : v.status;
      return [v.number != null ? invoiceNumber(v) : t('invoices.draftWord'), dateOf(v) ? dayOf(new Date(dateOf(v))) : '', invoiceWho(v), c?.phone || '', t(`invoices.status.${status}`),
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
      <Panel class="inv-summary" data-testid="invoices-owing">
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
          tabs={TABS.map((x) => ({ value: x, label: t(`invoices.tabs.${x}`), count: x === 'unpaid' || x === 'draft' ? counts[x] : undefined }))} />
        <div class="inv-filters">
          <SearchInput value={q} onValue={(v) => { setQ(v); setShown(PAGE); }} placeholder={t('invoices.list.search')} />
          <Select<PeriodKey> value={period} onValue={(v) => setQuery({ period: v === 'all' ? null : v })} aria-label={t('invoices.list.period')}
            options={PERIODS.map((p) => ({ value: p, label: t(`invoices.periods.${p}`) }))} />
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
              {list.slice(0, shown).map((v) => <InvoiceRow key={v.id} v={v} onRemind={remind} keepRoom={list.some((x) => x.status === 'issued' && !!x.job_id)} />)}
            </div>
            {list.length > shown && (
              <div style={{ padding: 'var(--sp-3) var(--sp-5)' }}><Button block onClick={() => setShown(shown + PAGE)}>{t('invoices.list.more', { n: list.length - shown })}</Button></div>
            )}
            <div class="inv-list-foot">
              <span>{t('invoices.list.count', { n: list.length })}</span>
              <span>{tab === 'unpaid' ? t('invoices.list.footOwing', { amount: money(listTotal, l) }) : t('invoices.list.footTotal', { amount: money(listTotal, l) })}</span>
            </div>
          </>
        )}
      </Panel>
      <SendSheet result={manual} onClose={() => setManual(null)} />
    </Page>
  );
}

function InvoiceRow(p: { v: Invoice; onRemind: (v: Invoice) => unknown; keepRoom?: boolean }) {
  const { v } = p;
  const l = lang.value;
  const a = amountsOf(v);
  const unpaid = v.status === 'issued';
  const days = unpaid ? daysSince(v.issued_at) : null;
  const when = dateOf(v) ? shortDate(dayOf(new Date(dateOf(v))), l) : '';
  const sub = unpaid
    ? (a.paid > 0 ? t('invoices.list.subPartial', { when, left: money(a.balance, l) }) : t('invoices.list.subUnpaid', { when, ago: t('invoices.ago', { n: days ?? 0 }) }))
    : v.status === 'draft' ? t('invoices.list.subDraft', { when }) : v.status === 'void' && v.void_reason ? t('invoices.list.subVoid', { when, reason: v.void_reason }) : when;
  const who = invoiceWho(v);
  return (
    <div class="inv-row" role="listitem" data-testid="invoice-row">
      <a class="inv-row-main" href={`#/invoice/${v.id}`}>
        <span class="inv-row-who">
          <span class="inv-row-no">{invoiceLabel(v, l)}</span>
          <span class="inv-row-name">{who}</span>
          <span class={`inv-row-sub${days != null && days > 30 ? ' is-late' : ''}`}>{sub}</span>
        </span>
        <span class="inv-row-end">
          <Money cents={unpaid ? a.balance : a.total} />
          <InvoicePill status={v.status} paidCents={v.paid_cents} />
        </span>
      </a>
      {unpaid && v.job_id
        ? <IconButton icon={<BellRing />} label={t('invoices.list.remind', { who })} onClick={() => p.onRemind(v)} data-testid="invoice-remind" />
        : p.keepRoom && <span class="inv-row-room" aria-hidden="true" />}
    </div>
  );
}
