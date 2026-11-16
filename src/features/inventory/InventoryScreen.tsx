/* « Inventaire » (#/inventory, right « inventory »): the stock value, search and category, what to order first
   (at or under the minimum), then everything in stock with its quantity, minimum, cost and value. An item opens its sheet.
   Two stocks (?pool=coffre): the garage's, and the Coffre's own (bought with the Coffre's money, no taxes, apart from the
   garage's value, orders and the Trésorerie). */
import { useState } from 'preact/hooks';
import { Plus, PackageCheck, ClipboardList } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { inventoryList, coffreStock } from '../../data/select';
import { setQuery, type ScreenProps } from '../../platform/router';
import type { InventoryItem } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, Empty, Chips, SearchInput, Pill, Help, BigStep, Seg, Banner } from '../../ui';
import { BigMoney } from '../../shared/charts/charts';
import { itemValue, stockValue, toOrder } from '../../domain/stock/stock';
import { ItemSheet } from './ItemSheet';
import { useQty } from './useQty';
import { useShownItems } from './useOnHand';
import { stockLists } from './stockLists';
import { useDefaultWeek } from '../../shared/stock/useWeekNeeds';
import { weekWords } from '../../shared/stock/needsWords';
import '../../shared/charts/charts.css';
import '../../shared/stock/needs.css';
import './inventory.css';

