/* The rules of « Aujourd'hui », pure (no store, no signals): which day a person sees, the stop to look at now, the day in
   numbers, the jobs left open on a past day, the route in use, the way back, the money to collect.
   The screens feed them from the device's copy (select.ts); rules.test.ts checks them. */
import type { Job, Invoice, Trip } from '../../data/types';
import type { PendingStep } from '../../domain/jobs/pending';

/** a job not finished yet: booked, on the way, or there */
export const OPEN = ['booked', 'en_route', 'on_site'];
/** a job that still counts in the day (not cancelled, the customer was there) */
export const isLive = (j: Pick<Job, 'status'>) => j.status !== 'cancelled' && j.status !== 'no_show';

/** which « Aujourd'hui »: the mechanic's own day, the team's day (owner, office), or the money (treasurer only) */
export type TodayRole = 'mechanic' | 'office' | 'treasurer';
/** an owner (or the office) who is also a mechanic picks the day they look at: the team's or their own */
export type DayView = 'office' | 'mechanic';
/** which day, from who the person is and the view picked. Only the day shown changes: the rights stay the same. */
export function pickDay(x: { owner: boolean; office: boolean; mechanic: boolean; treasurer: boolean; agenda: boolean }, view: DayView): TodayRole {
  if (x.owner || x.office) return x.mechanic && view === 'mechanic' ? 'mechanic' : 'office';
  if (x.mechanic) return 'mechanic';
  if (x.treasurer) return 'treasurer';
  return x.agenda ? 'office' : 'treasurer';
}

/* ---------- the mechanic ---------- */
/** the stop to look at now: the one on site, else the one on the way, else the first booked */
export function nextStopOf<J extends Pick<Job, 'status'>>(list: J[]): J | undefined {
  return list.find((j) => j.status === 'on_site') || list.find((j) => j.status === 'en_route') || list.find((j) => j.status === 'booked');
}
export function summaryOf(list: Pick<Job, 'status' | 'travel_min' | 'duration_min'>[]): { stops: number; drive: number; work: number } {
  const l = list.filter(isLive);
  return { stops: l.length, drive: l.reduce((n, j) => n + (j.travel_min ?? 0), 0), work: l.reduce((n, j) => n + (j.duration_min || 0), 0) };
}
/** minutes worked: every shift, the open one until now */
export function workedMinutes(shifts: { started_at: string; ended_at: string | null }[], now = Date.now()): number {
  const ms = shifts.reduce((n, s) => n + Math.max(0, (s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at)), 0);
  return Math.floor(ms / 60_000);
}
/** the route a mechanic does now, when several are theirs (« Routes partagées »). The one remembered on the phone counts
    only while it is still one of theirs AND in service: a vehicle switched off must not empty « Ma journée » with
    nothing left on screen to change it. null: all of them. */
export function routeInUse(stored: string | null, mine: readonly string[], active: ReadonlySet<string>): string | null {
  const usable = mine.filter((id) => active.has(id));
  return stored && usable.length > 1 && usable.includes(stored) ? stored : null;
}

/** the jobs left open on a past day (booked, on the way, or there): nobody must forget them. A Friday job the customer
    pays later stays « sur place »; a forgotten « Terminer »; the stops of a mechanic who was sick. Oldest first.
    `trucks`: only those trucks' jobs (the mechanic); null: every job (owner, office). */
export function openBefore<J extends Pick<Job, 'day' | 'status' | 'truck_id' | 'number'> & { deleted_at?: string | null }>(jobs: readonly J[], todayDay: string, trucks: readonly string[] | null): J[] {
  return jobs
    .filter((j) => j.day < todayDay && OPEN.includes(j.status) && !j.deleted_at && (trucks == null || (!!j.truck_id && trucks.includes(j.truck_id))))
    .sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number);
}

/** the last time one of the day's stops was finished (a job finished after an arrival means a new way back): for each
    job shown done, the later of the server's finished_at and the last « Terminer » still waiting on this phone (no
    finished_at yet; or a job finished again offline after « Défaire », whose row still says the first finish).
    `stepsOf`: the steps of a job waiting on this phone. */
export function lastFinished(list: readonly Pick<Job, 'id' | 'status' | 'finished_at'>[], stepsOf: (id: string) => readonly PendingStep[] | undefined): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  const take = (at: string | null | undefined) => {
    const ms = at ? Date.parse(at) : NaN;
    if (at && Number.isFinite(ms) && ms > bestMs) { best = at; bestMs = ms; }
  };
  for (const j of list) {
    if (j.status !== 'done') continue;
    take(j.finished_at);
    take([...(stepsOf(j.id) || [])].reverse().find((s) => s.action === 'finish')?.at);
  }
  return best;
}

/** the way back to the start after the last stop. `arrived`: a trip back of today that ended after the last job
    finished (so « Je pars vers la Centrale » is not offered again, which would text the garage a second time);
    a job finished after that arrival means a new way back. */
export type ReturnState = { kind: 'none' } | { kind: 'active'; trip: Trip } | { kind: 'arrived'; at: string };
export function returnState(trips: readonly Trip[], staffId: string, todayDay: string, dayOf: (iso: string) => string, lastFinished: string | null, now = Date.now()): ReturnState {
  const mine = trips.filter((x) => x.staff_id === staffId && x.kind === 'return' && !x.deleted_at);
  const active = mine.find((x) => x.status === 'active' && Date.parse(x.expires_at) > now);
  if (active) return { kind: 'active', trip: active };
  const arrived = mine
    .filter((x) => x.status === 'arrived' && !!x.ended_at && dayOf(x.ended_at) === todayDay)
    .sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)))[0];
  if (arrived && (!lastFinished || Date.parse(arrived.ended_at!) >= Date.parse(lastFinished))) return { kind: 'arrived', at: arrived.ended_at! };
  return { kind: 'none' };
}

/* ---------- the money ---------- */
export interface Collect { job: Job; invoice?: Invoice; due: number }
/** the invoice of each job (not void, not deleted; the first one of the table when there are several, as invoiceOf) */
export function invoicesByJob(invoices: readonly Invoice[]): Map<string, Invoice> {
  const out = new Map<string, Invoice>();
  for (const v of invoices) if (v.job_id && v.status !== 'void' && !v.deleted_at && !out.has(v.job_id)) out.set(v.job_id, v);
  return out;
}
/** finished jobs not (fully) paid: an issued invoice with money still due, or « payer plus tard ».
    One pass over the jobs with the invoices indexed once (thousands of rows on a phone). Newest first. */
export function collectList(jobs: readonly Job[], invoices: ReadonlyMap<string, Invoice>): Collect[] {
  const out: Collect[] = [];
  for (const job of jobs) {
    if (job.status !== 'done') continue;
    const invoice = invoices.get(job.id);
    if (invoice) {
      const due = invoice.status === 'issued' ? Math.max(0, invoice.total_cents - invoice.paid_cents) : 0;
      if (invoice.status === 'issued' && due > 0) out.push({ job, invoice, due });
    } else if (job.pay_later) out.push({ job, due: 0 });
  }
  return out.sort((a, b) => b.job.day.localeCompare(a.job.day) || b.job.number - a.job.number);
}
