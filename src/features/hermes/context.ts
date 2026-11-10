/* 🤖 Hermes: the short picture of the garage sent with each question (plain text, read by Hermes as data), made only of
   what this person may see: the jobs the app has for them (a mechanic: his truck's), prices only with « Argent » or
   « Factures », the invoices to be paid only with « Factures », the stock only with « Inventaire », the month's expenses
   only with « Trésorerie ». No phone numbers, no addresses: names and cars only. */
import { allJobs, customer, customerName, vehicle, vehicleLabel, itemsOf, jobTotals, truckLabel, invoicesList, lowStock, coffreStock, activeTrucks, garageName, blockOfKey } from '../../data/select';
import { today, addDays, hm, type Day } from '../../lib/dates';
import { money } from '../../lib/money';
import type { Job } from '../../data/types';
import { can, isOwner } from '../../data/auth';
import { expensesList } from '../../data/select';

const STATUS: Record<string, string> = { booked: 'booked', en_route: 'on the way', on_site: 'on site', done: 'done', cancelled: 'cancelled', no_show: 'no-show' };
const $ = (c: number) => money(c, 'en');

const blockTime = (j: Job) => { const b = blockOfKey(j.block); return b ? `${hm(b.start)}-${hm(b.end)}` : j.block; };
const blockStart = (j: Job) => blockOfKey(j.block)?.start ?? 0;

function jobLine(j: Job, prices: boolean): string {
  const c = customer(j.customer_id);
  const items = itemsOf(j.id).filter((i) => !['declined', 'removed'].includes(i.status))
    .map((i) => `${i.description}${Number(i.qty) !== 1 ? ` ×${Number(i.qty)}` : ''}${prices ? ' ' + $(Math.round(Number(i.qty) * i.unit_cents)) : ''}${i.status === 'proposed' ? ' (proposed)' : ''}`);
  const tot = jobTotals(j.id);
  return [`#${j.number}`, blockTime(j), truckLabel(j.truck_id) || 'no truck', STATUS[j.status] || j.status,
    c ? customerName(c) : 'no customer', vehicleLabel(vehicle(j.vehicle_id)) || 'car?', items.join(' + ') || 'no work listed',
    prices ? `before tax ${$(tot.subtotal)}` : '', j.coffre_id ? 'Coffre (family/friends, no invoice)' : '', j.problem ? `problem: ${String(j.problem).slice(0, 160)}` : '']
    .filter(Boolean).join(' · ');
}

export function garageContext(now: Date = new Date()): string {
  const d0: Day = today(now), from = addDays(d0, -1), to = addDays(d0, 6);
  const prices = can('money') || can('invoices');
  const out: string[] = [`Garage: ${garageName.value}. Now: ${d0} ${now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Toronto' })} (Montréal).`];
  const tr = activeTrucks.value.map((t) => t.name);
  if (tr.length) out.push(`Trucks: ${tr.join(', ')}.`);
  const jobs = allJobs.value.filter((j) => j.day >= from && j.day <= to).sort((a, b) => a.day.localeCompare(b.day) || blockStart(a) - blockStart(b) || (a.stop_order ?? 99) - (b.stop_order ?? 99) || a.number - b.number);
  out.push('', `JOBS from ${from} to ${to} (${jobs.length}):`);
  let day = '';
  for (const j of jobs.slice(0, 160)) {
    if (j.day !== day) { day = j.day; out.push(`${day}${day === d0 ? ' (today)' : ''}:`); }
    out.push('- ' + jobLine(j, prices));
  }
  if (!jobs.length) out.push('- none');
  if (can('invoices')) {
    const due = invoicesList.value.filter((v) => v.status === 'issued' && v.total_cents - v.paid_cents > 0);
    out.push('', `INVOICES NOT FULLY PAID: ${due.length}${due.length ? `, still owed ${$(due.reduce((s, v) => s + v.total_cents - v.paid_cents, 0))}` : ''}.`);
    for (const v of due.slice(0, 30)) out.push(`- #${v.number ?? '?'} ${customerName(customer(v.customer_id)) || '?'}: owes ${$(v.total_cents - v.paid_cents)} of ${$(v.total_cents)}${v.due_on ? `, due ${v.due_on}` : ''}`);
  }
  if (can('inventory')) {
    const low = lowStock.value;
    out.push('', `GARAGE STOCK TO ORDER: ${low.length ? low.slice(0, 40).map((i) => `${i.name} (${Number(i.qty)} ${i.unit} left${i.min_qty != null ? `, min ${Number(i.min_qty)}` : ''})`).join('; ') : 'nothing'}.`);
  }
  if (can('treasury')) {
    const month = d0.slice(0, 7);
    const ex = expensesList.value.filter((e) => e.day.startsWith(month));
    out.push('', `EXPENSES THIS MONTH (${month}): ${ex.length}, total ${$(ex.reduce((s, e) => s + e.total_cents, 0))} (taxes TPS ${$(ex.reduce((s, e) => s + e.tps_cents, 0))}, TVQ ${$(ex.reduce((s, e) => s + e.tvq_cents, 0))}).`);
    const cats = new Map<string, number>(); for (const e of ex) cats.set(e.category, (cats.get(e.category) || 0) + e.total_cents);
    if (cats.size) out.push('By category: ' + [...cats].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, v]) => `${c} ${$(v)}`).join('; ') + '.');
  }
  if ((isOwner() || can('treasury')) && coffreStock.value.length) out.push(`Coffre stock: ${coffreStock.value.length} items.`);
  return out.join('\n');
}
