/* « Inventaire » (#/inventory, right « inventory »): the stock value, search and category, what to order first
   (lowStock), then everything in stock with its quantity, minimum, cost and value. An item opens its sheet. */
import { useState } from 'preact/hooks';
import { Plus, PackageCheck } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { inventoryList, lowStock } from '../../data/select';
import type { InventoryItem } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, Empty, Chips, SearchInput, Pill, Help } from '../../ui';
import { BigMoney } from '../dashboard/charts';
import { itemValue, stockValue, toOrder } from './stock';
import { ItemSheet, useQty } from './ItemSheet';
import '../dashboard/charts.css';
import './inventory.css';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function found(i: InventoryItem, q: string): boolean {
  const s = fold(q.trim());
  if (!s) return true;
  const hay = fold([i.name, i.sku, i.category, i.supplier, i.notes].filter(Boolean).join(' '));
  return s.split(/\s+/).every((w) => hay.includes(w));
}

export default function InventoryScreen(_p: ScreenProps) {
  const l = lang.value;
  const qtyText = useQty();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const open = (id: string | null) => setSheet({ open: true, id });

  const all = inventoryList.value;
  const value = stockValue(all);
  const cats = [...new Set(all.map((i) => (i.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const keep = (i: InventoryItem) => (!cat || (i.category || '').trim() === cat) && found(i, q);
  const urgency = (i: InventoryItem) => (i.min_qty ? Number(i.qty) / Number(i.min_qty) : Number(i.qty));
  const low = lowStock.value.filter(keep).sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name, 'fr'));
  const lowIds = new Set(lowStock.value.map((i) => i.id));
  const rest = all.filter((i) => i.active && !lowIds.has(i.id) && keep(i));
  const off = all.filter((i) => !i.active && keep(i));
  const offCount = all.filter((i) => !i.active).length;
  const filtered = !!q.trim() || !!cat;
  const activeCount = all.filter((i) => i.active).length;

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
    <Page title={t('inventory.title')} sub={t('inventory.sub')} help={t('inventory.help')} wide data-testid="inventory-screen"
      actions={<Button variant="primary" icon={<Plus size={20} />} onClick={() => open(null)} data-testid="inventory-add">{t('inventory.add')}</Button>}>
      {!all.length ? (
        <Panel><Empty title={t('inventory.empty')} text={t('inventory.emptyText')} action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => open(null)}>{t('inventory.add')}</Button>} /></Panel>
      ) : (
        <>
          <Panel class="inv-summary" data-testid="inventory-summary">
            <div class="stack" style={{ gap: '6px' }}>
              <span class="dash-kicker">{t('inventory.value')} <Help text={t('inventory.valueHelp')} /></span>
              <BigMoney cents={value} lang={l} size="lg" data-testid="inventory-value" />
            </div>
            <div class="inv-counts">
              <span>{t('inventory.items', { n: activeCount })}</span>
              <span class={lowStock.value.length ? 'inv-warn' : 'inv-okay'}>{t('inventory.toOrderCount', { n: lowStock.value.length })}</span>
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

          <Panel flush title={<>{t('inventory.low.title')} {lowStock.value.length > 0 && <Pill tone="warn">{lowStock.value.length}</Pill>}</>} sub={t('inventory.low.sub')} data-tour="inventory-low" data-testid="inventory-low">
            {low.length ? <Rows>{head}{low.map((i) => row(i, true))}</Rows>
              : <p class="inv-none">{lowStock.value.length && filtered ? t('inventory.noMatch') : <><PackageCheck size={18} aria-hidden="true" /> {t('inventory.low.none')}</>}</p>}
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
      <ItemSheet open={sheet.open} itemId={sheet.id} onClose={() => setSheet({ open: false, id: null })} />
    </Page>
  );
}
