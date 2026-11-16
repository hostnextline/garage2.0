/* The week's needs in words: the name of each line, its quantities, the jugs to buy, the week, the shopping list as
   text for the supplier. */
import { t, lang } from '../../lib/i18n';
import { addDays, parseDay, type Day } from '../../lib/dates';
import { inventoryList, garageName } from '../../data/select';
import type { InventoryItem } from '../../data/types';
import type { NeedLine, WeekNeeds } from '../../domain/stock/needs';
import { formatQty, isDefaultUnit } from '../../domain/stock/stock';

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
  return isDefaultUnit(unit) ? t('inventory.units', { n, q }) : `${q} ${unit}`;
}
export const jugWords = (l: NeedLine) => (l.unit === 'L' && l.toBuy > 0 && l.jugL ? t('inventory.needs.jugs', { n: Math.ceil(l.toBuy / l.jugL - 1e-9), size: formatQty(l.jugL, lang.value) }) : '');
const dayFmt = new Map<string, Intl.DateTimeFormat>();
export function dayWord(d: Day): string {
  const loc = lang.value === 'en' ? 'en-CA' : 'fr-CA';
  let f = dayFmt.get(loc);
  if (!f) { f = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' }); dayFmt.set(loc, f); }
  return f.format(parseDay(d));
}
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
