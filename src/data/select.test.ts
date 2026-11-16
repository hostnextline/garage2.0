/* The selectors read indexes now: each one must give exactly what the old scan gave, order included. The old
   implementations are copied here as the reference. */
import { describe, it, expect, beforeAll } from 'vitest';
import { replaceLocal, rowsOf, clearAll } from './store';
import { itemsOf, invoiceOf, paymentsOf, vehiclesOf, notesOf, specByKey, jobsOn, jobsOfCustomer, activeTrip, messagesOf, partsOfService, movesOf, truckRanges, jobTotals, lineCents, blocks, dayOrder } from './select';
import type { Job, JobItem, Invoice, Payment, Vehicle, CustomerNote, EngineSpec, Trip, Message, ServicePart, InventoryMove, TruckDay, TruckWeek } from './types';
import { dow, mergeRanges, type Day } from '../lib/dates';

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const ids = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i}`);
const JOBS = ids('j', 60), CUSTOMERS = ids('c', 25), INVOICES = ids('v', 40), ITEMS = ids('it', 15), SERVICES = ids('s', 8), TRUCKS = ['t1', 't2', 't3'], KEYS = ids('k', 6);
const DAYS = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'];
const stampAt = () => `2026-11-${String(10 + Math.floor(rnd() * 5)).padStart(2, '0')}T1${Math.floor(rnd() * 9)}:00:00Z`;
const maybeDeleted = () => (rnd() < 0.1 ? '2026-11-15T00:00:00Z' : null);

beforeAll(() => {
  clearAll();
  replaceLocal('jobs', JOBS.map((id, n) => ({ id, number: n, day: pick(DAYS), block: pick(['am', 'pm', 'eve', 'day']), stop_order: rnd() < 0.3 ? null : Math.floor(rnd() * 5), eta_min: rnd() < 0.5 ? null : 480 + Math.floor(rnd() * 600), customer_id: rnd() < 0.1 ? null : pick(CUSTOMERS), deleted_at: maybeDeleted() })));
  replaceLocal('job_items', ids('i', 400).map((id) => ({ id, job_id: pick(JOBS), sort: Math.floor(rnd() * 6), created_at: stampAt(), kind: pick(['service', 'part', 'discount', 'fee']), qty: 1 + Math.floor(rnd() * 3), unit_cents: Math.floor(rnd() * 20000) - 4000, taxable: rnd() < 0.8, status: pick(['planned', 'done', 'approved', 'declined']), deleted_at: maybeDeleted() })));
  replaceLocal('invoices', INVOICES.map((id) => ({ id, job_id: pick(JOBS), status: pick(['draft', 'issued', 'paid', 'void']), deleted_at: maybeDeleted() })));
  replaceLocal('payments', ids('p', 200).map((id) => ({ id, invoice_id: rnd() < 0.2 ? null : pick(INVOICES), job_id: rnd() < 0.3 ? null : pick(JOBS), deleted_at: maybeDeleted() })));
  replaceLocal('vehicles', ids('car', 80).map((id) => ({ id, customer_id: rnd() < 0.1 ? null : pick(CUSTOMERS), deleted_at: maybeDeleted() })));
  replaceLocal('customer_notes', ids('n', 90).map((id) => ({ id, customer_id: pick(CUSTOMERS), created_at: stampAt(), deleted_at: maybeDeleted() })));
  replaceLocal('engine_specs', ids('e', 20).map((id) => ({ id, key: pick(KEYS), deleted_at: maybeDeleted() })));
  replaceLocal('trips', ids('tr', 50).map((id) => ({ id, job_id: pick(JOBS), status: pick(['active', 'arrived', 'cancelled']) })));
  replaceLocal('messages', ids('m', 150).map((id) => ({ id, job_id: rnd() < 0.1 ? null : pick(JOBS), created_at: stampAt() })));
  replaceLocal('service_parts', ids('sp', 40).map((id) => ({ id, service_id: pick(SERVICES), item_id: pick(ITEMS), deleted_at: maybeDeleted() })));
  replaceLocal('inventory_moves', ids('mv', 120).map((id) => ({ id, item_id: pick(ITEMS), created_at: stampAt(), deleted_at: maybeDeleted() })));
  replaceLocal('truck_days', ids('td', 20).map((id) => ({ id, truck_id: pick(TRUCKS), day: pick(DAYS), ranges: [[480 + Math.floor(rnd() * 60), 720]], deleted_at: maybeDeleted() })));
  replaceLocal('truck_week', ids('tw', 25).map((id) => ({ id, truck_id: pick(TRUCKS), dow: Math.floor(rnd() * 7), ranges: [[420, 1200]], deleted_at: maybeDeleted() })));
});

const old = {
  itemsOf: (jobId: string) => rowsOf<JobItem>('job_items').filter((i) => i.job_id === jobId && !i.deleted_at).sort((a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at))),
  invoiceOf: (jobId: string) => rowsOf<Invoice>('invoices').find((v) => v.job_id === jobId && v.status !== 'void' && !v.deleted_at),
  paymentsOf: (o: { invoiceId?: string; jobId?: string }) => rowsOf<Payment>('payments').filter((p) => !p.deleted_at && ((o.invoiceId && p.invoice_id === o.invoiceId) || (o.jobId && p.job_id === o.jobId))),
  vehiclesOf: (c: string) => rowsOf<Vehicle>('vehicles').filter((v) => v.customer_id === c && !v.deleted_at),
  notesOf: (c: string) => rowsOf<CustomerNote>('customer_notes').filter((n) => n.customer_id === c && !n.deleted_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  specByKey: (k: string) => rowsOf<EngineSpec>('engine_specs').find((s) => s.key === k && !s.deleted_at),
  jobsOn: (day: Day) => rowsOf<Job>('jobs').filter((j) => !j.deleted_at).filter((j) => j.day === day).sort(dayOrder(blocks.value)),
  jobsOfCustomer: (c: string) => rowsOf<Job>('jobs').filter((j) => !j.deleted_at).filter((j) => j.customer_id === c).sort((a, b) => b.day.localeCompare(a.day)),
  activeTrip: (j: string) => rowsOf<Trip>('trips').find((t) => t.job_id === j && t.status === 'active'),
  messagesOf: (j: string) => rowsOf<Message>('messages').filter((m) => m.job_id === j).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  partsOfService: (s: string) => rowsOf<ServicePart>('service_parts').filter((p) => p.service_id === s && !p.deleted_at),
  movesOf: (i: string) => rowsOf<InventoryMove>('inventory_moves').filter((m) => m.item_id === i && !m.deleted_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  truckRanges: (t: string, day: Day) => {
    const d = rowsOf<TruckDay>('truck_days').find((x) => x.truck_id === t && x.day === day && !x.deleted_at);
    if (d) return mergeRanges(d.ranges || []);
    const w = rowsOf<TruckWeek>('truck_week').find((x) => x.truck_id === t && x.dow === dow(day) && !x.deleted_at);
    return mergeRanges(w?.ranges || []);
  }
};
const idsOf = (l: { id: string }[]) => l.map((r) => r.id);

describe('the selectors on indexes give what the scans gave (core-data-40)', () => {
  it('a job\'s lines, invoice, payments, trip, texts', () => {
    for (const j of [...JOBS, 'nope']) {
      expect(idsOf(itemsOf(j))).toEqual(idsOf(old.itemsOf(j)));
      expect(invoiceOf(j)?.id).toBe(old.invoiceOf(j)?.id);
      expect(idsOf(paymentsOf({ jobId: j }))).toEqual(idsOf(old.paymentsOf({ jobId: j })));
      expect(activeTrip(j)?.id).toBe(old.activeTrip(j)?.id);
      expect(idsOf(messagesOf(j))).toEqual(idsOf(old.messagesOf(j)));
    }
    for (const v of INVOICES) for (const j of [undefined, pick(JOBS)]) expect(idsOf(paymentsOf({ invoiceId: v, jobId: j }))).toEqual(idsOf(old.paymentsOf({ invoiceId: v, jobId: j })));
  });
  it('a customer\'s cars, notes and jobs; a day\'s jobs in the day\'s order', () => {
    for (const c of [...CUSTOMERS, 'nope']) {
      expect(idsOf(vehiclesOf(c))).toEqual(idsOf(old.vehiclesOf(c)));
      expect(idsOf(notesOf(c))).toEqual(idsOf(old.notesOf(c)));
      expect(idsOf(jobsOfCustomer(c))).toEqual(idsOf(old.jobsOfCustomer(c)));
    }
    for (const d of [...DAYS, '2030-01-01']) expect(idsOf(jobsOn(d))).toEqual(idsOf(old.jobsOn(d)));
  });
  it('specs, parts, stock moves, a truck\'s hours', () => {
    for (const k of [...KEYS, 'nope']) expect(specByKey(k)?.id).toBe(old.specByKey(k)?.id);
    for (const s of SERVICES) expect(idsOf(partsOfService(s))).toEqual(idsOf(old.partsOfService(s)));
    for (const i of ITEMS) expect(idsOf(movesOf(i))).toEqual(idsOf(old.movesOf(i)));
    for (const t of TRUCKS) for (const d of DAYS) expect(truckRanges(t, d)).toEqual(old.truckRanges(t, d));
  });
  it('a list handed to a screen can be sorted by it without spoiling the next answer', () => {
    const j = JOBS.find((x) => itemsOf(x).length > 1)!;
    const first = idsOf(itemsOf(j));
    itemsOf(j).reverse();
    expect(idsOf(itemsOf(j))).toEqual(first);
  });
});

describe('line totals count like the server (core-data-23)', () => {
  it('a discount is negative, any other line keeps its sign', () => {
    expect(lineCents({ kind: 'discount', unit_cents: 2000 })).toBe(-2000);
    expect(lineCents({ kind: 'discount', unit_cents: -2000 })).toBe(-2000);
    expect(lineCents({ kind: 'fee', unit_cents: -2000 })).toBe(-2000);
    expect(lineCents({ kind: 'service', unit_cents: 5000 })).toBe(5000);
  });
  it('a credit typed as a negative price on a service lowers the total', () => {
    replaceLocal('job_items', [
      { id: 'a', job_id: 'jx', kind: 'service', qty: 1, unit_cents: 10000, taxable: false, status: 'planned', sort: 0 },
      { id: 'b', job_id: 'jx', kind: 'fee', qty: 1, unit_cents: -2000, taxable: false, status: 'planned', sort: 1 }
    ]);
    expect(jobTotals('jx').total).toBe(8000);
  });
});
