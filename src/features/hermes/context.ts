/* 🤖 Hermes: gathers the garage's picture for one question from the app's copy of the data and this person's rights.
   The words and the privacy rules are in contextText.ts (pure, tested); this file only reads the app. */
import { allJobs, customer, customerName, vehicle, vehicleLabel, itemsOf, jobTotals, truckLabel, invoicesList, lowStock, coffreStock, activeTrucks, garageName, blockOfKey, expensesList } from '../../data/select';
import { today, addDays } from '../../lib/dates';
import type { Job } from '../../data/types';
import { plannedTime, etaUnsure } from '../../domain/jobs/when';
import { can, isOwner } from '../../data/auth';
import { contextText, type ContextJob, type ContextRights } from './contextText';

export { blockTime } from './contextText';

function contextJob(j: Job): ContextJob {
  const b = j.block === 'day' ? null : blockOfKey(j.block);
  const c = customer(j.customer_id);
  return {
    number: j.number, day: j.day, status: j.status, stopOrder: j.stop_order ?? null,
    block: j.block, blockStart: b?.start ?? null, blockEnd: b?.end ?? null, winStart: j.win_start ?? null, winEnd: j.win_end ?? null, eta: plannedTime(j), etaUnsure: etaUnsure(j),
    truck: truckLabel(j.truck_id) || null, customer: c ? customerName(c) : null, vehicle: vehicleLabel(vehicle(j.vehicle_id)) || null,
    items: itemsOf(j.id).filter((i) => !['declined', 'removed'].includes(i.status))
      .map((i) => ({ description: i.description, qty: Number(i.qty), cents: i.unit_cents, proposed: i.status === 'proposed' })),
    subtotal: jobTotals(j.id).subtotal, coffre: !!j.coffre_id, problem: j.problem ? String(j.problem) : null
  };
}

export function contextRights(): ContextRights {
  return { prices: can('money') || can('invoices'), invoices: can('invoices'), inventory: can('inventory'), treasury: can('treasury'), coffre: isOwner() || can('treasury') };
}

export function garageContext(now: Date = new Date()): string {
  const d0 = today(now), from = addDays(d0, -1), to = addDays(d0, 6);
  const r = contextRights();
  return contextText({
    now, today: d0, from, to, garage: garageName.value,
    trucks: activeTrucks.value.map((t) => t.name),
    jobs: allJobs.value.filter((j) => j.day >= from && j.day <= to).map(contextJob),
    // only what the rights let through is even read
    dueInvoices: r.invoices ? invoicesList.value.filter((v) => v.status === 'issued').map((v) => ({ number: v.number ?? null, customer: customerName(customer(v.customer_id)) || null, total: v.total_cents, paid: v.paid_cents, dueOn: v.due_on ?? null })) : [],
    lowStock: r.inventory ? lowStock.value.map((i) => ({ name: i.name, qty: Number(i.qty), unit: i.unit, min: i.min_qty != null ? Number(i.min_qty) : null })) : [],
    expenses: r.treasury ? expensesList.value.map((e) => ({ day: e.day, category: e.category, total: e.total_cents, tps: e.tps_cents, tvq: e.tvq_cents })) : [],
    coffreItems: r.coffre ? coffreStock.value.length : 0
  }, r);
}
