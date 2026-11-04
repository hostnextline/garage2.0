/* Reading the device's copy: small, fast lookups the screens share. They are plain functions over the table signals,
   so a screen that calls them redraws when the data changes. */
import { computed } from '@preact/signals';
import { tableSignal, getRow, rowsOf } from './store';
import type { Settings, Staff, Truck, TruckWeek, TruckDay, Customer, Vehicle, Job, JobItem, Invoice, Payment, Service, InventoryItem, Quote, Shift, Position, Trip, EngineSpec, CustomerNote, Expense, Message, ServicePart, InventoryMove } from './types';
import { DEFAULT_BLOCKS, dow, overlapMinutes, mergeRanges, type Block, type BlockKey, type Range, type Day, nowMinute, today } from '../lib/dates';
import { totals, type Line } from '../lib/money';
import { fullName, firstName } from '../lib/text';

export const DEFAULT_SETTINGS: Settings = {
  id: '1',
  company: {}, taxes: { enabled: true, tps: 0.05, tvq: 0.09975 },
  booking: { blocks: DEFAULT_BLOCKS.map((b) => ({ ...b })), horizon_days: 120, speed_kmh: 35, detour: 1.3, stop_min: 5, unknown_min: 20, min_block_min: 45, near_km: 5,
    home: { label: 'Centrale', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5', lat: 45.5005053, lng: -73.6577429 } },
  billing: { invoice_prefix: 'F-', pad: 4, due_days: 0, hourly_cents: null, travel: { cents: 0, free_over_cents: null } },
  messages: { on: {}, fr: {}, en: {} }, role_rights: {}, waiver: { version: '1', fr: '', en: '' }, appearance: { theme: 'his', mode: 'auto' }, maps: {}, expense_categories: []
};
export const settings = computed<Settings>(() => {
  const s = tableSignal<Settings>('settings').value.get('1');
  if (!s) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...s, booking: { ...DEFAULT_SETTINGS.booking, ...(s.booking || {}) }, billing: { ...DEFAULT_SETTINGS.billing, ...(s.billing || {}) }, taxes: { ...DEFAULT_SETTINGS.taxes, ...(s.taxes || {}) } };
});
export const blocks = computed<Block[]>(() => (settings.value.booking.blocks?.length ? settings.value.booking.blocks : DEFAULT_BLOCKS) as Block[]);
export function blockOfKey(k: BlockKey): Block { return blocks.value.find((b) => b.key === k) || DEFAULT_BLOCKS.find((b) => b.key === k)!; }
export const garageName = computed(() => settings.value.company?.name || 'Mécanique Mobile H.I.S');

/* ---------- team ---------- */
export const staffList = computed(() => rowsOf<Staff>('staff').filter((s) => !s.deleted_at).sort((a, b) => a.full_name.localeCompare(b.full_name)));
export function staff(id: string | null | undefined): Staff | undefined { return getRow<Staff>('staff', id); }
export function staffName(id: string | null | undefined): string { const s = staff(id); return s ? s.short_name || firstName(s.full_name) : ''; }
export const trucks = computed(() => rowsOf<Truck>('trucks').filter((t) => !t.deleted_at).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
export const activeTrucks = computed(() => trucks.value.filter((t) => t.active));
export function truck(id: string | null | undefined): Truck | undefined { return getRow<Truck>('trucks', id); }
/** "Camion Complet (Saleh)" — the truck and who drives it */
export function truckLabel(id: string | null | undefined): string {
  const t = truck(id);
  if (!t) return '';
  const d = staffName(t.driver_id);
  return d && !t.name.toLowerCase().includes(d.toLowerCase()) ? `${t.name} (${d})` : t.name;
}
const PALETTE = ['#D3000E', '#2F6FD0', '#1F8A53', '#B86E00', '#7347D1', '#0F7C82', '#C2185B', '#5D6B78'];
export function truckColor(id: string | null | undefined): string {
  const t = truck(id);
  if (t?.color) return t.color;
  const i = trucks.value.findIndex((x) => x.id === id);
  return PALETTE[(i < 0 ? 7 : i) % PALETTE.length];
}

/* ---------- hours ---------- */
export function truckRanges(truckId: string, day: Day): Range[] {
  const d = rowsOf<TruckDay>('truck_days').find((x) => x.truck_id === truckId && x.day === day && !x.deleted_at);
  if (d) return mergeRanges(d.ranges || []);
  const w = rowsOf<TruckWeek>('truck_week').find((x) => x.truck_id === truckId && x.dow === dow(day) && !x.deleted_at);
  return mergeRanges(w?.ranges || []);
}
export function truckDayOverride(truckId: string, day: Day): TruckDay | undefined {
  return rowsOf<TruckDay>('truck_days').find((x) => x.truck_id === truckId && x.day === day && !x.deleted_at);
}
export function weekOf(truckId: string): Record<number, Range[]> {
  const out: Record<number, Range[]> = {};
  for (let i = 0; i < 7; i++) out[i] = [];
  for (const w of rowsOf<TruckWeek>('truck_week')) if (w.truck_id === truckId && !w.deleted_at) out[w.dow] = mergeRanges(w.ranges || []);
  return out;
}
export interface TruckBlock { truck: Truck; cap: number; used: number; left: number; jobs: Job[] }
/** how full a block is, per truck: the hours the truck works in it, and what its jobs take (durations + driving) */
export function blockLoad(day: Day, block: BlockKey): { trucks: TruckBlock[]; unplaced: Job[]; open: boolean; left: number; started: boolean } {
  const b = blockOfKey(block);
  const isToday = day === today();
  const started = day < today() || (isToday && nowMinute() >= b.start);
  const from = isToday ? Math.ceil(nowMinute() / 5) * 5 : 0;
  const js = jobsOn(day).filter((j) => j.block === block && !['cancelled', 'no_show'].includes(j.status));
  const out: TruckBlock[] = [];
  for (const tr of activeTrucks.value) {
    const rs = truckRanges(tr.id, day).map(([a, z]) => [Math.max(a, from), z] as Range).filter(([a, z]) => z > a);
    const cap = day < today() ? 0 : overlapMinutes(rs, b.start, b.end);
    const mine = js.filter((j) => j.truck_id === tr.id).sort((x, y) => (x.stop_order ?? 99) - (y.stop_order ?? 99));
    const used = mine.filter((j) => j.status !== 'done').reduce((n, j) => n + j.duration_min + (j.travel_min ?? settings.value.booking.unknown_min), 0);
    if (cap > 0 || mine.length) out.push({ truck: tr, cap, used, left: cap - used, jobs: mine });
  }
  const minBlock = Math.min(settings.value.booking.min_block_min, b.end - b.start);
  const open = !started && out.some((x) => x.cap >= minBlock);
  return { trucks: out, unplaced: js.filter((j) => !j.truck_id), open, left: Math.max(0, ...out.map((x) => x.left)), started };
}

/* ---------- customers, cars ---------- */
export function customer(id: string | null | undefined): Customer | undefined { return getRow<Customer>('customers', id); }
export function customerName(c: Customer | null | undefined): string {
  if (!c) return '';
  return fullName(c.first_name, c.last_name) || c.company || '';
}
export const customersList = computed(() => rowsOf<Customer>('customers').filter((c) => !c.deleted_at).sort((a, b) => customerName(a).localeCompare(customerName(b), 'fr')));
export function vehicle(id: string | null | undefined): Vehicle | undefined { return getRow<Vehicle>('vehicles', id); }
export function vehiclesOf(customerId: string): Vehicle[] { return rowsOf<Vehicle>('vehicles').filter((v) => v.customer_id === customerId && !v.deleted_at); }
export function vehicleLabel(v: Vehicle | null | undefined): string { return v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : ''; }
export function notesOf(customerId: string): CustomerNote[] { return rowsOf<CustomerNote>('customer_notes').filter((n) => n.customer_id === customerId && !n.deleted_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); }
export function specByKey(key: string | null | undefined): EngineSpec | undefined { return key ? rowsOf<EngineSpec>('engine_specs').find((s) => s.key === key && !s.deleted_at) : undefined; }

/* ---------- jobs ---------- */
export const allJobs = computed(() => rowsOf<Job>('jobs').filter((j) => !j.deleted_at));
export function job(id: string | null | undefined): Job | undefined { return getRow<Job>('jobs', id); }
export function jobsOn(day: Day): Job[] {
  const order: Record<string, number> = { am: 0, pm: 1, eve: 2 };
  return allJobs.value.filter((j) => j.day === day).sort((a, b) => (order[a.block] - order[b.block]) || ((a.stop_order ?? 99) - (b.stop_order ?? 99)) || a.number - b.number);
}
export function jobsBetween(from: Day, to: Day): Job[] { return allJobs.value.filter((j) => j.day >= from && j.day <= to); }
export function jobsOfCustomer(customerId: string): Job[] { return allJobs.value.filter((j) => j.customer_id === customerId).sort((a, b) => b.day.localeCompare(a.day)); }
export function itemsOf(jobId: string): JobItem[] { return rowsOf<JobItem>('job_items').filter((i) => i.job_id === jobId && !i.deleted_at).sort((a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at))); }
/** what the work is worth with taxes: booked/done/accepted lines */
export function jobTotals(jobId: string) {
  const lines: Line[] = itemsOf(jobId).filter((i) => ['planned', 'done', 'approved'].includes(i.status)).map((i) => ({ qty: Number(i.qty), unitCents: (i.kind === 'discount' ? -1 : 1) * Math.abs(i.unit_cents), taxable: i.taxable }));
  return totals(lines, settings.value.taxes);
}
export function invoiceOf(jobId: string): Invoice | undefined {
  return rowsOf<Invoice>('invoices').find((v) => v.job_id === jobId && v.status !== 'void' && !v.deleted_at);
}
export function paymentsOf(opts: { invoiceId?: string; jobId?: string }): Payment[] {
  return rowsOf<Payment>('payments').filter((p) => !p.deleted_at && ((opts.invoiceId && p.invoice_id === opts.invoiceId) || (opts.jobId && p.job_id === opts.jobId)));
}
export function invoiceNumber(v: Pick<Invoice, 'number'> | null | undefined): string {
  if (!v || v.number == null) return '';
  const b = settings.value.billing;
  return `${b.invoice_prefix ?? 'F-'}${String(v.number).padStart(Number(b.pad ?? 4), '0')}`;
}
export const invoicesList = computed(() => rowsOf<Invoice>('invoices').filter((v) => !v.deleted_at));
export function activeTrip(jobId: string): Trip | undefined { return rowsOf<Trip>('trips').find((t) => t.job_id === jobId && t.status === 'active'); }
export function messagesOf(jobId: string): Message[] { return rowsOf<Message>('messages').filter((m) => m.job_id === jobId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); }

/* ---------- services, inventory, quotes, treasury ---------- */
export const servicesList = computed(() => rowsOf<Service>('services').filter((s) => !s.deleted_at).sort((a, b) => (Number(b.is_promo) - Number(a.is_promo)) || a.sort - b.sort || a.name_fr.localeCompare(b.name_fr, 'fr')));
export const activeServices = computed(() => servicesList.value.filter((s) => s.active && (!s.promo_until || s.promo_until >= today())));
export function service(id: string | null | undefined): Service | undefined { return getRow<Service>('services', id); }
export function serviceName(s: Service, l: string): string { return (l === 'en' && s.name_en) || s.name_fr; }
export function partsOfService(serviceId: string): ServicePart[] { return rowsOf<ServicePart>('service_parts').filter((p) => p.service_id === serviceId && !p.deleted_at); }
export const inventoryList = computed(() => rowsOf<InventoryItem>('inventory_items').filter((i) => !i.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'fr')));
export const lowStock = computed(() => inventoryList.value.filter((i) => i.active && (i.min_qty != null ? Number(i.qty) <= Number(i.min_qty) : Number(i.qty) <= 0)));
export function movesOf(itemId: string): InventoryMove[] { return rowsOf<InventoryMove>('inventory_moves').filter((m) => m.item_id === itemId && !m.deleted_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); }
export const quotesList = computed(() => rowsOf<Quote>('quotes').filter((q) => !q.deleted_at).sort((a, b) => b.number - a.number));
export const expensesList = computed(() => rowsOf<Expense>('expenses').filter((e) => !e.deleted_at).sort((a, b) => b.day.localeCompare(a.day)));

/* ---------- the day ---------- */
export function openShift(staffId: string | null | undefined): Shift | undefined { return rowsOf<Shift>('shifts').find((s) => s.staff_id === staffId && !s.ended_at && !s.deleted_at); }
export function positionOf(staffId: string | null | undefined): Position | undefined { const p = getRow<Position>('positions', staffId); return p && !p.deleted_at ? p : undefined; }
