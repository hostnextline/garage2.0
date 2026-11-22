/* 🤖 Hermes: the words of the garage's picture sent with each question (plain English, read by Hermes as data).
   Pure: the data and this person's rights come in (context.ts gathers them from the app), so what may leave the phone
   is tested in contextText.test.ts. The rules: the jobs the app has for this person; prices only with « Argent » or
   « Factures »; the invoices to be paid only with « Factures »; the stock only with « Inventaire »; the month's expenses
   only with « Trésorerie ». Never a phone number, an address, a plate or a VIN: names and cars only, and every text
   typed by hand goes through scrub() (privacy.ts) first. */
import { hm, type Day } from '../../lib/dates';
import { money } from '../../lib/money';
import { scrub } from './privacy';

export interface ContextRights { prices: boolean; invoices: boolean; inventory: boolean; treasury: boolean; coffre: boolean }

/** what the customer was told, as data: a block's hours, or the arrival window */
export interface ContextWhen {
  /** 'day' = booked by arrival window; else a block key */
  block: string;
  /** the block's hours (block mode), when known */
  blockStart?: number | null; blockEnd?: number | null;
  winStart: number | null; winEnd: number | null;
  /** the planned arrival (minutes); said to Hermes only while the job is booked, but it orders the day either way */
  eta: number | null;
  status?: string;
}
export interface ContextJob extends ContextWhen {
  number: number; day: Day; status: string; stopOrder: number | null;
  truck: string | null; customer: string | null; vehicle: string | null;
  items: { description: string; qty: number; cents: number; proposed: boolean }[];
  subtotal: number; coffre: boolean; problem: string | null;
}
export interface ContextInput {
  now: Date; today: Day; from: Day; to: Day; garage: string; trucks: string[];
  jobs: ContextJob[];
  dueInvoices: { number: number | null; customer: string | null; total: number; paid: number; dueOn: string | null }[];
  lowStock: { name: string; qty: number; unit: string; min: number | null }[];
  expenses: { day: string; category: string; total: number; tps: number; tvq: number }[];
  coffreItems: number;
}

const STATUS: Record<string, string> = { booked: 'booked', en_route: 'on the way', on_site: 'on site', done: 'done', cancelled: 'cancelled', no_show: 'no-show' };
const $ = (c: number) => money(c, 'en');
export const MAX_JOBS = 160, MAX_INVOICES = 30, MAX_STOCK = 40, MAX_CATEGORIES = 12;

/** booked by arrival window (block 'day'): « window 14:00-18:00 », with the planned arrival, « OUTSIDE its window » when that
    arrival misses it, or « flexible » while no window is fixed yet; a block: its hours */
export function blockTime(j: ContextWhen): string {
  if (j.block === 'day') {
    const planned = j.eta != null && (j.status === undefined || j.status === 'booked') ? j.eta : null;
    const eta = planned != null ? `, planned arrival ${hm(planned)}` : '';
    if (j.winStart == null || j.winEnd == null) return `flexible (any time that day, 4-hour arrival window fixed the evening before)${eta}`;
    const out = planned != null && (planned < j.winStart || planned > j.winEnd) ? ' OUTSIDE its window' : '';
    return `arrival window ${hm(j.winStart)}-${hm(j.winEnd)}${eta}${out}`;
  }
  return j.blockStart != null && j.blockEnd != null ? `${hm(j.blockStart)}-${hm(j.blockEnd)}` : j.block;
}
/** the order of the day: block (or arrival) first, then the order of the stops, then the number */
export function startOf(j: ContextWhen): number { return j.block === 'day' ? j.eta ?? j.winStart ?? 0 : j.blockStart ?? 0; }

function jobLine(j: ContextJob, prices: boolean): string {
  const items = j.items.map((i) => `${scrub(i.description, 120)}${i.qty !== 1 ? ` ×${i.qty}` : ''}${prices ? ' ' + $(Math.round(i.qty * i.cents)) : ''}${i.proposed ? ' (proposed)' : ''}`);
  return [`#${j.number}`, blockTime(j), j.truck || 'no truck', STATUS[j.status] || j.status,
    scrub(j.customer, 80) || 'no customer', scrub(j.vehicle, 80) || 'car?', items.join(' + ') || 'no work listed',
    prices ? `before tax ${$(j.subtotal)}` : '', j.coffre ? 'Coffre (family/friends, no invoice)' : '',
    j.problem && scrub(j.problem) ? `problem: ${scrub(j.problem)}` : '']
    .filter(Boolean).join(' · ');
}

export function contextText(x: ContextInput, r: ContextRights): string {
  const time = x.now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Toronto' });
  const out: string[] = [`Garage: ${scrub(x.garage, 80)}. Now: ${x.today} ${time} (Montréal).`];
  if (x.trucks.length) out.push(`Trucks: ${x.trucks.map((t) => scrub(t, 40)).join(', ')}.`);
  const jobs = x.jobs.filter((j) => j.day >= x.from && j.day <= x.to)
    .sort((a, b) => a.day.localeCompare(b.day) || startOf(a) - startOf(b) || (a.stopOrder ?? 99) - (b.stopOrder ?? 99) || a.number - b.number);
  out.push('', `JOBS from ${x.from} to ${x.to} (${jobs.length}):`);
  let day = '';
  for (const j of jobs.slice(0, MAX_JOBS)) {
    if (j.day !== day) { day = j.day; out.push(`${day}${day === x.today ? ' (today)' : ''}:`); }
    out.push('- ' + jobLine(j, r.prices));
  }
  if (!jobs.length) out.push('- none');
  if (r.invoices) {
    const due = x.dueInvoices.filter((v) => v.total - v.paid > 0);
    out.push('', `INVOICES NOT FULLY PAID: ${due.length}${due.length ? `, still owed ${$(due.reduce((s, v) => s + v.total - v.paid, 0))}` : ''}.`);
    for (const v of due.slice(0, MAX_INVOICES)) out.push(`- #${v.number ?? '?'} ${scrub(v.customer, 80) || '?'}: owes ${$(v.total - v.paid)} of ${$(v.total)}${v.dueOn ? `, due ${v.dueOn}` : ''}`);
  }
  if (r.inventory) {
    const low = x.lowStock;
    out.push('', `GARAGE STOCK TO ORDER: ${low.length ? low.slice(0, MAX_STOCK).map((i) => `${scrub(i.name, 80)} (${i.qty} ${i.unit} left${i.min != null ? `, min ${i.min}` : ''})`).join('; ') : 'nothing'}.`);
  }
  if (r.treasury) {
    const month = x.today.slice(0, 7);
    const ex = x.expenses.filter((e) => e.day.startsWith(month));
    out.push('', `EXPENSES THIS MONTH (${month}): ${ex.length}, total ${$(ex.reduce((s, e) => s + e.total, 0))} (taxes TPS ${$(ex.reduce((s, e) => s + e.tps, 0))}, TVQ ${$(ex.reduce((s, e) => s + e.tvq, 0))}).`);
    const cats = new Map<string, number>();
    for (const e of ex) cats.set(e.category, (cats.get(e.category) || 0) + e.total);
    if (cats.size) out.push('By category: ' + [...cats].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIES).map(([c, v]) => `${scrub(c, 40)} ${$(v)}`).join('; ') + '.');
  }
  if (r.coffre && x.coffreItems) out.push(`Coffre stock: ${x.coffreItems} items.`);
  return out.join('\n');
}
