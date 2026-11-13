/* Small lookups of the job section: who may do what on a job (mirrors the server's rules, which check again),
   the words that describe a job (when, what, for whom), the job that blocks « Je pars », the customer's link. */
import { signal } from '@preact/signals';
import type { Job, JobItem, Customer, JobStatus } from '../../data/types';
import { net } from '../../data/sync';
import { me, can, hasRole, isOwner, myTrucks } from '../../data/auth';
import { vehicle as vehicleRow, customer, customerName, itemsOf, invoiceOf, jobsOn, blockOfKey, truck, staffName, messagesOf, settings } from '../../data/select';
import { today, addDays, longDay, shortDate, clock, clockRange } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { nextStep, BILLABLE, type NextStep, type StepRights } from './nextStep';
import { vinNeeded, vinSkips } from './vinStep';

export interface JobRights extends StepRights {
  /** the person drives this job's truck: they are the one at the customer's door */
  mine: boolean;
  /** the owner or the office */
  office: boolean;
  move: boolean; order: boolean; duration: boolean; reopen: boolean; verbal: boolean; editNotes: boolean; text: boolean; backFromDone: boolean;
}
export function jobRights(j: Job): JobRights {
  const a = me.value;
  const owner = isOwner();
  const mine = !!j.truck_id && myTrucks().includes(j.truck_id);
  // the server also lets the person who opened a job (a walk-in) work it
  const opened = !!a && j.created_by === a.id && (owner || hasRole('office') || hasRole('mechanic'));
  const office = owner || hasRole('office');
  const book = can('book');
  return {
    act: owner || book || mine || opened,
    invoice: owner || can('edit_invoices') || ((mine || opened) && hasRole('mechanic')) || book,
    payLater: owner || can('edit_invoices'),
    mine, office,
    move: office || book,
    // the order of the stops: the owner, the office (« book »), the truck's driver (as the server)
    order: owner || book || mine,
    duration: office && (book || mine),
    reopen: office,
    verbal: office,
    editNotes: office,
    text: owner || book || mine || opened,
    backFromDone: owner || book
  };
}

/** another job of this truck, today, on site and not paid: the server refuses « Je pars » until it is paid */
export function blockingJob(j: Job): Job | undefined {
  if (!j.truck_id) return undefined;
  return jobsOn(j.day).map(seen).find((o) => o.id !== j.id && o.truck_id === j.truck_id && o.status === 'on_site' && !o.pay_later && !o.coffre_id && invoiceOf(o.id)?.status !== 'paid');
}

/** the one next step of a job, for the person on screen (with the steps still waiting on this phone) */
export function stepOf(raw: Job): NextStep {
  const j = seen(raw);
  return nextStep(j, itemsOf(j.id), invoiceOf(j.id), jobRights(j), { today: today(), blockedBy: j.status === 'booked' ? blockingJob(j)?.id ?? null : null,
    needVin: vinNeeded(j, vehicleRow(j.vehicle_id), vinSkips.value) });
}

/* ---------- steps kept on the phone (no signal) ----------
   An operation waits in the outbox until the server answers; the job's row only changes then. Without signal the
   mechanic must still be able to go on (« Je suis arrivé », the signature…), in order: the job is shown as it will be
   once the waiting steps reach the server. As soon as the server's row changes, or nothing waits any more, the real
   row is shown again (a refused step then appears in the frame's « refusé » banner, as usual). */
