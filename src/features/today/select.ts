/* Lookups of « Aujourd'hui »: my stops of the day, what each truck is doing now, the money to collect, the proposals
   waiting for an answer, tomorrow's confirmations, today's payments. */
import { useEffect, useState } from 'preact/hooks';
import type { Job, JobItem, Invoice, Payment, Shift, Truck } from '../../data/types';
import { rowsOf, getRow } from '../../data/store';
import { allJobs, jobsOn, activeTrucks, openShift, positionOf, invoiceOf, customer, customerName, job as jobById } from '../../data/select';
import { myTrucks, isOwner, hasRole, can } from '../../data/auth';
import { today, addDays, dayOf } from '../../lib/dates';

export const OPEN = ['booked', 'en_route', 'on_site'];
const live = (j: Job) => j.status !== 'cancelled' && j.status !== 'no_show';

/** which « Aujourd'hui »: the mechanic's own day, the team's day (owner, office), or the money (treasurer only) */
export type TodayRole = 'mechanic' | 'office' | 'treasurer';
export function todayRole(): TodayRole {
  if (isOwner() || hasRole('office')) return 'office';
  if (hasRole('mechanic')) return 'mechanic';
  if (hasRole('treasurer')) return 'treasurer';
  return can('agenda') ? 'office' : 'treasurer';
}

/** re-draws every `ms` (time worked, « il y a 2 min ») */
export function useTick(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/* ---------- the mechanic ---------- */
/** my trucks' jobs of a day, in order (block, then stop) */
export function myJobsOn(day: string): Job[] {
  const mine = myTrucks();
  return jobsOn(day).filter((j) => !!j.truck_id && mine.includes(j.truck_id));
}
/** the stop to look at now: the one on site, else the one on the way, else the first booked */
export function nextStopOf(list: Job[]): Job | undefined {
  return list.find((j) => j.status === 'on_site') || list.find((j) => j.status === 'en_route') || list.find((j) => j.status === 'booked');
}
export function summaryOf(list: Job[]): { stops: number; drive: number; work: number } {
  const l = list.filter(live);
  return { stops: l.length, drive: l.reduce((n, j) => n + (j.travel_min ?? 0), 0), work: l.reduce((n, j) => n + (j.duration_min || 0), 0) };
}
/** the next day with work on my trucks (within two weeks) and its first stop */
export function nextWorkDay(from: string): { day: string; first: Job } | null {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i);
    const first = myJobsOn(d).find(live);
    if (first) return { day: d, first };
  }
  return null;
}
/** a person's shifts of the day (and one left open since yesterday) */
export function shiftsOf(staffId: string, day = today()): Shift[] {
  return rowsOf<Shift>('shifts')
    .filter((s) => s.staff_id === staffId && !s.deleted_at && (!s.ended_at || dayOf(new Date(s.started_at)) === day))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}
/** minutes worked: every shift, the open one until now */
export function workedMinutes(shifts: Pick<Shift, 'started_at' | 'ended_at'>[], now = Date.now()): number {
  const ms = shifts.reduce((n, s) => n + Math.max(0, (s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at)), 0);
  return Math.floor(ms / 60_000);
}

/* ---------- the team ---------- */
export type TruckState = 'en_route' | 'on_site' | 'waiting' | 'not_started' | 'finished' | 'empty';
export interface TruckNow {
  truck: Truck; jobs: Job[]; done: number; total: number; current?: Job; next?: Job; state: TruckState; shiftOpen: boolean; posAt: string | null;
}
export function truckNow(tr: Truck, day = today()): TruckNow {
  const jobs = jobsOn(day).filter((j) => j.truck_id === tr.id && live(j));
  const done = jobs.filter((j) => j.status === 'done').length;
  const current = jobs.find((j) => j.status === 'en_route') || jobs.find((j) => j.status === 'on_site');
  const next = jobs.find((j) => j.status === 'booked');
  const shiftOpen = !!(tr.driver_id && openShift(tr.driver_id));
  const state: TruckState = current ? (current.status as TruckState) : !jobs.length ? 'empty' : done === jobs.length ? 'finished' : shiftOpen ? 'waiting' : 'not_started';
  const pos = tr.driver_id ? positionOf(tr.driver_id) : undefined;
  return { truck: tr, jobs, done, total: jobs.length, current, next, state, shiftOpen, posAt: shiftOpen && pos ? pos.at : null };
}
export function trucksNow(day = today()): TruckNow[] { return activeTrucks.value.map((tr) => truckNow(tr, day)); }
/** today's jobs no truck could take */
export function unplacedOn(day = today()): Job[] { return jobsOn(day).filter((j) => !j.truck_id && live(j)); }

export interface Collect { job: Job; invoice?: Invoice; due: number }
/** finished jobs not (fully) paid: « payer plus tard », or a payment still missing */
export function toCollect(): Collect[] {
  return allJobs.value
    .filter((j) => j.status === 'done')
    .map((j) => {
      const invoice = invoiceOf(j.id);
      const due = invoice && invoice.status === 'issued' ? Math.max(0, invoice.total_cents - invoice.paid_cents) : 0;
      return { job: j, invoice, due };
    })
    .filter((x) => (x.invoice ? x.invoice.status === 'issued' && x.due > 0 : x.job.pay_later))
    .sort((a, b) => b.job.day.localeCompare(a.job.day) || b.job.number - a.job.number);
}
/** proposed work waiting for the customer's answer, on jobs still open */
export function proposalsWaiting(): { item: JobItem; job: Job }[] {
  return rowsOf<JobItem>('job_items')
    .filter((i) => i.status === 'proposed' && !i.deleted_at)
    .map((item) => ({ item, job: jobById(item.job_id)! }))
    .filter((x) => !!x.job && OPEN.includes(x.job.status))
    .sort((a, b) => a.job.day.localeCompare(b.job.day) || a.job.number - b.job.number);
}
/** tomorrow's appointments whose customer did not get the confirmation text */
export function toConfirm(day = addDays(today(), 1)): Job[] {
  return jobsOn(day).filter((j) => j.status === 'booked' && !j.confirm_sent_at);
}

/** payments received on a day, newest first, with whose they are */
export function paymentsOn(day = today()): { payment: Payment; name: string; jobId: string | null }[] {
  return rowsOf<Payment>('payments')
    .filter((p) => !p.deleted_at && p.paid_at && dayOf(new Date(p.paid_at)) === day)
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
    .map((payment) => {
      const inv = getRow<Invoice>('invoices', payment.invoice_id);
      const j = jobById(payment.job_id || inv?.job_id);
      const c = customer(inv?.customer_id || j?.customer_id);
      return { payment, name: customerName(c), jobId: j?.id ?? null };
    });
}
