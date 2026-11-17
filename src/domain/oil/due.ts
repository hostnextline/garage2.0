/* « Rappels d’huile »: which cars are due for an oil change, so someone calls their owner. Hassan's rule:
   - the car's last oil change (ours, or the day the customer gave: « Dernier changement d’huile » on the car): call 6 months after it;
   - the last visit had none: call 3 months after that visit (never before 6 months after the last oil change we did).
   A car that already has a coming appointment with an oil change is not listed. What was said at the last call lives on
   the car (`vehicles.oil_followup`, followup.ts): call back on a day, or stop calling for this car; a newer visit makes it
   old. A visit a person said had no oil change never counts as one.
   Pure: no screen, no server (tested in due.test.ts). The words are read in words.ts. */
import { addDays, addMonths, dayOf, daysBetween, type BlockKey, type Day } from '../../lib/dates';
import type { Customer, InventoryItem, InventoryMove, Job, JobItem, Service, Vehicle } from '../../data/types';
import { litresPerUnit } from '../stock/needs';
import { COUNTED, isOilItem, isOilStock, oilOnlyAdded } from './words';
import { callOf, deniedJobs, followupOf, type OilCall } from './followup';

export { oilWords, oilOnlyAdded, isOilService, isOilItem, isOilStock } from './words';
export { deniedJobs } from './followup';

export const AFTER_OIL_MONTHS = 6;
const AFTER_VISIT_MONTHS = 3;
const SOON_DAYS = 30;
/** the least oil taken from the stock that says « oil change » rather than « top-up », in litres */
const FULL_CHANGE_L = 3;

type OilState = 'call' | 'soon' | 'later' | 'stopped';
export interface OilRow {
  /** the car's id, or « c:<customer> » for visits with no car on them (a customer with several cars) */
  key: string;
  customerId: string;
  vehicleId: string | null;
  /** the last finished visit with an oil change, and the last finished visit of any kind */
  lastOil: Day | null;
  /** null: the car never came, only the day its owner gave is known */
  lastVisit: Day | null;
  /** when the oil change is due by the rule */
  due: Day;
  /** when to call: the due day, or later when the customer asked to be called back */
  callOn: Day;
  state: OilState;
  /** days since `callOn` (0 or less: not yet) */
  late: number;
  /** the coming appointment (it has no oil change, or the car would not be listed);
      booked by arrival window (block 'day'): the window told to the customer */
  next: { jobId: string; day: Day; block: BlockKey; win_start?: number | null; win_end?: number | null; win_flex?: boolean } | null;
  /** what was said at the last call, when it still counts */
  mark: OilCall | null;
  /** our visit that counts as the last oil change (null when the day comes from the customer, or there is none) */
  oilJob: string | null;
  /** the last finished visit, and whether a person said it had no oil change though the app read one */
  lastVisitJob: string | null;
  lastVisitDenied: boolean;
  /** the day the customer gave for the car (« Dernier changement d’huile »), when it is the one that counts */
  saidOn: Day | null;
}
export interface OilInput {
  today: Day;
  jobs: Job[]; items: JobItem[]; services: Service[]; vehicles: Vehicle[]; customers: Customer[];
  /** the stock taken by the jobs (« Pièces utilisées »): a job that used engine oil had an oil change, whatever its lines say */
  moves?: InventoryMove[]; stock?: InventoryItem[];
  /** the appointments with an oil change, when the caller already worked them out (oilJobIds) */
  oilJobs?: Set<string>;
}

/** the garage's (Montréal) day of an instant, whatever the phone's zone (R169) */
function localDay(iso: string | null | undefined): Day | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return dayOf(d) || null;
}

/** when a car is due: 6 months after a visit with an oil change, 3 months after a visit without */
export function dueDay(lastVisit: Day, lastOil: Day | null): Day {
  if (lastOil && lastOil >= lastVisit) return addMonths(lastOil, AFTER_OIL_MONTHS);
  const d = addMonths(lastVisit, AFTER_VISIT_MONTHS);
  const o = lastOil ? addMonths(lastOil, AFTER_OIL_MONTHS) : d;
  return o > d ? o : d;
}

/** the appointments (finished or not) that have an oil change. Engine oil of the stock counts from 3 litres (less is a
    top-up), and not on a job whose line says the oil was only added or checked; a person's « no oil change » wins */
