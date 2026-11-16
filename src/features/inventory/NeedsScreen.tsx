/* « Besoins de la semaine » (#/needs?week=YYYY-MM-DD, right « inventory »): what the appointments of a week will take
   (oil by grade, filters, new tires by size and season, the parts of the stock), compared with the stock: what to
   buy, ready to copy for the supplier. Each line opens the appointments it comes from; « À compléter » lists the
   appointments whose car does not say enough (no car, oil type unknown…). The logic is domain/stock/needs.ts. */
import { ChevronLeft, ChevronRight, Copy, PackagePlus, Droplet, Filter, Disc3, Package, PackageCheck } from 'lucide-preact';
import { setQuery, type ScreenProps } from '../../platform/router';
import { t, lang } from '../../lib/i18n';
import { today, addDays, weekStart, isValidDay, type Day } from '../../lib/dates';
import { Page, Panel, Button, IconButton, Pill, Empty, Banner, run } from '../../ui';
import { saveInventoryItem } from '../../data/api';
import { can } from '../../data/auth';
import { itemsToCreate } from '../../domain/stock/needs';
import { formatQty } from '../../domain/stock/stock';
import { useWeekNeeds, useDefaultWeek, useHoldsEveryJob } from '../../shared/stock/useWeekNeeds';
import { lineLabel, qtyWords, jugWords, weekWords, shoppingText, FAMILY } from '../../shared/stock/needsWords';
import { NeedRow, MissingRow } from './NeedRows';
import { copyText } from './clipboard';
import '../../shared/stock/needs.css';

const ICON = { oil: Droplet, filters: Filter, tires: Disc3, parts: Package };