export default function InventoryScreen({ query }: ScreenProps) {
  const pool: 'garage' | 'coffre' = query.get('pool') === 'coffre' ? 'coffre' : 'garage';
  const isCoffre = pool === 'coffre';
  const l = lang.value;
  const qtyText = useQty();
  const shown = useShownItems();
  const week = useDefaultWeek();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const open = (id: string | null) => setSheet({ open: true, id });

  // each item with its quantity on hand (what still waits to be sent counts), for the value and « À commander » too
  const all = shown(isCoffre ? coffreStock.value : inventoryList.value);
  const value = stockValue(all);
  const { lowAll, low, rest, off, offCount, activeCount, cats } = stockLists(all, q, cat);
  const filtered = !!q.trim() || !!cat;

  const row = (i: InventoryItem, isLowRow: boolean) => {
    const v = itemValue(i);
    const min = i.min_qty != null ? qtyText(Number(i.min_qty), i.unit) : null;
    const lowLine = Number(i.qty) <= 0 && i.min_qty == null
      ? t('inventory.low.leftNoMin')
      : `${t('inventory.low.left', { qty: qtyText(Number(i.qty), i.unit), min: min || '0' })} ${t('inventory.low.suggest', { qty: qtyText(toOrder(i), i.unit) })}`;
    return (
      <RowItem key={i.id} onClick={() => open(i.id)} data-testid={isLowRow ? 'low-row' : 'item-row'}
        title={i.name}
        sub={isLowRow ? lowLine : <><span class="inv-sub-phone">{min ? t('inventory.minLine', { qty: min }) : t('inventory.noMin')}</span><span class="inv-sub-wide">{i.category || ''}</span></>}
        end={
          <span class="inv-end">
            <span class={`inv-qty num${isLowRow ? ' is-low' : ''}`}><span class="sr-only">{t('inventory.cols.qty')} </span>{qtyText(Number(i.qty), i.unit)}</span>
            <span class="inv-col"><span class="sr-only">{t('inventory.cols.min')} </span>{min || '—'}</span>
            <span class="inv-col"><span class="sr-only">{t('inventory.cols.cost')} </span>{i.cost_cents != null ? money(i.cost_cents, l) : '—'}</span>
            <span class="inv-val"><span class="sr-only">{t('inventory.cols.value')} </span>{v != null ? money(v, l) : '—'}</span>
          </span>
        } chevron />
    );
  };
  const head = (
    <div class="inv-headrow" aria-hidden="true">
      <span class="grow">{t('inventory.cols.item')}</span>
      <span class="inv-hq">{t('inventory.cols.qty')}</span><span class="inv-hc">{t('inventory.cols.min')}</span><span class="inv-hc">{t('inventory.cols.cost')}</span><span class="inv-hv">{t('inventory.cols.value')}</span>
    </div>
  );

  return (
    <Page title={t('inventory.title')} sub={t(isCoffre ? 'inventory.coffre.sub' : 'inventory.sub')} help={t('inventory.help')} wide data-testid="inventory-screen"
      actions={<Button variant="primary" icon={<Plus size={20} />} onClick={() => open(null)} data-testid="inventory-add">{t(isCoffre ? 'inventory.coffre.add' : 'inventory.add')}</Button>}>
      <Seg value={pool} label={t('inventory.coffre.which')} data-testid="inventory-pool" class="inv-pool"
        onValue={(v) => { setQ(''); setCat(''); setQuery({ pool: v === 'coffre' ? 'coffre' : null }); }}
        options={[{ value: 'garage', label: t('inventory.coffre.garageTab') }, { value: 'coffre', label: t('inventory.coffre.coffreTab') }]} />
      {isCoffre
        ? <Banner kind="info" data-testid="inventory-coffre-note">{t('inventory.coffre.note')}</Banner>
        : <BigStep icon={<ClipboardList size={24} />} label={t('inventory.needs.title')} sub={t('inventory.needs.openSub', { week: weekWords(week) })} href="#/needs" data-testid="inventory-needs" />}
      {!all.length ? (
        <Panel><Empty title={t(isCoffre ? 'inventory.coffre.empty' : 'inventory.empty')} text={t(isCoffre ? 'inventory.coffre.emptyText' : 'inventory.emptyText')} action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => open(null)}>{t(isCoffre ? 'inventory.coffre.add' : 'inventory.add')}</Button>} /></Panel>
      ) : (
        <>
          <Panel class="inv-summary" data-testid="inventory-summary">
            <div class="stack" style={{ gap: '6px' }}>
              <span class="dash-kicker">{t(isCoffre ? 'inventory.coffre.value' : 'inventory.value')} <Help text={t(isCoffre ? 'inventory.coffre.valueHelp' : 'inventory.valueHelp')} /></span>
              <BigMoney cents={value} lang={l} size="lg" data-testid="inventory-value" />
            </div>
            <div class="inv-counts">
              <span>{t('inventory.items', { n: activeCount })}</span>
              <span class={lowAll.length ? 'inv-warn' : 'inv-okay'}>{t('inventory.toOrderCount', { n: lowAll.length })}</span>
            </div>
          </Panel>

          <div class="inv-filters">
            <SearchInput value={q} onValue={setQ} placeholder={t('inventory.search')} />
            {cats.length > 1 && (
              <Chips label={t('inventory.categoryFilter')} value={[cat || '*']} data-testid="inventory-cats"
                options={[{ value: '*', label: t('inventory.allCategories') }, ...cats.map((c) => ({ value: c, label: c }))]}
                onValue={(v) => setCat(!v[0] || v[0] === '*' ? '' : v[0])} />
            )}
          </div>

          <Panel flush title={<>{t('inventory.low.title')} {lowAll.length > 0 && <Pill tone="warn">{lowAll.length}</Pill>}</>} sub={t('inventory.low.sub')} data-tour="inventory-low" data-testid="inventory-low">
            {low.length ? <Rows>{head}{low.map((i) => row(i, true))}</Rows>
              : <p class="inv-none">{lowAll.length && filtered ? t('inventory.noMatch') : <><PackageCheck size={18} aria-hidden="true" /> {t('inventory.low.none')}</>}</p>}
          </Panel>

          <Panel flush title={t('inventory.stockTitle')} sub={t('inventory.items', { n: rest.length })} data-testid="inventory-stock">
            {rest.length ? <Rows>{head}{rest.map((i) => row(i, false))}</Rows>
              : filtered ? <Empty title={t('inventory.noMatch')} text={t('inventory.noMatchText')} action={<Button onClick={() => { setQ(''); setCat(''); }}>{t('inventory.clear')}</Button>} />
              : <p class="inv-none">{t('inventory.items', { n: 0 })}</p>}
          </Panel>

          {offCount > 0 && (
            <div class="stack">
              <div><Button variant="ghost" onClick={() => setShowOff(!showOff)} data-testid="inventory-off">{showOff ? t('inventory.inactive.hide') : t('inventory.inactive.show', { n: offCount })}</Button></div>
              {showOff && (
                <Panel flush title={t('inventory.inactive.title')} class="inv-off">
                  {off.length ? <Rows>{off.map((i) => row(i, false))}</Rows> : <p class="inv-none">{t('inventory.noMatch')}</p>}
                </Panel>
              )}
            </div>
          )}
        </>
      )}
      <ItemSheet open={sheet.open} itemId={sheet.id} pool={pool} onClose={() => setSheet({ open: false, id: null })} />
    </Page>
  );
}
