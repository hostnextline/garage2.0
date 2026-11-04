/* STUB (owner: booking) — the services of the price list as tappable rows (promos first), quantities, a free line;
   used by booking, estimates and the job sheet (« Ajouter du travail »). */
import type { ItemKind } from '../../data/types';
export interface ItemDraft {
  id?: string; kind: ItemKind; service_id: string | null; item_id?: string | null; description: string; qty: number; unit_cents: number;
  taxable: boolean; duration_min: number | null; note?: string | null;
}
export interface ServicePickerProps { value: ItemDraft[]; onValue: (items: ItemDraft[]) => void; lang?: 'fr' | 'en'; allowCustom?: boolean }
export function ServicePicker(_p: ServicePickerProps) { return null; }
/** minutes of work of the chosen lines (services without a duration count 45 min) */
export function itemsDuration(items: ItemDraft[]): number { return items.reduce((n, i) => n + (i.duration_min ?? (i.kind === 'service' ? 45 : 0)) * (i.kind === 'service' ? Math.max(1, i.qty) : 1), 0); }
