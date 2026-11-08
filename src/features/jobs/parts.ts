/* The parts a job is expected to use, from its lines: a line that is an inventory item itself (item_id), and the parts
   each service takes (service_parts × the line's quantity). Pure; the sheet « Pièces utilisées » shows this list when
   the job is finished, the mechanic confirms the real quantities, and the server takes them off the inventory. */
import type { JobItem, ServicePart, InventoryItem } from '../../data/types';
import { itemsOf, partsOfService } from '../../data/select';
import { getRow } from '../../data/store';
import { BILLABLE } from './nextStep';

export interface PlannedPart { item_id: string; name: string; unit: string; qty: number; onHand: number }
export interface UsedPart { item_id: string; qty: number }

type Line = Pick<JobItem, 'item_id' | 'service_id' | 'qty' | 'status'> & { deleted_at?: string | null };
type Item = Pick<InventoryItem, 'id' | 'name' | 'unit' | 'qty' | 'deleted_at'>;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function plannedPartsOf(lines: Line[], partsOf: (serviceId: string) => Pick<ServicePart, 'item_id' | 'qty'>[], itemOf: (id: string) => Item | undefined): PlannedPart[] {
  const need = new Map<string, number>();
  const add = (id: string | null | undefined, q: number) => { if (id && q > 0) need.set(id, (need.get(id) || 0) + q); };
  for (const l of lines) {
    if (l.deleted_at || !BILLABLE.includes(l.status)) continue;
    const q = Number(l.qty) || 1;
    if (l.item_id) add(l.item_id, q);
    if (l.service_id) for (const p of partsOf(l.service_id)) add(p.item_id, Number(p.qty) * q);
  }
  const out: PlannedPart[] = [];
  for (const [id, qty] of need) {
    const it = itemOf(id);
    if (!it || it.deleted_at) continue;   // an item removed meanwhile: nothing to take off
    out.push({ item_id: id, name: it.name, unit: it.unit || 'unité', qty: round2(qty), onHand: Number(it.qty) || 0 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** the parts planned for this job, from the phone's copy of the data */
export function plannedParts(jobId: string): PlannedPart[] {
  return plannedPartsOf(itemsOf(jobId), partsOfService, (id) => getRow<InventoryItem>('inventory_items', id));
}
