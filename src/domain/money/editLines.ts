/* Lines as the editor holds them: each one carries a key for the screen (removed before saving, see cleanLine).
   The keys must survive a version coming back from the server, or every input is rebuilt and the field being
   typed in loses the focus (the phone's keyboard closes). Pure, tested in editLines.test.ts. */
import type { ItemKind } from '../../data/types';
import type { ItemDraft } from '../moment/logic';
import type { LineLike } from './invoice';

export interface EditLine {
  _k: string; description: string; qty: number; unit_cents: number; taxable: boolean; kind?: ItemKind;
  /** on an invoice: the job line it bills (job_items.id) */
  item_id?: string; service_id?: string | null; duration_min?: number | null;
}
let seq = 0;
const key = () => `l${Date.now().toString(36)}${(++seq).toString(36)}`;

/** gives each line a key for the screen */
export function withKeys<T extends LineLike>(lines: T[] | null | undefined): EditLine[] {
  return (lines || []).map((l) => ({ ...(l as unknown as EditLine), qty: Number(l.qty ?? 1), unit_cents: Number(l.unit_cents ?? 0), taxable: l.taxable !== false, description: String(l.description ?? ''), _k: key() }));
}
export function newLine(kind: ItemKind = 'service', description = ''): EditLine {
  return { _k: key(), description, qty: 1, unit_cents: 0, taxable: true, kind };
}
/** services picked in the price list, as lines */
export function fromDrafts(items: ItemDraft[]): EditLine[] {
  return items.map((i) => ({
    _k: key(), description: i.description, qty: Number(i.qty || 1), unit_cents: Number(i.unit_cents || 0), taxable: i.taxable !== false,
    kind: i.kind || 'service', service_id: i.service_id ?? null, duration_min: i.duration_min ?? null
  }));
}
/** the server's lines with the keys they had on screen: the same job line keeps its key, else the line at the same place */
export function keepKeys(next: EditLine[], shown: EditLine[]): EditLine[] {
  const used = new Set<string>();
  const byItem = new Map<string, string>();
  for (const l of shown) if (l.item_id && !byItem.has(l.item_id)) byItem.set(l.item_id, l._k);
  const free = (k: string | undefined) => (k && !used.has(k) ? k : undefined);
  return next.map((l, i) => {
    const same = shown[i];
    // a job line keeps the key of the same job line; a line written by hand, the key of the hand line at its place
    const k = (l.item_id ? free(byItem.get(l.item_id)) : same && !same.item_id ? free(same._k) : undefined) ?? l._k;
    used.add(k);
    return k === l._k ? l : { ...l, _k: k };
  });
}
