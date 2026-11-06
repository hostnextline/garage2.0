/* « Besoins de la semaine » (#/needs?week=YYYY-MM-DD, right « inventory »): what the appointments of a week will take
   (oil by grade, filters, new tires by size and season, the parts of the stock), compared with the stock: what to
   buy, ready to copy for the supplier. Each line opens the appointments it comes from; « À compléter » lists the
   appointments whose car does not say enough (no car, oil type unknown…). The logic is needs.ts. */
import { useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, ChevronDown, Copy, Droplet, Filter, Disc3, Package, TriangleAlert, PackageCheck } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { ScreenProps } from '../../app/routes';
import { setQuery } from '../../app/router';
import { t, lang } from '../../lib/i18n';
import { today, addDays, weekStart, isValidDay, type Day } from '../../lib/dates';
import { job as jobById, customer, customerName } from '../../data/select';
import { Page, Panel, Button, IconButton, Pill, Empty } from '../../ui';
import type { NeedLine, Missing } from './needs';
import { formatQty } from './stock';
import { useWeekNeeds, defaultWeek, lineLabel, qtyWords, jugWords, weekWords, shoppingText, copy, dayWord, FAMILY } from './needsView';
import './inventory.css';

const ICON = { oil: Droplet, filters: Filter, tires: Disc3, parts: Package };

/* ---------- the screen ---------- */
export default function NeedsScreen({ query }: ScreenProps) {
  const q = query.get('week');
  const from = isValidDay(q) ? weekStart(q) : defaultWeek();
  const w = useWeekNeeds(from);
  const thisWeek = weekStart(today());
  const buy = w.lines.filter((l) => l.toBuy > 0);
  const litres = w.lines.filter((l) => l.kind === 'oil').reduce((n, l) => n + l.qty, 0);
  const filters = w.lines.filter((l) => FAMILY[l.kind] === 'filters').reduce((n, l) => n + l.qty, 0);
  const tires = w.lines.filter((l) => l.kind === 'tires').reduce((n, l) => n + l.qty, 0);
  const go = (d: Day) => setQuery({ week: d === defaultWeek() ? null : d });
  const families = (['oil', 'filters', 'tires', 'parts'] as const).map((f) => ({ f, lines: w.lines.filter((l) => FAMILY[l.kind] === f) })).filter((x) => x.lines.length);

  return (
    <Page title={t('inventory.needs.title')} help={t('inventory.needs.help')} data-testid="needs-screen">
      <div class="needs-weekbar" data-testid="needs-week">
        <IconButton icon={<ChevronLeft />} label={t('inventory.needs.prev')} onClick={() => go(addDays(from, -7))} data-testid="needs-prev" />
        <span class="grow needs-weekname">
          <b>{from === thisWeek ? t('inventory.needs.thisWeek') : from === addDays(thisWeek, 7) ? t('inventory.needs.nextWeek') : weekWords(from)}</b>
          {(from === thisWeek || from === addDays(thisWeek, 7)) && <span class="small muted">{weekWords(from)}</span>}
        </span>
        <IconButton icon={<ChevronRight />} label={t('inventory.needs.next')} onClick={() => go(addDays(from, 7))} data-testid="needs-next" />
      </div>

      <div class="needs-stats glass" data-testid="needs-stats">
        <Stat n={String(w.jobs)} label={t('inventory.needs.stat.jobs', { n: w.jobs })} />
        <Stat n={formatQty(Math.round(litres * 10) / 10, lang.value)} unit="L" label={t('inventory.needs.stat.oil')} />
        <Stat n={formatQty(filters, lang.value)} label={t('inventory.needs.stat.filters', { n: filters })} />
        <Stat n={formatQty(tires, lang.value)} label={t('inventory.needs.stat.tires', { n: tires })} />
      </div>

      {!w.lines.length ? (
        <Panel><Empty title={w.jobs ? t('inventory.needs.emptyWork') : t('inventory.needs.emptyWeek')} text={w.jobs ? t('inventory.needs.emptyWorkText') : t('inventory.needs.emptyWeekText')} /></Panel>
      ) : (
        <>
          <Panel flush title={<>{t('inventory.needs.buyTitle')} {buy.length > 0 && <Pill tone="warn">{buy.length}</Pill>}</>} sub={t('inventory.needs.buySub')} data-testid="needs-buy"
            action={buy.length > 0 && <Button size="sm" icon={<Copy size={16} />} onClick={() => void copy(shoppingText(w))} data-testid="needs-copy">{t('inventory.needs.copy')}</Button>}>
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

function NeedRow(p: { l: NeedLine }) {
  const { l } = p;
  const [open, setOpen] = useState(false);
  const stock = l.stock == null ? '—' : qtyWords(l, l.stock);
  return (
    <div class={`needs-row${open ? ' is-open' : ''}`} data-testid="needs-row">
      <button type="button" class="needs-row-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="grow needs-row-main">
          <span class="needs-row-name">{lineLabel(l)}</span>
          <span class="small muted">
            {t('inventory.needs.fromJobs', { n: l.jobs.length })}
            <span class="needs-phone">, {t('inventory.needs.needStock', { need: qtyWords(l, l.qty), stock })}</span>
            {!l.sure && <>, <span class="needs-warn">{t('inventory.needs.toConfirm').toLowerCase()}</span></>}
          </span>
        </span>
        <span class="needs-cell num"><span class="sr-only">{t('inventory.needs.cols.need')} </span>{qtyWords(l, l.qty)}</span>
        <span class="needs-cell num muted"><span class="sr-only">{t('inventory.needs.cols.stock')} </span>{stock}</span>
        <span class={`needs-cell num ${l.toBuy > 0 ? 'needs-buy-n' : 'needs-ok'}`}><span class="sr-only">{t('inventory.needs.cols.buy')} </span>{l.toBuy > 0 ? qtyWords(l, l.toBuy) : '✓'}</span>
        <ChevronDown size={18} class="needs-chev" aria-hidden="true" />
      </button>
      {open && (
        <ul class="needs-jobs" role="list">
          {l.jobs.map((j) => {
            const job = jobById(j.jobId);
            const who = job ? customerName(customer(job.customer_id)) : '';
            return (
              <li key={j.jobId}>
                <a href={`#/job/${j.jobId}`} class="needs-job">
                  <span class="grow">{[`#${j.number}`, dayWord(j.day), who].filter(Boolean).join(', ')}<span class="small muted needs-job-car">{j.car || t('inventory.needs.noCar')}{j.sure ? '' : `, ${t('inventory.needs.fromList')}`}</span></span>
                  <span class="num">{qtyWords(l, j.qty)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MissingRow(p: { m: Missing }) {
  const { m } = p;
  const job = jobById(m.jobId);
  const vid = job?.vehicle_id;
  const what: ComponentChildren = m.what.map((x) => t(`inventory.needs.missing.${x}`, { car: m.car })).join(' ');
  const href = vid && !m.what.includes('car') ? `#/vehicle/${vid}` : `#/job/${m.jobId}`;
  return (
    <li>
      <a class="needs-job" href={href} data-testid="needs-missing-row">
        <TriangleAlert size={18} aria-hidden="true" class="needs-warn" />
        <span class="grow">{[`#${m.number}`, dayWord(m.day), m.car].filter(Boolean).join(', ')}<span class="small muted needs-job-car">{what}</span></span>
        <ChevronRight size={18} class="faint" aria-hidden="true" />
      </a>
    </li>
  );
}