export function oilJobIds(items: JobItem[], services: Service[], moves: InventoryMove[] = [], stock: InventoryItem[] = [], denied: Set<string> = new Set()): Set<string> {
  const map = new Map(services.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const i of items) if (!i.deleted_at && isOilItem(i, map)) out.add(i.job_id);
  const oil = new Map(stock.filter((it) => !it.deleted_at && isOilStock(it)).map((it) => [it.id, it]));
  const topUp = new Set(items.filter((i) => !i.deleted_at && COUNTED.has(i.status) && oilOnlyAdded(i.description)).map((i) => i.job_id));
  // a bottle whose size is not known counts as an oil change's worth (as before the 3-litre rule)
  const litresOf = (itemId: string, qty: number) => { const it = oil.get(itemId); if (!it || !(qty > 0)) return 0; return qty * (litresPerUnit(it) ?? FULL_CHANGE_L); };
  // the oil really taken at the end of the job (« Pièces utilisées ») already holds what its lines sold: read one or the
  // other, never both (2 L sold + the same 2 L taken is not 4 L)
  const used = new Map<string, number>();
  // (only engine oil taken counts: a job whose « Pièces utilisées » hold only the filter still reads the oil its lines sold)
  for (const m of moves) {
    if (m.deleted_at || !m.job_id || m.reason !== 'used') continue;
    const l = litresOf(m.item_id, -Number(m.delta));
    if (l > 0) used.set(m.job_id, (used.get(m.job_id) || 0) + l);
  }
  const sold = new Map<string, number>();
  for (const i of items) if (!i.deleted_at && i.item_id && COUNTED.has(i.status) && !used.has(i.job_id)) sold.set(i.job_id, (sold.get(i.job_id) || 0) + litresOf(i.item_id, Number(i.qty ?? 1)));
  for (const [jobId, l] of [...used, ...sold]) if (l >= FULL_CHANGE_L && !topUp.has(jobId)) out.add(jobId);
  for (const id of denied) out.delete(id);
  return out;
}

/** the customers' cars still on file, to give a visit booked without a car to the customer's only car */
function carsByCustomer(vehicles: Pick<Vehicle, 'id' | 'customer_id' | 'deleted_at'>[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const v of vehicles) if (!v.deleted_at && v.customer_id) m.set(v.customer_id, [...(m.get(v.customer_id) || []), v.id]);
  return m;
}
/** the car of a visit: its own, else (no car on it) the customer's car when the customer has exactly one */
function carOf(j: Pick<Job, 'vehicle_id' | 'customer_id'>, cars: Map<string, string[]>): string | null {
  if (j.vehicle_id) return j.vehicle_id;
  const mine = j.customer_id ? cars.get(j.customer_id) : undefined;
  return mine && mine.length === 1 ? mine[0] : null;
}

/** each car's last oil change done by us (a finished visit with one) */
export function lastOursByCar(jobs: Job[], oilJobs: Set<string>, vehicles: Pick<Vehicle, 'id' | 'customer_id' | 'deleted_at'>[]): Map<string, Day> {
  const cars = carsByCustomer(vehicles);
  const out = new Map<string, Day>();
  for (const j of jobs) {
    if (j.deleted_at || j.status !== 'done' || !oilJobs.has(j.id)) continue;
    const car = carOf(j, cars);
    if (car && (!out.has(car) || j.day > (out.get(car) as Day))) out.set(car, j.day);
  }
  return out;
}
/** a car's last oil change from our own day and the day its owner gave; `ours`: it was us */
export function lastOilFrom(v: Pick<Vehicle, 'last_oil_on'>, ours: Day | null | undefined, today: Day): { day: Day; ours: boolean } | null {
  const said = v.last_oil_on && v.last_oil_on <= today ? v.last_oil_on : null;
  if (ours && (!said || ours >= said)) return { day: ours, ours: true };
  return said ? { day: said, ours: false } : null;
}
/** a car's last oil change: the latest of our finished visits with one and the day its owner gave; `ours`: it was us */
export function lastOilOf(v: Pick<Vehicle, 'id' | 'last_oil_on' | 'oil_followup'> & Partial<Pick<Vehicle, 'customer_id'>>,
  input: Pick<OilInput, 'today' | 'jobs' | 'items' | 'services' | 'moves' | 'stock'> & { vehicles?: Vehicle[] }): { day: Day; ours: boolean } | null {
  const oil = oilJobIds(input.items, input.services, input.moves, input.stock, deniedJobs([v, ...(input.vehicles || [])]));
  const vehicles = input.vehicles || [{ id: v.id, customer_id: v.customer_id ?? '', deleted_at: null }];
  return lastOilFrom(v, lastOursByCar(input.jobs, oil, vehicles).get(v.id), input.today);
}

interface Acc { customerId: string; vehicleId: string | null; lastOil: Day | null; lastVisit: Day | null; next: Job | null; nextOil: boolean; oilJob: string | null; lastVisitJob: string | null; saidOn: Day | null }
const acc = (customerId: string, vehicleId: string | null): Acc => ({ customerId, vehicleId, lastOil: null, lastVisit: null, next: null, nextOil: false, oilJob: null, lastVisitJob: null, saidOn: null });

