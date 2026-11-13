/* « Rappels d’huile »: which cars are due for an oil change, so someone calls their owner. Hassan's rule:
   - the car's last oil change (ours, or the day the customer gave: « Dernier changement d’huile » on the car): call 6 months after it;
   - the last visit had none: call 3 months after that visit (never before 6 months after the last oil change we did).
   A car that already has a coming appointment with an oil change is not listed. What was said at the last call lives on
   the car (`vehicles.oil_followup`): call back on a day, or stop calling for this car; a newer visit makes it old.
   Pure: no screen, no server (tested in due.test.ts). */
import { addDays, addMonths, daysBetween, type BlockKey, type Day } from '../../lib/dates';
import type { Customer, Job, JobItem, OilMark, Service, Vehicle } from '../../data/types';
import { guessNeeds, needsOf } from '../inventory/needs';

export const AFTER_OIL_MONTHS = 6;
export const AFTER_VISIT_MONTHS = 3;
export const SOON_DAYS = 30;

export type OilState = 'call' | 'soon' | 'later' | 'stopped';
export interface OilRow {
  /** the car's id, or « c:<customer> » for visits with no car on them */
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
  /** the car's coming appointment (it has no oil change, or the car would not be listed) */
  next: { jobId: string; day: Day; block: BlockKey } | null;
  /** what was said at the last call, when it still counts */
  mark: OilMark | null;
}
export interface OilInput {
  today: Day;
  jobs: Job[]; items: JobItem[]; services: Service[]; vehicles: Vehicle[]; customers: Customer[];
}

const COUNTED = new Set(['planned', 'done', 'approved']);
/** a line of work that is an oil change: its service says it uses oil (or its name does), else the words of the line */
export function isOilItem(i: Pick<JobItem, 'kind' | 'status' | 'service_id' | 'description'>, services: Map<string, Service>): boolean {
  if (!COUNTED.has(i.status) || i.kind === 'discount' || i.kind === 'fee') return false;
  const s = i.service_id ? services.get(i.service_id) : undefined;
  if (s) return needsOf(s).needs.some((n) => n.kind === 'oil');
  return guessNeeds({ name_fr: i.description || '', name_en: null, includes: [] }).some((n) => n.kind === 'oil');
}

function localDay(iso: string | null | undefined): Day | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** when a car is due: 6 months after a visit with an oil change, 3 months after a visit without */
export function dueDay(lastVisit: Day, lastOil: Day | null): Day {
  if (lastOil && lastOil >= lastVisit) return addMonths(lastOil, AFTER_OIL_MONTHS);
  const d = addMonths(lastVisit, AFTER_VISIT_MONTHS);
  const o = lastOil ? addMonths(lastOil, AFTER_OIL_MONTHS) : d;
  return o > d ? o : d;
}

/** the appointments (finished or not) that have an oil change */
export function oilJobIds(items: JobItem[], services: Service[]): Set<string> {
  const map = new Map(services.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const i of items) if (!i.deleted_at && isOilItem(i, map)) out.add(i.job_id);
  return out;
}
/** a car's last oil change: the latest of our finished visits with one and the day its owner gave; `ours`: it was us */
export function lastOilOf(v: Pick<Vehicle, 'id' | 'last_oil_on'>, input: Pick<OilInput, 'today' | 'jobs' | 'items' | 'services'>): { day: Day; ours: boolean } | null {
  const oil = oilJobIds(input.items, input.services);
  let mine: Day | null = null;
  for (const j of input.jobs) if (!j.deleted_at && j.status === 'done' && j.vehicle_id === v.id && oil.has(j.id) && (!mine || j.day > mine)) mine = j.day;
  const said = v.last_oil_on && v.last_oil_on <= input.today ? v.last_oil_on : null;
  if (mine && (!said || mine >= said)) return { day: mine, ours: true };
  return said ? { day: said, ours: false } : null;
}

export function oilRows(input: OilInput): OilRow[] {
  const vehicles = new Map(input.vehicles.map((v) => [v.id, v]));
  const customers = new Map(input.customers.map((c) => [c.id, c]));
  const oilJobs = oilJobIds(input.items, input.services);

  interface Acc { customerId: string; vehicleId: string | null; lastOil: Day | null; lastVisit: Day | null; next: Job | null; nextOil: boolean }
  const accs = new Map<string, Acc>();
  for (const j of input.jobs) {
    if (j.deleted_at) continue;
    const done = j.status === 'done';
    const coming = (j.status === 'booked' || j.status === 'en_route' || j.status === 'on_site') && j.day >= input.today;
    if (!done && !coming) continue;
    const v = j.vehicle_id ? vehicles.get(j.vehicle_id) : undefined;
    if (j.vehicle_id && (!v || v.deleted_at)) continue;
    // the car's owner today (a car that changed hands follows its file), else the visit's customer
    const customerId = v?.customer_id || j.customer_id;
    if (!customerId) continue;
    const key = v ? v.id : `c:${customerId}`;
    let a = accs.get(key);
    if (!a) { a = { customerId, vehicleId: v ? v.id : null, lastOil: null, lastVisit: null, next: null, nextOil: false }; accs.set(key, a); }
    if (done) {
      if (!a.lastVisit || j.day > a.lastVisit) a.lastVisit = j.day;
      if (oilJobs.has(j.id) && (!a.lastOil || j.day > a.lastOil)) a.lastOil = j.day;
    } else {
      if (oilJobs.has(j.id)) a.nextOil = true;
      if (!a.next || j.day < a.next.day) a.next = j;
    }
  }

  // the day the customer gave for a car (« Dernier changement d’huile »), even when the car never came
  for (const v of input.vehicles) {
    if (v.deleted_at || !v.customer_id || !v.last_oil_on || v.last_oil_on > input.today) continue;
    let a = accs.get(v.id);
    if (!a) { a = { customerId: v.customer_id, vehicleId: v.id, lastOil: null, lastVisit: null, next: null, nextOil: false }; accs.set(v.id, a); }
    if (!a.lastOil || v.last_oil_on > a.lastOil) a.lastOil = v.last_oil_on;
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
    const raw = a.vehicleId ? vehicles.get(a.vehicleId)?.oil_followup : null;
    const markDay = raw ? localDay(raw.at) : null;
    const mark = raw && markDay && (!a.lastVisit || markDay >= a.lastVisit) ? raw : null;
    const callOn = mark?.again_on && mark.again_on > due ? mark.again_on : due;
    const state: OilState = mark?.stop ? 'stopped' : callOn <= input.today ? 'call' : callOn <= addDays(input.today, SOON_DAYS) ? 'soon' : 'later';
    out.push({
      key, customerId: a.customerId, vehicleId: a.vehicleId, lastOil: a.lastOil, lastVisit: a.lastVisit, due, callOn, state,
      late: daysBetween(callOn, input.today), next: a.next ? { jobId: a.next.id, day: a.next.day, block: a.next.block } : null, mark
    });
  }
  // the one waiting the longest first
  return out.sort((x, y) => x.callOn.localeCompare(y.callOn) || x.key.localeCompare(y.key));
}

export function toCall(rows: OilRow[]): OilRow[] { return rows.filter((r) => r.state === 'call'); }
