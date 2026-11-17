/* Reading the device's copy: small, fast lookups the screens share. They are plain functions over the table signals,
   so a screen that calls them redraws when the data changes. The lookups by a parent (a job's lines, a customer's
   cars, a day's jobs…) read indexes built once per change of their table, not a scan of the whole table per call:
   a list of hundreds of rows asking each row's lines stays fast (core-data-40). Lists are returned as copies. */
import { computed, effect, type ReadonlySignal } from '@preact/signals';
import { tableSignal, getRow, rowsOf, type Row } from './store';
import type { TableName } from './schema';
import type { Settings, Staff, Truck, TruckWeek, TruckDay, Customer, Vehicle, Job, JobItem, Invoice, Payment, Service, InventoryItem, Quote, Shift, Position, Trip, EngineSpec, CustomerNote, Expense, Message, ServicePart, InventoryMove } from './types';
import { DEFAULT_BLOCKS, windowFor, dow, overlapMinutes, mergeRanges, type Block, type BlockKey, type Range, type Day, nowMinute, today } from '../lib/dates';
import { totals, type Line } from '../lib/money';
import { fullName, firstName } from '../lib/text';
import { setDayMode } from '../lib/errors';

export const DEFAULT_SETTINGS: Settings = {
  id: '1',
  company: {}, taxes: { enabled: true, tps: 0.05, tvq: 0.09975 },
  booking: { blocks: DEFAULT_BLOCKS.map((b) => ({ ...b })), horizon_days: 120, speed_kmh: 35, detour: 1.3, stop_min: 5, unknown_min: 20, min_block_min: 45, near_km: 5, max_hop_min: 35, max_day_drive_min: 105,
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
export function blockOfKey(k: BlockKey): Block {
  if (k === 'day') return { key: 'day', start: Math.min(...blocks.value.map((b) => b.start)), end: Math.max(...blocks.value.map((b) => b.end)) };
  return blocks.value.find((b) => b.key === k) || DEFAULT_BLOCKS.find((b) => b.key === k)!;
}
/** the garage books by 4-hour arrival windows (Part 25) */
export const windowsOn = computed<boolean>(() => settings.value.booking.windows_on === true);
// the refusals of a block (« complet », « fermé ») then say « journée » (lib/errors cannot read the settings: R144)
effect(() => { setDayMode(windowsOn.value); });
/** the span of a booking day: first block's start → last block's end */
export const daySpan = computed<Range>(() => [Math.min(...blocks.value.map((b) => b.start)), Math.max(...blocks.value.map((b) => b.end))]);
/** the window told to this customer: its own (windows), else its block's hours; a « flexible » job: the whole day */
export function jobWindow(j: Pick<Job, 'block' | 'win_start' | 'win_end'>): Range {
  if (j.win_start != null && j.win_end != null) return [j.win_start, j.win_end];
  if (j.block === 'day') return daySpan.value;
  const b = blockOfKey(j.block);
  return [b.start, b.end];
}
/** the window to offer for an estimated arrival, with the garage's settings */
export function windowOf(eta: number): Range {
  const b = settings.value.booking;
  return windowFor(eta, { before: b.win_before_min, after: b.win_after_min, round: b.win_round_min, dayStart: daySpan.value[0], dayEnd: daySpan.value[1] });
}
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

/* ---------- indexes ---------- */
/** rows of a table grouped by a key, in the table's order (then sorted when asked) */
function groupBy<T extends Row>(t: TableName, key: (r: T) => unknown, keep: (r: T) => boolean = () => true, sort?: (a: T, b: T) => number): ReadonlySignal<Map<string, T[]>> {
  return computed(() => {
    const m = new Map<string, T[]>();
    for (const r of tableSignal<T>(t).value.values()) {
      if (!keep(r)) continue;
      const k = key(r);
      if (k == null) continue;
      const l = m.get(String(k));
      if (l) l.push(r); else m.set(String(k), [r]);
    }
    if (sort) for (const l of m.values()) l.sort(sort);
    return m;
  });
}
/** the first row of a table for each key, in the table's order */
function firstBy<T extends Row>(t: TableName, key: (r: T) => unknown, keep: (r: T) => boolean = () => true): ReadonlySignal<Map<string, T>> {
  return computed(() => {
    const m = new Map<string, T>();
    for (const r of tableSignal<T>(t).value.values()) {
      if (!keep(r)) continue;
      const k = key(r);
      if (k != null && !m.has(String(k))) m.set(String(k), r);
    }
    return m;
  });
}
const alive = (r: Row) => !r.deleted_at;
const newest = (a: { created_at?: string }, b: { created_at?: string }) => String(b.created_at).localeCompare(String(a.created_at));
const list = <T>(m: Map<string, T[]>, k: string | null | undefined): T[] => (k == null ? [] : (m.get(k) || []).slice());

const truckDayByKey = firstBy<TruckDay>('truck_days', (x) => `${x.truck_id}|${x.day}`, alive);
const truckWeekByKey = firstBy<TruckWeek>('truck_week', (x) => `${x.truck_id}|${x.dow}`, alive);

/* ---------- hours ---------- */
export function truckRanges(truckId: string, day: Day): Range[] {
  const d = truckDayByKey.value.get(`${truckId}|${day}`);
  if (d) return mergeRanges(d.ranges || []);
  const w = truckWeekByKey.value.get(`${truckId}|${dow(day)}`);
  return mergeRanges(w?.ranges || []);
}
export function weekOf(truckId: string): Record<number, Range[]> {
  const out: Record<number, Range[]> = {};
  for (let i = 0; i < 7; i++) out[i] = [];
  for (const w of rowsOf<TruckWeek>('truck_week')) if (w.truck_id === truckId && !w.deleted_at) out[w.dow] = mergeRanges(w.ranges || []);
  return out;
}
export interface TruckBlock { truck: Truck; cap: number; used: number; left: number; jobs: Job[] }
/** how full a block is, per truck: the hours the truck works in it, and what its jobs take (durations + driving) */
export function blockLoad(day: Day, block: BlockKey, opts: { exclude?: string | null } = {}): { trucks: TruckBlock[]; unplaced: Job[]; open: boolean; left: number; started: boolean } {
  const b = blockOfKey(block);
  const isToday = day === today();
  // a block has started at its first minute; a whole day of arrival windows (block 'day') stays open until too little of it is left
  const minBlock = Math.min(settings.value.booking.min_block_min, b.end - b.start);
  const started = day < today() || (isToday && nowMinute() >= (block === 'day' ? b.end - minBlock : b.start));
  const from = isToday ? Math.ceil(nowMinute() / 5) * 5 : 0;
  const js = jobsOn(day).filter((j) => j.block === block && !['cancelled', 'no_show'].includes(j.status) && j.id !== opts.exclude);
  const out: TruckBlock[] = [];
  for (const tr of activeTrucks.value) {
    const rs = truckRanges(tr.id, day).map(([a, z]) => [Math.max(a, from), z] as Range).filter(([a, z]) => z > a);
    const cap = day < today() ? 0 : overlapMinutes(rs, b.start, b.end);
    const mine = js.filter((j) => j.truck_id === tr.id).sort((x, y) => ((x.stop_order ?? 99) - (y.stop_order ?? 99)) || ((x.eta_min ?? 9999) - (y.eta_min ?? 9999)));
    const used = mine.filter((j) => j.status !== 'done').reduce((n, j) => n + j.duration_min + (j.travel_min ?? settings.value.booking.unknown_min), 0);
    if (cap > 0 || mine.length) out.push({ truck: tr, cap, used, left: cap - used, jobs: mine });
  }
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
const vehiclesByCustomer = groupBy<Vehicle>('vehicles', (v) => v.customer_id, alive);
const notesByCustomer = groupBy<CustomerNote>('customer_notes', (n) => n.customer_id, alive, newest);
const specsByKey = firstBy<EngineSpec>('engine_specs', (s) => s.key, alive);
export function vehicle(id: string | null | undefined): Vehicle | undefined { return getRow<Vehicle>('vehicles', id); }
export function vehiclesOf(customerId: string): Vehicle[] { return list(vehiclesByCustomer.value, customerId); }
export function vehicleLabel(v: Vehicle | null | undefined): string { return v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : ''; }
export function notesOf(customerId: string): CustomerNote[] { return list(notesByCustomer.value, customerId); }
export function specByKey(key: string | null | undefined): EngineSpec | undefined { return key ? specsByKey.value.get(key) : undefined; }

/* ---------- jobs ---------- */
export const allJobs = computed(() => rowsOf<Job>('jobs').filter((j) => !j.deleted_at));
export function job(id: string | null | undefined): Job | undefined { return getRow<Job>('jobs', id); }
/** the day's jobs in order. Blocks: morning, afternoon, evening, then the stop. « Plages d'arrivée » (block 'day'): the stop,
    then the planned arrival. A day holding both (never after the switch, kept safe): each 'day' job goes with the block its
    arrival falls in, after that block's own jobs. */
const jobsByDay = computed(() => {
  const m = new Map<string, Job[]>();
  for (const j of allJobs.value) { const l = m.get(j.day); if (l) l.push(j); else m.set(j.day, [j]); }
  const order = dayOrder(blocks.value);
  for (const l of m.values()) l.sort(order);
  return m;
});
export function jobsOn(day: Day): Job[] {
  return list(jobsByDay.value, day);
}
const BLOCK_RANK: Record<string, number> = { am: 0, pm: 1, eve: 2 };
/** when a 'day' job is expected: its planned arrival, else the start of its window (none: last) */
const dayMinute = (j: Pick<Job, 'eta_min' | 'win_start'>) => j.eta_min ?? j.win_start ?? 9999;
export function dayOrder(bl: Block[] = DEFAULT_BLOCKS) {
  const rank = (j: Pick<Job, 'block' | 'eta_min' | 'win_start'>): number => {
    if (j.block !== 'day') return BLOCK_RANK[j.block] ?? 9;
    const m = dayMinute(j);
    const named = bl.filter((b) => b.key !== 'day').sort((x, y) => x.start - y.start);
    let r = 0;
    named.forEach((b) => { if (m >= b.start) r = BLOCK_RANK[b.key] ?? r; });
    return m >= 9999 ? 9 : r;
  };
  return (a: Job, b: Job): number => {
    if (a.block === 'day' && b.block === 'day') return ((a.stop_order ?? 99) - (b.stop_order ?? 99)) || (dayMinute(a) - dayMinute(b)) || a.number - b.number;
    if (a.block !== 'day' && b.block !== 'day') return ((BLOCK_RANK[a.block] ?? 9) - (BLOCK_RANK[b.block] ?? 9)) || ((a.stop_order ?? 99) - (b.stop_order ?? 99)) || a.number - b.number;
    return (rank(a) - rank(b)) || (a.block === 'day' ? 1 : -1);
  };
}
export function jobsBetween(from: Day, to: Day): Job[] { return allJobs.value.filter((j) => j.day >= from && j.day <= to); }
const jobsByCustomer = computed(() => {
  const m = new Map<string, Job[]>();
  for (const j of allJobs.value) { if (j.customer_id == null) continue; const l = m.get(j.customer_id); if (l) l.push(j); else m.set(j.customer_id, [j]); }
  for (const l of m.values()) l.sort((a, b) => b.day.localeCompare(a.day));
  return m;
});
export function jobsOfCustomer(customerId: string): Job[] { return list(jobsByCustomer.value, customerId); }
const itemsByJob = groupBy<JobItem>('job_items', (i) => i.job_id, alive, (a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)));
export function itemsOf(jobId: string): JobItem[] { return list(itemsByJob.value, jobId); }
/** the line's own total sign, as the server counts it (invoice_totals): a discount is negative, any other line keeps
    the sign it was given (a credit typed as a negative price stays a credit: core-data-23) */
export function lineCents(i: Pick<JobItem, 'kind' | 'unit_cents'>): number {
  return i.kind === 'discount' ? -Math.abs(Number(i.unit_cents)) : Number(i.unit_cents);
}
/** what the work is worth with taxes: booked/done/accepted lines */
export function jobTotals(jobId: string) {
  const lines: Line[] = itemsOf(jobId).filter((i) => ['planned', 'done', 'approved'].includes(i.status)).map((i) => ({ qty: Number(i.qty), unitCents: lineCents(i), taxable: i.taxable }));
  return totals(lines, settings.value.taxes);
}
const invoiceByJob = firstBy<Invoice>('invoices', (v) => v.job_id, (v) => v.status !== 'void' && !v.deleted_at);
export function invoiceOf(jobId: string): Invoice | undefined {
  return invoiceByJob.value.get(jobId);
}
/** the payments with their place in the table, so the two lookups below merge in the table's order */
const paymentPlace = computed(() => { const m = new Map<string, number>(); let i = 0; for (const id of tableSignal('payments').value.keys()) m.set(id, i++); return m; });
const paymentsByInvoice = groupBy<Payment>('payments', (p) => p.invoice_id, alive);
const paymentsByJob = groupBy<Payment>('payments', (p) => p.job_id, alive);
export function paymentsOf(opts: { invoiceId?: string; jobId?: string }): Payment[] {
  const a = opts.invoiceId ? paymentsByInvoice.value.get(opts.invoiceId) || [] : [];
  const b = opts.jobId ? paymentsByJob.value.get(opts.jobId) || [] : [];
  if (!b.length) return a.slice();
  if (!a.length) return b.slice();
  const place = paymentPlace.value;
  return [...new Set([...a, ...b])].sort((x, y) => (place.get(x.id) ?? 0) - (place.get(y.id) ?? 0));
}
export function invoiceNumber(v: Pick<Invoice, 'number'> | null | undefined): string {
  if (!v || v.number == null) return '';
  const b = settings.value.billing;
  return `${b.invoice_prefix ?? 'F-'}${String(v.number).padStart(Number(b.pad ?? 4), '0')}`;
}
export const invoicesList = computed(() => rowsOf<Invoice>('invoices').filter((v) => !v.deleted_at));
const activeTripByJob = firstBy<Trip>('trips', (t) => t.job_id, (t) => t.status === 'active');
export function activeTrip(jobId: string): Trip | undefined { return activeTripByJob.value.get(jobId); }
/** this person's trip back to the start, still on (« Retour à la Centrale ») */
export function activeReturnTrip(staffId: string): Trip | undefined {
  return rowsOf<Trip>('trips').find((t) => t.staff_id === staffId && t.kind === 'return' && t.status === 'active' && !t.deleted_at && Date.parse(t.expires_at) > Date.now());
}
const messagesByJob = groupBy<Message>('messages', (m) => m.job_id, () => true, newest);
export function messagesOf(jobId: string): Message[] { return list(messagesByJob.value, jobId); }

/* ---------- services, inventory, quotes, treasury ---------- */
export const servicesList = computed(() => rowsOf<Service>('services').filter((s) => !s.deleted_at).sort((a, b) => (Number(b.is_promo) - Number(a.is_promo)) || a.sort - b.sort || a.name_fr.localeCompare(b.name_fr, 'fr')));
export const activeServices = computed(() => servicesList.value.filter((s) => s.active && (!s.promo_until || s.promo_until >= today())));
export function service(id: string | null | undefined): Service | undefined { return getRow<Service>('services', id); }
export function serviceName(s: Service, l: string): string { return (l === 'en' && s.name_en) || s.name_fr; }
const partsByService = groupBy<ServicePart>('service_parts', (p) => p.service_id, alive);
export function partsOfService(serviceId: string): ServicePart[] { return list(partsByService.value, serviceId); }
/** the garage's stock (the Coffre's own stock is apart: never in the garage's lists, value, orders, week's needs or services) */
export const inventoryList = computed(() => rowsOf<InventoryItem>('inventory_items').filter((i) => !i.deleted_at && i.pool !== 'coffre').sort((a, b) => a.name.localeCompare(b.name, 'fr')));
/** the Coffre's own stock (bought with the Coffre's money, no taxes) */
export const coffreStock = computed(() => rowsOf<InventoryItem>('inventory_items').filter((i) => !i.deleted_at && i.pool === 'coffre').sort((a, b) => a.name.localeCompare(b.name, 'fr')));
export const lowStock = computed(() => inventoryList.value.filter((i) => i.active && (i.min_qty != null ? Number(i.qty) <= Number(i.min_qty) : Number(i.qty) <= 0)));
const movesByItem = groupBy<InventoryMove>('inventory_moves', (m) => m.item_id, alive, newest);
export function movesOf(itemId: string): InventoryMove[] { return list(movesByItem.value, itemId); }
export const quotesList = computed(() => rowsOf<Quote>('quotes').filter((q) => !q.deleted_at).sort((a, b) => b.number - a.number));
export const expensesList = computed(() => rowsOf<Expense>('expenses').filter((e) => !e.deleted_at).sort((a, b) => b.day.localeCompare(a.day)));

/* ---------- the day ---------- */
export function openShift(staffId: string | null | undefined): Shift | undefined { return rowsOf<Shift>('shifts').find((s) => s.staff_id === staffId && !s.ended_at && !s.deleted_at); }
export function positionOf(staffId: string | null | undefined): Position | undefined { const p = getRow<Position>('positions', staffId); return p && !p.deleted_at ? p : undefined; }
