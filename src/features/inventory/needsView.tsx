/* What the needs of a week look like in words (shared by « Besoins de la semaine » and the card on « La journée »):
   the needs of a week from the phone's copy of the data, the name of each line, its quantities, the week, the shopping
   list as text. */
import { useEffect, useMemo } from 'preact/hooks';
import { PackageCheck } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { today, addDays, weekStart, parseDay, type Day } from '../../lib/dates';
import { allJobs, itemsOf, service, partsOfService, vehicle, specByKey, inventoryList, garageName } from '../../data/select';
import type { InventoryItem } from '../../data/types';
import { Panel, Button, toast } from '../../ui';
import { engineRef, ensureEngineRef } from '../customers/engineRef';
import { weekNeeds, shoppingWeek, type NeedLine, type WeekNeeds } from './needs';
import { formatQty } from './stock';
import './inventory.css';

/** the needs of the week starting on `from` (Sunday): only the days from today on (what is still to come) */
export function useWeekNeeds(from: Day): WeekNeeds {
  useEffect(() => { void ensureEngineRef(); }, []);
  const rows = engineRef.value.rows;
  const jobs = allJobs.value;
  const inv = inventoryList.value;
  const start = from < today() ? today() : from;
  return useMemo(() => ({
    ...weekNeeds({
      from: start, to: addDays(from, 6), jobs, itemsOf, service: (id) => service(id), partsOf: partsOfService,
      vehicle: (id) => vehicle(id), spec: (k) => specByKey(k), refRows: rows, inventory: inv
    }),
    from
  }), [from, start, jobs, inv, rows]);
}
/** the week to open: the one asked, else from Thursday the next one, else this one */
export function defaultWeek(): Day {
  const now = weekStart(today());
  const next = shoppingWeek(today());
  if (!next || next === now) return now;
  // from Thursday the coming week, when something is booked in it (else this week's appointments still to do)
  const end = addDays(next, 6);
  return allJobs.value.some((j) => j.day >= next && j.day <= end && ['booked', 'en_route', 'on_site'].includes(j.status)) ? next : now;
}

/* ---------- words ---------- */
const itemOf = (id: string | null): InventoryItem | undefined => inventoryList.value.find((i) => i.id === id);
export function lineLabel(l: NeedLine): string {
  const ref = l.ref || '';
  switch (l.kind) {
    case 'oil': return l.ref ? t('inventory.needs.kind.oil', { ref: l.spec ? `${ref} (${l.spec})` : ref }) : t('inventory.needs.kind.oilUnknown');
    case 'tires': {
      const season = t(`inventory.needs.season.${l.season || 'any'}`);
      return l.ref ? t('inventory.needs.kind.tires', { season, ref }) : t('inventory.needs.kind.tiresUnknown', { season });
    }
    case 'item': return itemOf(l.itemId)?.name || t('inventory.needs.kind.itemGone');
    default: return l.ref ? t(`inventory.needs.kind.${l.kind}`, { ref }) : t(`inventory.needs.kind.${l.kind}Unknown`);
  }
}
export function qtyWords(l: NeedLine, n: number): string {
  const q = formatQty(n, lang.value);
  if (l.unit === 'L') return t('inventory.needs.litres', { q });
  if (l.unit === 'tire') return t('inventory.needs.tires', { n, q });
  if (l.kind !== 'item') return t(`inventory.needs.count.${l.kind}`, { n, q });
  const unit = itemOf(l.itemId)?.unit || '';
  return unit && !/^(unité|unite|unités|unites|unit|units|u)?$/i.test(unit) ? `${q} ${unit}` : t('inventory.units', { n, q });
}
export const jugWords = (l: NeedLine) => (l.unit === 'L' && l.toBuy > 0 && l.jugL ? t('inventory.needs.jugs', { n: Math.ceil(l.toBuy / l.jugL - 1e-9), size: formatQty(l.jugL, lang.value) }) : '');
export const dayWord = (d: Day) => new Intl.DateTimeFormat(lang.value === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseDay(d));
export function weekWords(from: Day): string {
  const loc = lang.value === 'en' ? 'en-CA' : 'fr-CA';
  const a = parseDay(from), b = parseDay(addDays(from, 6));
  const long = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long' });
  const sameMonth = a.getMonth() === b.getMonth();
  const first = sameMonth ? (lang.value === 'en' ? long.format(a) : String(a.getDate())) : long.format(a);
  const last = sameMonth && lang.value === 'en' ? String(b.getDate()) : long.format(b);
  return t('inventory.needs.week', { from: first, to: last });
}
export const FAMILY: Record<NeedLine['kind'], 'oil' | 'filters' | 'tires' | 'parts'> = {
  oil: 'oil', oil_filter: 'filters', air_filter: 'filters', cabin_filter: 'filters', tires: 'tires', wipers: 'parts', plugs: 'parts', battery: 'parts', item: 'parts'
};

/** the shopping list as text, for the supplier (copied, or sent from the phone) */
export function shoppingText(w: WeekNeeds): string {
  const buy = w.lines.filter((l) => l.toBuy > 0);
  const head = `${t('inventory.needs.copyTitle', { week: weekWords(w.from) })} — ${garageName.value}`;
  if (!buy.length) return `${head}\n${t('inventory.needs.nothingToBuy')}`;
  return [head, ...buy.map((l) => `- ${lineLabel(l)} : ${qtyWords(l, l.toBuy)}${jugWords(l) ? ` (${jugWords(l)})` : ''}${l.sure ? '' : ` — ${t('inventory.needs.toConfirm').toLowerCase()}`}`)].join('\n');
}
export async function copy(text: string) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(t('inventory.needs.copied'), { kind: 'ok' });
  } catch { toast(t('inventory.needs.copyFailed'), { kind: 'bad' }); }
}

/* ---------- on « La journée », from Thursday: what to buy for the coming week ---------- */
export function NeedsCard() {
  const from = shoppingWeek(today());
  if (!from) return null;
  return <NeedsCardOf from={from} />;
}
function NeedsCardOf(p: { from: Day }) {
  const w = useWeekNeeds(p.from);
  if (!w.lines.length) return null;
  const buy = w.lines.filter((l) => l.toBuy > 0);
  const title = p.from === weekStart(today()) ? t('inventory.needs.cardThis') : t('inventory.needs.cardNext');
  return (
    <Panel flush title={title} sub={weekWords(p.from)} help={t('inventory.needs.cardHelp')} data-testid="today-needs"
      action={<Button size="sm" href={`#/needs?week=${p.from}`} data-testid="today-needs-open">{t('inventory.needs.cardOpen')}</Button>}>
      {buy.length ? (
        <ul class="needs-buy" role="list">
          {buy.slice(0, 4).map((l) => (
            <li key={l.key} class="needs-buy-row">
              <span class="needs-buy-name">{lineLabel(l)}</span>
              <span class="needs-buy-qty"><b class="num">{qtyWords(l, l.toBuy)}</b></span>
            </li>
          ))}
          {buy.length > 4 && <li class="needs-buy-row small muted">{t('inventory.needs.cardMore', { n: buy.length - 4 })}</li>}
        </ul>
      ) : <p class="inv-none"><PackageCheck size={18} aria-hidden="true" /> {t('inventory.needs.nothingToBuy')}</p>}
    </Panel>
  );
}