interface Ahead { status?: JobStatus; waiver?: string; base: string | null }
export const ahead = signal<Record<string, Ahead>>({});
export function keepAhead(j: Job, patch: Omit<Ahead, 'base'>) {
  const cur = ahead.value[j.id];
  const base = cur && cur.base === (j.updated_at ?? null) ? cur : { base: j.updated_at ?? null };
  ahead.value = { ...ahead.value, [j.id]: { ...base, ...patch } };
}
/** the job as it will be once this phone's waiting steps reach the server */
export function seen(j: Job): Job {
  const a = ahead.value[j.id];
  if (!a || net.value.pending === 0 || a.base !== (j.updated_at ?? null)) return j;
  return { ...j, ...(a.status ? { status: a.status } : {}), ...(a.waiver ? { waiver_signed_at: a.waiver } : {}) };
}
/* ---------- words ---------- */
export function jobCustomer(j: Job): Customer | undefined { return customer(j.customer_id); }
export function jobName(j: Job): string { return customerName(jobCustomer(j)) || t('jobs.noCustomer'); }
/** the first name (for « En route vers Amira ») */
export function jobFirstName(j: Job): string {
  const c = jobCustomer(j);
  return (c?.first_name || '').trim() || c?.company || customerName(c) || t('jobs.noCustomer');
}
/** « Aujourd’hui », « Demain », « Hier », else « jeudi 6 novembre » */
export function dayWord(day: string, l = lang.value): string {
  const d = today();
  if (day === d) return t('jobs.day.today', undefined, l);
  if (day === addDays(d, 1)) return t('jobs.day.tomorrow', undefined, l);
  if (day === addDays(d, -1)) return t('jobs.day.yesterday', undefined, l);
  const s = longDay(day, l);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** the day inside a sentence: « Prévue demain », « Prévue jeudi 6 novembre » / “Planned tomorrow”, “Planned Thursday, November 6” */
export function dayInSentence(day: string, l = lang.value): string {
  const w = dayWord(day, l);
  const d = today();
  const near = day === d || day === addDays(d, 1) || day === addDays(d, -1);
  return l === 'fr' || near ? w.charAt(0).toLowerCase() + w.slice(1) : w;
}
/** a short day for lists: « Aujourd’hui », « Demain », else « 6 nov. 2026 » */
export function shortDayWord(day: string, l = lang.value): string {
  const d = today();
  if (day === d || day === addDays(d, 1) || day === addDays(d, -1)) return dayWord(day, l);
  return shortDate(day, l);
}
export function blockRange(j: Pick<Job, 'block'>, l = lang.value): string {
  const b = blockOfKey(j.block);
  return clockRange(b.start, b.end, l);
}
/** « Aujourd’hui, 12 h à 16 h, arrêt 2 » */
export function whenLine(j: Job, l = lang.value): string {
  const parts = [dayWord(j.day, l), blockRange(j, l)];
  if (j.stop_order != null && !['cancelled', 'no_show'].includes(j.status)) parts.push(t('jobs.stopN', { n: j.stop_order }, l));
  return parts.join(', ');
}
/** « vers 12 h 15 » */
export function etaWord(min: number | null | undefined, l = lang.value): string {
  return min == null ? '' : t('jobs.eta', { time: clock(min, l) }, l);
}
/** minutes after midnight of a timestamp, on this device's clock */
export function minuteOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
}
export function clockOf(iso: string | null | undefined, l = lang.value): string {
  const m = minuteOf(iso);
  return m == null ? '' : clock(m, l);
}
/** the work of a job, short: « Changement d’huile et filtre +1 » (or the problem when no work is listed) */
export function servicesText(j: Job): string {
  const list = itemsOf(j.id).filter((i) => BILLABLE.includes(i.status) || i.status === 'proposed');
  if (!list.length) return (j.problem || '').trim();
  return list.length > 1 ? `${list[0].description} +${list.length - 1}` : list[0].description;
}
export function proposedOf(jobId: string): JobItem[] { return itemsOf(jobId).filter((i) => i.status === 'proposed'); }
/** the driver of a job's truck, by first name */
export function driverName(j: Job): string { return staffName(truck(j.truck_id)?.driver_id); }

/** will the customer get the « en route » text? (a cell number, texts allowed for them and for this kind) */
export function customerGetsTexts(j: Job, kind = 'en_route'): boolean {
  const c = jobCustomer(j);
  if (!c?.phone || c.sms_ok === false) return false;
  return settings.value.messages?.on?.[kind] !== false;
}

/* ---------- the customer's own page ---------- */
const links = new Map<string, string>();
/** remember the link a text just carried (notify answers with it) */
export function rememberLink(jobId: string, link: string | null | undefined) { if (link) links.set(jobId, link); }
/** the customer's page link: from the last answer, else from a text already sent */
export function clientLinkOf(jobId: string): string | null {
  const known = links.get(jobId);
  if (known) return known;
  for (const m of messagesOf(jobId)) {
    const found = /(https?:\/\/\S+client\.html#t=[A-Za-z0-9_-]+(?:&l=en)?)/.exec(m.body || '');
    if (found) return found[1];
  }
  return null;
}