export function oilRows(input: OilInput): OilRow[] {
  const vehicles = new Map(input.vehicles.map((v) => [v.id, v]));
  const customers = new Map(input.customers.map((c) => [c.id, c]));
  const denied = deniedJobs(input.vehicles);
  const oilJobs = input.oilJobs || oilJobIds(input.items, input.services, input.moves, input.stock, denied);
  const cars = carsByCustomer(input.vehicles);

  const accs = new Map<string, Acc>();
  // a coming appointment with no car, for a customer with several cars: it may be for any of them (see below)
  const comingNoCar = new Map<string, Job[]>();
  for (const j of input.jobs) {
    if (j.deleted_at) continue;
    const done = j.status === 'done';
    const coming = (j.status === 'booked' || j.status === 'en_route' || j.status === 'on_site') && j.day >= input.today;
    if (!done && !coming) continue;
    const carId = carOf(j, cars);
    const v = carId ? vehicles.get(carId) : undefined;
    if (j.vehicle_id && (!v || v.deleted_at)) continue;
    // the car's owner today (a car that changed hands follows its file), else the visit's customer
    const customerId = v?.customer_id || j.customer_id;
    if (!customerId) continue;
    if (!v && coming && (cars.get(customerId)?.length || 0) > 1) { comingNoCar.set(customerId, [...(comingNoCar.get(customerId) || []), j]); continue; }
    const key = v ? v.id : `c:${customerId}`;
    let a = accs.get(key);
    if (!a) { a = acc(customerId, v ? v.id : null); accs.set(key, a); }
    if (done) {
      if (!a.lastVisit || j.day > a.lastVisit) { a.lastVisit = j.day; a.lastVisitJob = j.id; }
      if (oilJobs.has(j.id) && (!a.lastOil || j.day > a.lastOil)) { a.lastOil = j.day; a.oilJob = j.id; }
    } else {
      if (oilJobs.has(j.id)) a.nextOil = true;
      if (!a.next || j.day < a.next.day) a.next = j;
    }
  }

  // the day the customer gave for a car (« Dernier changement d’huile »), even when the car never came
  for (const v of input.vehicles) {
    if (v.deleted_at || !v.customer_id || !v.last_oil_on || v.last_oil_on > input.today) continue;
    let a = accs.get(v.id);
    if (!a) { a = acc(v.customer_id, v.id); accs.set(v.id, a); }
    if (!a.lastOil || v.last_oil_on > a.lastOil) { a.lastOil = v.last_oil_on; a.oilJob = null; a.saidOn = v.last_oil_on; }
  }

  // a coming appointment booked without a car shows on each of the customer's cars (and on the row of their visits with
  // no car, « c:<customer> », when none of the cars is followed), and when it has an oil change none of them is called
  // (the office would call someone who already booked)
  for (const [customerId, jobs] of comingNoCar) {
    for (const a of accs.values()) {
      if (a.customerId !== customerId) continue;
      for (const j of jobs) {
        if (oilJobs.has(j.id)) a.nextOil = true;
        if (!a.next || j.day < a.next.day) a.next = j;
      }
    }
  }

  // visits with no car on them only count for a customer none of whose cars is followed
  const withCar = new Set<string>();
  for (const a of accs.values()) if (a.vehicleId && (a.lastVisit || a.lastOil)) withCar.add(a.customerId);

  const out: OilRow[] = [];
  for (const [key, a] of accs) {
    if ((!a.lastVisit && !a.lastOil) || a.nextOil) continue;
    if (!a.vehicleId && withCar.has(a.customerId)) continue;
    const c = customers.get(a.customerId);
    if (!c || c.deleted_at) continue;
    const due = a.lastVisit ? dueDay(a.lastVisit, a.lastOil) : addMonths(a.lastOil as Day, AFTER_OIL_MONTHS);
    // only a call noted (call back, stop) since the last visit counts; `not_oil` alone is not a call
    const call = a.vehicleId ? callOf(followupOf(vehicles.get(a.vehicleId))) : null;
    const markDay = call ? localDay(call.at) : null;
    const mark = call && markDay && (!a.lastVisit || markDay >= a.lastVisit) ? call : null;
    const callOn = mark?.again_on && mark.again_on > due ? mark.again_on : due;
    const state: OilState = mark?.stop ? 'stopped' : callOn <= input.today ? 'call' : callOn <= addDays(input.today, SOON_DAYS) ? 'soon' : 'later';
    out.push({
      key, customerId: a.customerId, vehicleId: a.vehicleId, lastOil: a.lastOil, lastVisit: a.lastVisit, due, callOn, state,
      late: daysBetween(callOn, input.today),
      next: a.next ? { jobId: a.next.id, day: a.next.day, block: a.next.block, ...(a.next.block === 'day' ? { win_start: a.next.win_start ?? null, win_end: a.next.win_end ?? null, win_flex: !!a.next.win_flex } : {}) } : null,
      mark, oilJob: a.oilJob, lastVisitJob: a.lastVisitJob, lastVisitDenied: !!a.lastVisitJob && denied.has(a.lastVisitJob), saidOn: a.saidOn
    });
  }
  // the one waiting the longest first
  return out.sort((x, y) => x.callOn.localeCompare(y.callOn) || x.key.localeCompare(y.key));
}

export function toCall(rows: OilRow[]): OilRow[] { return rows.filter((r) => r.state === 'call'); }