/* ---------- the screen ---------- */
export default function NeedsScreen({ query }: ScreenProps) {
  const q = query.get('week');
  const fallback = useDefaultWeek();
  const from = isValidDay(q) ? weekStart(q) : fallback;
  const w = useWeekNeeds(from);
  // a phone that holds only its own truck's appointments: said on screen and in the copied list
  const ownOnly = !useHoldsEveryJob();
  const thisWeek = weekStart(today());
  const buy = w.lines.filter((l) => l.toBuy > 0);
  const litres = w.lines.filter((l) => l.kind === 'oil').reduce((n, l) => n + l.qty, 0);
  const filters = w.lines.filter((l) => FAMILY[l.kind] === 'filters').reduce((n, l) => n + l.qty, 0);
  const tires = w.lines.filter((l) => l.kind === 'tires').reduce((n, l) => n + l.qty, 0);
  const go = (d: Day) => setQuery({ week: d === fallback ? null : d });
  const toCreate = itemsToCreate(w.lines, lineLabel, (k) => t(`inventory.needs.cat.${k}`));
  // the button's own spinner keeps a second tap out while the items are written
  const createAll = () => run(async () => { for (const it of toCreate) await saveInventoryItem({ ...it, qty: 0, active: true }); }, { ok: t('inventory.needs.created', { n: toCreate.length }) });
  const families = (['oil', 'filters', 'tires', 'parts'] as const).map((f) => ({ f, lines: w.lines.filter((l) => FAMILY[l.kind] === f) })).filter((x) => x.lines.length);

  return (
    <Page title={t('inventory.needs.title')} help={t('inventory.needs.help')} data-testid="needs-screen">
      <div class="needs-weekbar" data-testid="needs-week">
        <IconButton icon={<ChevronLeft />} label={t('inventory.needs.prev')} onClick={() => go(addDays(from, -7))} data-testid="needs-prev" />
        <span class="grow needs-weekname">
          <b>{from === thisWeek ? t('inventory.needs.thisWeek') : from === addDays(thisWeek, 7) ? t('inventory.needs.nextWeek') : weekWords(from)}</b>
          {(from === thisWeek || from === addDays(thisWeek, 7)) && <span class="small muted">{weekWords(from)}{from === thisWeek && today() !== from ? `, ${t('inventory.needs.fromToday')}` : ''}</span>}
        </span>
        <IconButton icon={<ChevronRight />} label={t('inventory.needs.next')} onClick={() => go(addDays(from, 7))} data-testid="needs-next" />
      </div>

      <div class="needs-stats glass" data-testid="needs-stats">
        <Stat n={String(w.jobs)} label={t('inventory.needs.stat.jobs', { n: w.jobs })} />
        <Stat n={formatQty(Math.round(litres * 10) / 10, lang.value)} unit="L" label={t('inventory.needs.stat.oil')} />
        <Stat n={formatQty(filters, lang.value)} label={t('inventory.needs.stat.filters', { n: filters })} />
        <Stat n={formatQty(tires, lang.value)} label={t('inventory.needs.stat.tires', { n: tires })} />
      </div>
      {ownOnly && <Banner kind="info" data-testid="needs-own-trucks">{t('inventory.needs.ownTrucks')}</Banner>}

      {!w.lines.length ? (
        <Panel><Empty title={w.jobs ? t('inventory.needs.emptyWork') : t('inventory.needs.emptyWeek')} text={w.jobs ? t('inventory.needs.emptyWorkText') : t('inventory.needs.emptyWeekText')} /></Panel>
      ) : (
        <>
          <Panel flush title={<>{t('inventory.needs.buyTitle')} {buy.length > 0 && <Pill tone="warn">{buy.length}</Pill>}</>} sub={t('inventory.needs.buySub')} data-testid="needs-buy"
            action={buy.length > 0 && <Button size="sm" icon={<Copy size={16} />} onClick={() => copyText(shoppingText(w, ownOnly))} data-testid="needs-copy">{t('inventory.needs.copy')}</Button>}>
            {buy.length ? (
              <ul class="needs-buy" role="list">
                {buy.map((l) => (
                  <li key={l.key} class="needs-buy-row" data-testid="needs-buy-row">
                    <span class="needs-buy-name">{lineLabel(l)}{!l.sure && <Pill tone="warn" dot={false}>{t('inventory.needs.toConfirm')}</Pill>}</span>
                    <span class="needs-buy-qty"><b class="num">{qtyWords(l, l.toBuy)}</b>{jugWords(l) && <span class="small muted">{jugWords(l)}</span>}</span>
                  </li>
                ))}
              </ul>
            ) : <p class="inv-none"><PackageCheck size={18} aria-hidden="true" /> {t('inventory.needs.nothingToBuy')}</p>}
            {toCreate.length > 0 && can('inventory') && (
              <div class="needs-create" data-testid="needs-create">
                <p class="small muted" style={{ margin: 0 }}>{t('inventory.needs.createLead', { n: toCreate.length })}</p>
                <Button icon={<PackagePlus size={18} />} onClick={createAll} data-testid="needs-create-all">{t('inventory.needs.createAll', { n: toCreate.length })}</Button>
              </div>
            )}
          </Panel>

          <Panel flush title={t('inventory.needs.allTitle')} help={t('inventory.needs.allHelp')} data-testid="needs-all">
            <div class="needs-head" aria-hidden="true">
              <span class="grow">{t('inventory.needs.cols.what')}</span><span>{t('inventory.needs.cols.need')}</span><span>{t('inventory.needs.cols.stock')}</span><span>{t('inventory.needs.cols.buy')}</span>
            </div>
            {families.map(({ f, lines }) => {
              const Icon = ICON[f];
              return (
                <div key={f} class="needs-family">
                  <h3 class="needs-family-h"><Icon size={18} aria-hidden="true" />{t(`inventory.needs.family.${f}`)}</h3>
                  {lines.map((l) => <NeedRow key={l.key} l={l} />)}
                </div>
              );
            })}
          </Panel>

          {w.missing.length > 0 && (
            <Panel flush title={<>{t('inventory.needs.missingTitle')} <Pill tone="warn">{w.missing.length}</Pill></>} sub={t('inventory.needs.missingSub')} data-testid="needs-missing">
              <ul class="needs-missing" role="list">{w.missing.map((m) => <MissingRow key={m.jobId} m={m} />)}</ul>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

function Stat(p: { n: string; unit?: string; label: string }) {
  return <span class="needs-stat"><b class="num">{p.n}{p.unit && <small> {p.unit}</small>}</b><span class="small muted">{p.label}</span></span>;
}
