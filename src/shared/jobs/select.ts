/* The job as the screens show it: with the steps, payments and answers still waiting on this phone, its next step for
   the person on screen, the job that blocks « Je pars », and the few words that name it (who, what).
   The words of when a job is live in domain/jobs/when.ts (re-exported here: other sections import them from this file). */
import { signal, computed } from '@preact/signals';
import type { Job, JobItem, Customer, JobStatus } from '../../data/types';
import { net } from '../../data/sync';
import { vehicle as vehicleRow, customer, customerName, itemsOf, invoiceOf, jobsOn, truck, staffName, settings } from '../../data/select';
import { today } from '../../lib/dates';
import { t } from '../../lib/i18n';
import { nextStep, type NextStep } from '../../domain/jobs/steps';
import { BILLABLE } from '../../domain/jobs/billing';
import { withSteps, withAnswer, paidWaiting } from '../../domain/jobs/pending';
import { jobRights } from '../../domain/jobs/rights';
import { vinNeeded, vinSkips } from './vinStep';
import { pendingJobs } from './pending';

export {
  dayWord, dayInSentence, shortDayWord, capFirst, isWindowJob, promisedWindow, blockRange, momentWord, momentShort, keepWindow, wt,
  outsideWindow, whenLine, etaWord, minuteOf, clockOf, type Moment
} from '../../domain/jobs/when';

/* ---------- steps kept on the phone (no signal) ----------
   An operation waits in the outbox until the server answers; the job's row only changes then. Without signal the
   mechanic must still be able to go on (« Je suis arrivé », the signature…), in order: the job is shown as it will be
   once the waiting steps reach the server. Those steps are read from the outbox itself (domain/jobs/pending.ts), so they
   survive a restart and a change of the row for another reason. `keepAhead` is this screen's own memory of the last step,
   for « Revenir en arrière » over a step already on the server: it holds while something waits and the row is the one
   the step was made on. */
interface Ahead { status?: JobStatus; waiver?: string; base: string | null }
const ahead = signal<Record<string, Ahead>>({});
/** something waits in the outbox (read alone: a screen does not redraw on every other change of the network state) */
const anyPending = computed(() => net.value.pending > 0);
export function keepAhead(j: Job, patch: Omit<Ahead, 'base'>) {
  const cur = ahead.value[j.id];
  const base = cur && cur.base === (j.updated_at ?? null) ? cur : { base: j.updated_at ?? null };
  ahead.value = { ...ahead.value, [j.id]: { ...base, ...patch } };
}
/** the job as it will be once this phone's waiting steps reach the server */
export function seen(j: Job): Job {
  const waiting = withSteps(j, pendingJobs().steps.get(j.id));
  const a = ahead.value[j.id];
  if (!a || !anyPending.value || a.base !== (j.updated_at ?? null)) return waiting;
  return { ...waiting, ...(a.status ? { status: a.status } : {}), ...(a.waiver ? { waiver_signed_at: waiver(waiting, a.waiver) } : {}) };
}
const waiver = (j: Job, at: string) => j.waiver_signed_at || at;
/** the job's work, with the customer's answers still waiting on this phone shown as given */
export function itemsSeen(jobId: string): JobItem[] {
  const answers = pendingJobs().answers;
  const list = itemsOf(jobId);
  return answers.size ? list.map((i) => withAnswer(i, answers)) : list;
}
/** the cents of this job's payments still waiting on this phone */
export function paidWaitingOf(j: Pick<Job, 'id'>): number {
  return paidWaiting(pendingJobs(), j.id, invoiceOf(j.id)?.id);
}
/** « Faire la facture » was asked and waits for signal */
export function invoiceWaiting(jobId: string): boolean { return pendingJobs().invoicing.has(jobId); }

/** paid, or a payment waiting on this phone covers it (it reaches the server before anything pressed after it) */
function settled(o: Job): boolean {
  const v = invoiceOf(o.id);
  if (v?.status === 'paid') return true;
  return v?.status === 'issued' && v.total_cents - v.paid_cents <= paidWaitingOf(o);
}
/** another job of this truck, today, on site and not paid: the server refuses « Je pars » until it is paid */
export function blockingJob(j: Job): Job | undefined {
  if (!j.truck_id) return undefined;
  return jobsOn(j.day).map(seen).find((o) => o.id !== j.id && o.truck_id === j.truck_id && o.status === 'on_site' && !o.pay_later && !o.coffre_id && !settled(o));
}

/** the one next step of a job, for the person on screen (with what still waits on this phone) */
export function stepOf(raw: Job): NextStep {
  const j = seen(raw);
  return nextStep(j, itemsSeen(j.id), invoiceOf(j.id), jobRights(j), {
    today: today(),
    blockedBy: j.status === 'booked' ? blockingJob(j)?.id ?? null : null,
    needVin: vinNeeded(j, vehicleRow(j.vehicle_id), vinSkips.value),
    paidWaiting: paidWaitingOf(j)
  });
}

/* ---------- who, what ---------- */
export function jobCustomer(j: Job): Customer | undefined { return customer(j.customer_id); }
export function jobName(j: Job): string { return customerName(jobCustomer(j)) || t('jobs.noCustomer'); }
/** the first name (for « En route vers Amira ») */
export function jobFirstName(j: Job): string {
  const c = jobCustomer(j);
  return (c?.first_name || '').trim() || c?.company || customerName(c) || t('jobs.noCustomer');
}
/** the work of a job, short: « Changement d’huile et filtre +1 » (or the problem when no work is listed) */
export function servicesText(j: Job): string {
  const list = itemsOf(j.id).filter((i) => BILLABLE.includes(i.status) || i.status === 'proposed');
  if (!list.length) return (j.problem || '').trim();
  return list.length > 1 ? `${list[0].description} +${list.length - 1}` : list[0].description;
}
/** the proposed work still waiting for the customer's answer (an answer kept on this phone counts as given) */
export function proposedOf(jobId: string): JobItem[] { return itemsSeen(jobId).filter((i) => i.status === 'proposed'); }
/** the driver of a job's truck, by first name */
export function driverName(j: Job): string { return staffName(truck(j.truck_id)?.driver_id); }

/** will the customer get this text? (a cell number, texts allowed for them and for this kind) */
export function customerGetsTexts(j: Job, kind = 'en_route'): boolean {
  const c = jobCustomer(j);
  if (!c?.phone || c.sms_ok === false) return false;
  return settings.value.messages?.on?.[kind] !== false;
}
