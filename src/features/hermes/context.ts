/* 🤖 Hermes: the short picture of the garage sent with each question of the owner (plain text, read by Hermes as data).
   The coming week's jobs, what is still to be paid, the stock to order. No phone numbers, no addresses: names and cars only. */
import { allJobs, customer, customerName, vehicle, vehicleLabel, itemsOf, jobTotals, truckLabel, invoicesList, lowStock, coffreStock, activeTrucks, garageName, blockOfKey } from '../../data/select';
import { today, addDays, hm, type Day } from '../../lib/dates';
import { money } from '../../lib/money';
import type { Job } from '../../data/types';

const STATUS: Record<string, string> = { booked: 'booked', en_route: 'on the way', on_site: 'on site', done: 'done', cancelled: 'cancelled', no_show: 'no-show' };
const $ = (c: number) => money(c, 'en');

const blockTime = (j: Job) => { const b = blockOfKey(j.block); return b ? `${hm(b.start)}-${hm(b.end)}` : j.block; };
const blockStart = (j: Job) => blockOfKey(j.block)?.start ?? 0;

function jobLine(j: Job): string {
  const c = customer(j.customer_id);
  const items = itemsOf(j.id).filter((i) => !['declined', 'removed'].includes(i.status))
    .map((i) => `${i.description}${Number(i.qty) !== 1 ? ` ×${Number(i.qty)}` : ''} ${$(Math.round(Number(i.qty) * i.unit_cents))}${i.status === 'proposed' ? ' (proposed)' : ''}`);
  const tot = jobTotals(j.id);
  return [`#${j.number}`, blockTime(j), truckLabel(j.truck_id) || 'no truck', STATUS[j.status] || j.status,
    c ? customerName(c) : 'no customer', vehicleLabel(vehicle(j.vehicle_id)) || 'car?', items.join(' + ') || 'no work listed',
    `before tax ${$(tot.subtotal)}`, j.coffre_id ? 'Coffre (family/friends, no invoice)' : '', j.problem ? `problem: ${String(j.problem).slice(0, 160)}` : '']
    .filter(Boolean).join(' · ');
}

export function garageContext(now: Date = new Date()): string {
  const d0: Day = today(now), from = addDays(d0, -1), to = addDays(d0, 6);
  const out: string[] = [`Garage: ${garageName.value}. Now: ${d0} ${now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Toronto' })} (Montréal).`];
  const tr = activeTrucks.value.map((t) => t.name);
  if (tr.length) out.push(`Trucks: ${tr.join(', ')}.`);
  const jobs = allJobs.value.filter((j) => j.day >= from && j.day <= to).sort((a, b) => a.day.localeCompare(b.day) || blockStart(a) - blockStart(b) || (a.stop_order ?? 99) - (b.stop_order ?? 99) || a.number - b.number);
  out.push('', `JOBS from ${from} to ${to} (${jobs.length}):`);
  let day = '';
  for (const j of jobs.slice(0, 160)) {
    if (j.day !== day) { day = j.day; out.push(`${day}${day === d0 ? ' (today)' : ''}:`); }
    out.push('- ' + jobLine(j));
  }
  if (!jobs.length) out.push('- none');
  const due = invoicesList.value.filter((v) => v.status === 'issued' && v.total_cents - v.paid_cents > 0);
  out.push('', `INVOICES NOT FULLY PAID: ${due.length}${due.length ? `, still owed ${$(due.reduce((s, v) => s + v.total_cents - v.paid_cents, 0))}` : ''}.`);
  for (const v of due.slice(0, 30)) out.push(`- #${v.number ?? '?'} ${customerName(customer(v.customer_id)) || '?'}: owes ${$(v.total_cents - v.paid_cents)} of ${$(v.total_cents)}${v.due_on ? `, due ${v.due_on}` : ''}`);
  const low = lowStock.value;
  out.push('', `GARAGE STOCK TO ORDER: ${low.length ? low.slice(0, 40).map((i) => `${i.name} (${Number(i.qty)} ${i.unit} left${i.min_qty != null ? `, min ${Number(i.min_qty)}` : ''})`).join('; ') : 'nothing'}.`);
  if (coffreStock.value.length) out.push(`Coffre stock: ${coffreStock.value.length} items.`);
  return out.join('\n');
}
