/* What « Aujourd'hui » reads from the device's copy: my stops of a day, what each truck is doing now, the jobs left open on a
   past day, the money to collect, the proposals waiting for an answer, tomorrow's confirmations, today's payments.
   Plain functions over the table signals (a screen that calls them redraws when the data changes); the rules
   themselves are in rules.ts. */
import { computed } from '@preact/signals';
import type { Job, JobItem, Invoice, Payment, Shift, Truck } from '../../data/types';
import { rowsOf, getRow } from '../../data/store';
import { allJobs, jobsOn, activeTrucks, openShift, positionOf, invoicesList, customer, customerName, job as jobById } from '../../data/select';
import { myTrucks, isOwner, hasRole, can } from '../../data/auth';
import { today, addDays, dayOf } from '../../lib/dates';
import { OPEN, isLive, pickDay, routeInUse, openBefore, collectList, invoicesByJob, type TodayRole, type Collect } from './rules';
import { dayView, myRoute } from './prefs';

export const hasTwoViews = () => (isOwner() || hasRole('office')) && hasRole('mechanic');
export function todayRole(): TodayRole {
  return pickDay({ owner: isOwner(), office: hasRole('office'), mechanic: hasRole('mechanic'), treasurer: hasRole('treasurer'), agenda: can('agenda') }, dayView.value);
}

/* ---------- the mechanic ---------- */
/** my trucks that are in service (a vehicle switched off has no route to do) */
export function myActiveTrucks(): string[] {
  const active = new Set(activeTrucks.value.map((tr) => tr.id));
  return myTrucks().filter((id) => active.has(id));
}
/** the route I do now: the one chosen on « Ma journée » while it is still valid; null = all of mine */
export function currentRoute(): string | null {
  return routeInUse(myRoute.value, myTrucks(), new Set(activeTrucks.value.map((tr) => tr.id)));
}
/** my trucks' jobs of a day, in order (block, then stop) */
export function myJobsOn(day: string): Job[] {
  const route = currentRoute();
  const mine = route ? [route] : myTrucks();
  return jobsOn(day).filter((j) => !!j.truck_id && mine.includes(j.truck_id));
}
/** the next day with work on my trucks (within two weeks) and its first stop */
export function nextWorkDay(from: string): { day: string; first: Job } | null {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i);
    const first = myJobsOn(d).find(isLive);
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
/** the jobs of a past day still open: the mechanic's trucks' (all of them, whatever route is chosen today), or every
    one for the owner and the office */
export function openBeforeFor(todayDay: string, mineOnly: boolean): Job[] {
  return openBefore(allJobs.value, todayDay, mineOnly ? myTrucks() : null);
}

/* ---------- the team ---------- */
export type TruckState = 'en_route' | 'on_site' | 'waiting' | 'not_started' | 'finished' | 'empty';
export interface TruckNow {
  truck: Truck; jobs: Job[]; done: number; total: number; current?: Job; next?: Job; state: TruckState; shiftOpen: boolean; posAt: string | null;
}
export function truckNow(tr: Truck, day = today()): TruckNow {
  const jobs = jobsOn(day).filter((j) => j.truck_id === tr.id && isLive(j));
  const done = jobs.filter((j) => j.status === 'done').length;
  const current = jobs.find((j) => j.status === 'en_route') || jobs.find((j) => j.status === 'on_site');
  const next = jobs.find((j) => j.status === 'booked');
  const shiftOpen = !!(tr.driver_id && openShift(tr.driver_id));
  const state: TruckState = current ? (current.status as TruckState) : !jobs.length ? 'empty' : done === jobs.length ? 'finished' : shiftOpen ? 'waiting' : 'not_started';
  const pos = tr.driver_id ? positionOf(tr.driver_id) : undefined;
  return { truck: tr, jobs, done, total: jobs.length, current, next, state, shiftOpen, posAt: shiftOpen && pos ? pos.at : null };
}
export function trucksNow(day = today()): TruckNow[] { return activeTrucks.value.map((tr) => truckNow(tr, day)); }
/** a day's jobs no truck could take */
export function unplacedOn(day = today()): Job[] { return jobsOn(day).filter((j) => !j.truck_id && isLive(j)); }

/** each job's invoice, indexed once per change of the invoices (not once per job per redraw) */
const invoiceIndex = computed(() => invoicesByJob(invoicesList.value));
/** finished jobs not (fully) paid */
export function toCollect(): Collect[] {
  return collectList(allJobs.value, invoiceIndex.value);
}
/** proposed work waiting for the customer's answer, on jobs still open */
export function proposalsWaiting(): { item: JobItem; job: Job }[] {
  return rowsOf<JobItem>('job_items')
    .filter((i) => i.status === 'proposed' && !i.deleted_at)
    .map((item) => ({ item, job: jobById(item.job_id)! }))
    .filter((x) => !!x.job && OPEN.includes(x.job.status))
    .sort((a, b) => a.job.day.localeCompare(b.job.day) || a.job.number - b.job.number);
}
/** a day's appointments whose customer did not get the confirmation text (tomorrow by default) */
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
