/* « Rappels d’huile » (#/oil): the cars due for an oil change, the one waiting the longest first, so the owner or the
   office calls their owner. « À appeler » (due today or before), « Bientôt » (the next 30 days), « Tous ». A line opens
   its sheet (OilSheet.tsx). The rule is domain/oil/due.ts; what is said lives on the car. */
import { useState } from 'preact/hooks';
import { Droplet, CalendarClock } from 'lucide-preact';
import { setQuery, type ScreenProps } from '../../platform/router';
import { t } from '../../lib/i18n';
import { customer, customerName } from '../../data/select';
import { net } from '../../data/sync';
import { Page, Panel, Rows, RowItem, Button, Seg, Empty, Skeleton, Pill, Banner } from '../../ui';
import { nextLine } from '../../shared/customers/when';
import { usePaged } from '../../shared/customers/usePaged';
import type { OilRow } from '../../domain/oil/due';
import { oilList } from '../../domain/oil/select';
import { OilSheet } from './OilSheet';
import { carOf, dueWords, lastWords, tone } from './rowWords';
import './oil.css';

type Tab = 'call' | 'soon' | 'all';

export default function OilScreen({ query }: ScreenProps) {
  const all = oilList.value;
  const call = all.filter((r) => r.state === 'call');
  const soon = all.filter((r) => r.state === 'soon');
  const q = query.get('show');
  const tab: Tab = q === 'soon' || q === 'all' ? q : 'call';
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = all.find((r) => r.key === openKey) || null;
  // « Tous »: the ones to call, then the coming ones by date, the ones we no longer call last
  const list = tab === 'call' ? call : tab === 'soon' ? soon : [...all.filter((r) => r.state !== 'stopped'), ...all.filter((r) => r.state === 'stopped')];
  const paged = usePaged(`oil|${tab}`, list.length);
  const ready = net.value.ready;
  const next = all.find((r) => r.state === 'soon' || r.state === 'later');

  let body;
  if (!all.length && !ready) {
    body = <Panel><div aria-busy="true" aria-label={t('oil.loading')}><Skeleton h={20} lines={5} /></div></Panel>;
  } else if (!list.length) {
    body = (
      <Panel>
        <Empty icon={<Droplet />} title={t(`oil.empty.${tab}Title`)}
          text={<>{t(`oil.empty.${tab}Text`)}{tab === 'call' && next && <> {t('oil.empty.callNext', { name: customerName(customer(next.customerId)), when: dueWords(next).toLowerCase() })}</>}</>}
          action={tab !== 'all' && all.length > 0 && <Button onClick={() => setQuery({ show: 'all' })} data-testid="oil-see-all">{t('oil.tabs.all')}</Button>} />
      </Panel>
    );
  } else {
    body = (
      <Panel flush data-testid="oil-list">
        <Rows>{list.slice(0, paged.limit).map((r) => <OilLine key={r.key} r={r} onOpen={setOpenKey} />)}</Rows>
        {paged.hasMore && (
          <div ref={paged.sentinel} class="oil-more">
            <Button onClick={paged.more}>{t('oil.more', { n: paged.left })}</Button>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Page title={t('oil.title')} help={t('oil.help')} sub={all.length ? t('oil.sub', { n: call.length }) : undefined} data-testid="oil-screen">
      <Seg value={tab} onValue={(v) => setQuery({ show: v === 'call' ? null : v })} label={t('oil.tabs.label')} class="oil-seg" data-testid="oil-tabs"
        options={[
          { value: 'call', label: call.length ? `${t('oil.tabs.call')} (${call.length})` : t('oil.tabs.call') },
          { value: 'soon', label: soon.length ? `${t('oil.tabs.soon')} (${soon.length})` : t('oil.tabs.soon') },
          { value: 'all', label: t('oil.tabs.all') }
        ]} />
      {!net.value.online && <Banner kind="info">{t('oil.empty.offline')}</Banner>}
      {body}
      <OilSheet row={open} onClose={() => setOpenKey(null)} />
    </Page>
  );
}

function OilLine(p: { r: OilRow; onOpen: (key: string) => void }) {
  const r = p.r;
  return (
    <RowItem class="oil-row" onClick={() => p.onOpen(r.key)} chevron data-testid="oil-row"
      title={customerName(customer(r.customerId))}
      sub={<><span class="oil-car">{carOf(r)}</span><span>{lastWords(r)}</span>{r.next && <span class="oil-next"><CalendarClock size={14} aria-hidden="true" />{t('oil.row.next', { when: nextLine(r.next.day, r.next.block, r.next) })}</span>}</>}
      end={<Pill tone={tone(r)} dot={false}>{dueWords(r)}</Pill>} />
  );
}
