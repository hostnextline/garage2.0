/* The week's needs against the garage's stock. Each stock item is shared out ONCE over the whole week: a jug of 5W-20
   on the shelf covers one car, not every line that asks for 5W-20 (one line per approval, one per tire season). Lines
   that name exactly what they want are served first, so a specific oil (VW 502 00) or a winter tire is not taken by a
   plainer line that could use something else. Pure (tested in allocate.test.ts). */
import type { InventoryItem } from '../../data/types';
import { fold } from '../../lib/text';
import { alnum, gradesIn, litresIn, seasonOf } from './refs';
import { round2 } from './stock';

export const DEFAULT_OIL_L = 5;

/** what the allocation reads and writes on a line of the week (see NeedLine in needs.ts) */
export interface StockLine {
  key: string;
  kind: string;
  ref: string | null;
  spec: string | null;
  season: string | null;
  itemId: string | null;
  qty: number;
  jobs: { day: string }[];
  stock: number | null;
  stockItems: string[];
  toBuy: number;
  jugL: number | null;
}

const LITRE_UNIT = /^(l|litre|litres|liter|liters)$/i;
const SETS = /^(jeu|jeux|ensemble|ensembles|set|sets)$/i;
/** litres in one unit of a stock item: its unit is the litre, or its name says the jug (« 5 L ») */
export function litresPerUnit(i: Pick<InventoryItem, 'unit' | 'name' | 'sku'>): number | null {
  const u = String(i.unit || '').trim();
  if (LITRE_UNIT.test(u)) return 1;
  if (/^ml$/i.test(u)) return 0.001;
  return litresIn(`${i.name} ${i.sku || ''}`);
}
/** how many of the line's units one unit of the item holds (litres for oil, tires for a set); null = unknown */
function unitsPer(l: StockLine, i: InventoryItem): number | null {
  if (l.kind === 'oil') return litresPerUnit(i);
  if (l.kind === 'tires') return SETS.test(String(i.unit || '').trim()) ? 4 : 1;
  return 1;
}

/* what an item says of itself: the oil grade is read from its name, part number and category only (never its notes:
   « remplace la 5W-30 » is not 5W-30 oil) */
const ownText = (i: InventoryItem) => [i.name, i.sku, i.category].filter(Boolean).join(' ');
const fullText = (i: InventoryItem) => [i.name, i.sku, i.category, i.notes].filter(Boolean).join(' ');

/** the active stock items that can serve a line (the 'item' lines: that exact item, even when switched off) */
export function matchingItems(l: StockLine, inv: InventoryItem[]): InventoryItem[] {
  if (l.kind === 'item') {
    const active = inv.find((y) => y.id === l.itemId && y.active !== false && !y.deleted_at);
    const any = active || inv.find((y) => y.id === l.itemId);
    return any ? [any] : [];
  }
  if (!l.ref) return [];
  const active = inv.filter((i) => i.active !== false && !i.deleted_at);
  if (l.kind === 'oil') {
    // the same grade exactly: 15W-40 is never 5W-40
    return active.filter((i) => gradesIn(ownText(i)).includes(l.ref as string) && /huile|oil/.test(fold(ownText(i))));
  }
  if (l.kind === 'tires') {
    const size = alnum(l.ref);
    return active.filter((i) => {
      const s = seasonOf(fullText(i));
      return alnum(fullText(i)).includes(size) && (!l.season || !s || s === l.season);
    });
  }
  const ref = alnum(l.ref);
  return active.filter((i) => alnum(i.sku) === ref || alnum(fullText(i)).includes(ref));
}

/* the item names what the line asks for beyond the grade or size (the approval, the season): taken first for that line */
function names(l: StockLine, i: InventoryItem): boolean {
  if (l.kind === 'oil' && l.spec) return alnum(fullText(i)).includes(alnum(l.spec));
  if (l.kind === 'tires' && l.season) return seasonOf(fullText(i)) === l.season;
  return false;
}
const specific = (l: StockLine) => (l.kind === 'item' ? 0 : l.spec || l.season ? 1 : 2);
const firstDay = (l: StockLine) => l.jobs.reduce((d, j) => (j.day < d ? j.day : d), '9999-99-99');

/** fills stock, stockItems, toBuy and jugL of every line, sharing each item of the stock once over all the lines */
export function allocateStock(lines: StockLine[], inv: InventoryItem[]): void {
  // what is left of each item, in the item's own unit (a negative count is nothing on the shelf)
  const left = new Map<string, number>(inv.map((i) => [i.id, Math.max(0, Number(i.qty) || 0)]));
  const order = [...lines].sort((a, b) => specific(a) - specific(b) || firstDay(a).localeCompare(firstDay(b)) || a.key.localeCompare(b.key));
  for (const l of order) {
    const items = matchingItems(l, inv).sort((a, b) => Number(names(l, b)) - Number(names(l, a)));
    const sized = items.map((i) => ({ i, per: unitsPer(l, i) })).filter((x): x is { i: InventoryItem; per: number } => x.per != null && x.per > 0);
    l.stockItems = items.map((i) => i.id);
    // the items whose size is unknown (a jug with no litres) cannot be counted: the stock is what the others hold
    l.stock = sized.length ? round2(sized.reduce((n, x) => n + (left.get(x.i.id) ?? 0) * x.per, 0)) : null;
    let need = l.qty;
    for (const x of sized) {
      if (need <= 0) break;
      const have = (left.get(x.i.id) ?? 0) * x.per;
      const take = Math.min(have, need);
      need = round2(need - take);
      left.set(x.i.id, Math.max(0, (left.get(x.i.id) ?? 0) - take / x.per));
    }
    l.toBuy = round2(Math.max(0, need));
    if (l.kind === 'oil') l.jugL = sized.map((x) => x.per).find((p) => p >= 1) ?? DEFAULT_OIL_L;
  }
}
