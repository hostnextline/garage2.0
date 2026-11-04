/* « Estimations »: prices given before the work (often on the spot, with no customer file). Tabs by answer, a search,
   « Nouvelle estimation ». */
import { useState } from 'preact/hooks';
import { FilePlus2, ClipboardList } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { isField } from '../../app/routes';
import { setQuery } from '../../app/router';
import type { Quote } from '../../data/types';
import { quotesList, settings, customer, customerName, vehicle, vehicleLabel } from '../../data/select';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { shortDate, dayOf, today } from '../../lib/dates';
import { matches, formatPhone } from '../../lib/text';
import { Page, Panel, Tabs, SearchInput, Button, Empty, Skeleton, Pill, Money, type Tone } from '../../ui';
import { quoteNumber } from '../invoices/select';
import { quoteTotals, quoteExpired, type QuoteStatus } from './logic';
import '../invoices/invoices.css';
import './quotes.css';

type QTab = 'active' | 'accepted' | 'converted' | 'declined' | 'all';
const TABS: QTab[] = ['active', 'accepted', 'converted', 'declined', 'all'];
const TONE: Record<QuoteStatus, Tone> = { open: 'draft', sent: 'booked', accepted: 'done', declined: 'cancelled', converted: 'on_site' };

export function QuotePill(p: { status: QuoteStatus }) {
  return <Pill tone={TONE[p.status] || 'muted'} data-testid="quote-status">{t(`quotes.status.${p.status}`)}</Pill>;
}
export function quoteWho(q: Quote): string {
  return customerName(customer(q.customer_id)) || q.contact_name?.trim() || '';
}
export function quoteCar(q: Quote): string {
  return vehicleLabel(vehicle(q.vehicle_id)) || q.vehicle_text?.trim() || '';
}
function inTab(q: Quote, tab: QTab) {
  return tab === 'all' || (tab === 'active' ? q.status === 'open' || q.status === 'sent' : q.status === tab);
}

export default function QuotesScreen({ query }: ScreenProps) {
  const tab: QTab = TABS.includes(query.get('tab') as QTab) ? (query.get('tab') as QTab) : 'active';
  const [q, setQ] = useState('');
  const l = lang.value;
  const all = quotesList.value;
  const counts: Record<QTab, number> = { active: 0, accepted: 0, converted: 0, declined: 0, all: all.length };
  for (const x of all) { if (x.status === 'open' || x.status === 'sent') counts.active++; else if (x.status in counts) counts[x.status as QTab]++; }
  const list = all.filter((x) => inTab(x, tab) && (!q.trim() || matches(q, quoteNumber(x), x.number != null ? String(x.number) : '', quoteWho(x), quoteCar(x), x.contact_phone, customer(x.customer_id)?.phone)))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.number ?? 0) - Number(a.number ?? 0));
  const canCreate = isField();
  const n = net.value;
  return (
    <Page title={t('quotes.title')} sub={t('quotes.list.sub')} help={t('quotes.list.help')} wide
      actions={canCreate ? <Button variant="primary" icon={<FilePlus2 />} href="#/quote/new" class="quote-new-head" data-testid="quote-new">{t('quotes.list.new')}</Button> : undefined}>
      {canCreate && <Button variant="primary" block icon={<FilePlus2 />} href="#/quote/new" class="quote-new-body" data-testid="quote-new-phone">{t('quotes.list.new')}</Button>}
      <div class="stack">
        <Tabs value={tab} onValue={(v) => setQuery({ tab: v === 'active' ? null : v })} label={t('quotes.title')}
          tabs={TABS.map((x) => ({ value: x, label: t(`quotes.tabs.${x}`), count: x === 'active' || x === 'accepted' ? counts[x] : undefined }))} />
        <SearchInput value={q} onValue={setQ} placeholder={t('quotes.list.search')} />
      </div>
      <Panel flush data-testid="quotes-list">
        {!n.ready && !all.length ? (
          <div style={{ padding: 'var(--sp-5)' }}><Skeleton h={44} lines={3} /></div>
        ) : !list.length ? (
          q.trim()
            ? <Empty icon={<ClipboardList />} title={t('quotes.list.noMatch', { q: q.trim() })} text={t('quotes.list.noMatchText')} action={<Button onClick={() => setQ('')}>{t('quotes.list.clearSearch')}</Button>} />
            : <Empty icon={<ClipboardList />} title={t(`quotes.list.empty.${tab}`)} text={t(`quotes.list.emptyText.${tab}`)}
              action={canCreate && tab === 'active' ? <Button variant="primary" icon={<FilePlus2 />} href="#/quote/new">{t('quotes.list.new')}</Button> : undefined} />
        ) : (
          <div class="inv-rows" role="list">
            {list.map((x) => {
              const total = quoteTotals(x.items, settings.value.taxes).total;
              const expired = quoteExpired(x, today());
              const who = quoteWho(x) || (x.contact_phone ? formatPhone(x.contact_phone) : t('quotes.noName'));
              const car = quoteCar(x);
              const when = x.created_at ? shortDate(dayOf(new Date(x.created_at)), l) : '';
              return (
                <div key={x.id} class="inv-row" role="listitem" data-testid="quote-row">
                  <a class="inv-row-main" href={`#/quote/${x.id}`}>
                    <span class="inv-row-who">
                      <span class="inv-row-no">{x.number != null ? quoteNumber(x) : t('quotes.newWord')}</span>
                      <span class="inv-row-name">{who}</span>
                      <span class={`inv-row-sub${expired ? ' is-late' : ''}`}>
                        {[car, expired ? t('quotes.list.expired', { when: shortDate(x.valid_until!, l) }) : when].filter(Boolean).join(', ')}
                      </span>
                    </span>
                    <span class="inv-row-end">
                      <Money cents={total} />
                      <QuotePill status={x.status} />
                    </span>
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </Page>
  );
}
