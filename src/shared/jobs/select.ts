/* Small lookups of the job section: who may do what on a job (mirrors the server's rules, which check again),
   the words that describe a job (when, what, for whom), the job that blocks « Je pars », the customer's link. */
import { signal } from '@preact/signals';
import type { Job, JobItem, Customer, JobStatus } from '../../data/types';
import { net } from '../../data/sync';
import { windowWords } from '../../domain/moment/words';
import { vehicle as vehicleRow, customer, customerName, itemsOf, invoiceOf, jobsOn, blockOfKey, truck, staffName, messagesOf, settings } from '../../data/select';
import { today, addDays, longDay, shortDate, clock, clockRange } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { nextStep, BILLABLE, type NextStep } from '../../domain/jobs/steps';
import { vinNeeded, vinSkips } from './vinStep';
import { jobRights } from '../../domain/jobs/rights';

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
/** what the job needs to say its moment: a block, or (« Plages d'arrivée », block 'day') the window told to the customer */
export type Moment = Pick<Job, 'block'> & Partial<Pick<Job, 'win_start' | 'win_end' | 'win_flex'>>;
/** booked by arrival window (a job is shown by what it is, whatever the garage's mode today) */
export const isWindowJob = (j: Pick<Job, 'block'>): boolean => j.block === 'day';
/** the window promised to the customer; null: none yet (« flexible », or a 'day' job the server has not given one) */
export function promisedWindow(j: Moment): [number, number] | null {
  return isWindowJob(j) && j.win_start != null && j.win_end != null ? [j.win_start, j.win_end] : null;
}
/** the hours told to the customer: « 12 h à 16 h » for a block, « entre 14 h et 18 h » for a window,
    « dans la journée (plage confirmée la veille) » while a window job has none */
export function blockRange(j: Moment, l = lang.value): string {
  if (isWindowJob(j)) return windowWords(promisedWindow(j), l);
  const b = blockOfKey(j.block);
  return clockRange(b.start, b.end, l);
}
/** the moment in a word or two, for a sentence: « matin », « après-midi », « soir »; a window job: « entre 14 h et 18 h » */
export function momentWord(j: Moment, l = lang.value): string {
  return isWindowJob(j) ? windowWords(promisedWindow(j), l) : t(`common.blocks.${j.block}`, undefined, l).toLowerCase();
}
/** the same as a label (capital first): « Matin », « Entre 14 h et 18 h » */
export function momentLabel(j: Moment, l = lang.value): string {
  const s = isWindowJob(j) ? windowWords(promisedWindow(j), l) : t(`common.blocks.${j.block}`, undefined, l);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** the last argument of `moveJob` that keeps what the customer was told when only the vehicle changes: the same window,
    or still « flexible » (null for a block job: the old call) */
export function keepWindow(j: Moment): { start: number | null; flex: boolean } | null {
  if (!isWindowJob(j)) return null;
  const w = promisedWindow(j);
  return { start: w ? w[0] : null, flex: !w && !!j.win_flex };
}
/** a text of the job section that says « bloc »: its twin under jobs.win for a job booked by window */
export function wt(j: Pick<Job, 'block'>, key: string, vars?: Record<string, string | number>, l = lang.value): string {
  return t(isWindowJob(j) ? key.replace(/^jobs\./, 'jobs.win.') : key, vars, l);
}
export const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** the moment, very short, for a ticket's stub: « Matin »; a window: « 14 h–18 h » / “2–6 p.m.”; none yet: « Flexible » */
export function momentShort(j: Moment, l = lang.value): string {
  if (!isWindowJob(j)) return t(`common.blocks.${j.block}`, undefined, l);
  const w = promisedWindow(j);
  if (!w) return t('jobs.win.flexShort', undefined, l);
  const a = clock(w[0], l), b = clock(w[1], l);
  // English: the half of the day said once when both ends share it (“2–6 p.m.”)
  const m = l === 'en' ? /^(.*) ([ap]\.m\.)$/.exec(a) : null;
  return m && b.endsWith(m[2]) ? `${m[1]}–${b}` : `${a}–${b}`;
}
/** « Hors plage »: the planned arrival of a coming stop falls outside the window promised (ordered by hand, booked « quand même »).
    Stops on the way or there are not judged: the planner no longer moves them. */
export function outsideWindow(j: Moment & Pick<Job, 'status' | 'eta_min'>): boolean {
  const w = promisedWindow(j);
  return !!w && j.status === 'booked' && j.eta_min != null && (j.eta_min < w[0] || j.eta_min > w[1]);
}
/** « Aujourd’hui, 12 h à 16 h, arrêt 2 » / « Aujourd’hui, entre 14 h et 18 h, arrêt 2 » */
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
