/* What the steps of a job do, the same from « Ma journée » and from the job sheet: Je pars, Je suis arrivé, the VIN,
   Terminer (with the parts used, or « paiera plus tard »), cancel, no-show, back, reopen, the invoice.
   - A step is kept on the phone when the signal is weak (the outbox): the screen shows it done at once (select.ts `seen`).
   - Nothing waits on the network before the step itself is kept: the start of the day and the texts go beside it or after.
   - A step the server refuses (another phone already did it, a stale screen) brings the job back from the server, so the
     screen shows what is true, not the button that was refused.
   Every action shows its own result (a toast, a sheet) and never throws. */
import type { Job, Vehicle } from '../../data/types';
import { jobStep, shiftStart, invoiceForJob, errorMessage, type StepAction } from '../../data/api';
import { refetch, pull } from '../../data/sync';
import { me, preview, hasRole } from '../../data/auth';
import { openShift, truck, invoiceOf, settings } from '../../data/select';
import { getRow } from '../../data/store';
import { route } from '../../platform/router';
import { toast, ask, askText, run } from '../../ui';
import { t } from '../../lib/i18n';
import { quickPosition } from '../../services/position';
import type { JobRights } from '../../domain/jobs/rights';
import { plannedParts, type UsedPart } from '../../domain/jobs/parts';
import { jobFirstName, keepAhead, wt, invoiceWaiting } from './select';
import { sendText, sendTracking, wantsArrivalText, outcomeClosed } from './texts';
import { confirmParts } from './PartsSheet';
import { askCar, saveCar } from './CarCheckSheet';
import { vinNeeded, vinSkips } from './vinStep';

const isQueued = (r: unknown) => !!r && typeof r === 'object' && (r as { queued?: boolean }).queued === true;
const codeOf = (e: unknown) => String((e as { hint?: string } | null)?.hint || (e as { code?: string } | null)?.code || '');
/** the server said no: show why, and bring the job (and its money) as the server has it */
function refused(j: Job, e: unknown) {
  toast(errorMessage(e), { kind: 'bad' });
  void refetch('jobs', j.id);
  void pull('invoices');
}

/** a step: on screen at once when it waits for signal; the result toast says what happened */
async function stepKept(j: Job, action: StepAction, data: Record<string, unknown>, ok: string, after: Job['status'] | null): Promise<boolean> {
  try {
    const r = await jobStep(j.id, action, data);
    if (isQueued(r)) { if (after) keepAhead(j, { status: after }); toast(t('shell.queued')); }
    else toast(ok, { kind: 'ok' });
    return true;
  } catch (e) {
    refused(j, e);
    return false;
  }
}

/* ---------- Je pars, Je suis arrivé ---------- */
/** the person pressing drives this job's truck (its phone is where the truck is) */
function drives(j: Job, rights: Pick<JobRights, 'mine'>): boolean {
  const mine = me.value?.id;
  return !!mine && !preview.value && (truck(j.truck_id)?.driver_id === mine || (rights.mine && hasRole('mechanic')));
}
/** « Je pars »: the job goes en route (kept on the phone without signal), the day of the one driving starts beside it if
    needed, then the customer gets the text with the arrival time (from where the driver's phone is) */
export async function doLeave(j: Job, rights: Pick<JobRights, 'mine'>): Promise<void> {
  const driving = drives(j, rights);
  const mine = me.value?.id;
  // the first departure starts the driver's day (the office and the customer can follow the truck); never waited for:
  // with a dead signal it would hold « Je pars » for 15 s and could lose it if the app is closed meanwhile
  if (driving && mine && !openShift(mine)) void shiftStart().then(() => toast(t('jobs.did.shiftStarted')), () => undefined);
  // where the phone is (for the arrival time), asked while the step goes: it never holds « Je pars »
  const where = driving ? quickPosition() : Promise.resolve(undefined);
  let r: unknown;
  try {
    r = await jobStep(j.id, 'leave');
  } catch (e) {
    refused(j, e);
    return;
  }
  if (isQueued(r)) { keepAhead(j, { status: 'en_route' }); toast(t('jobs.did.leaveOffline')); return; }
  // the text goes on its own (its result comes as a toast): the button is free at once for « Je suis arrivé »
  void where.then((pos) => sendTracking(j, { pos, afterLeave: true, driving }));
}

/** « Je suis arrivé »: on site (the server ends the trip); the customer gets the invoice to pay during the work; then the
    car's km and VIN. The button is free as soon as the step is kept: the text and the car sheet follow on their own. */
export async function doArrive(j: Job): Promise<void> {
  let r: unknown;
  try {
    r = await jobStep(j.id, 'arrive');
  } catch (e) {
    refused(j, e);
    return;
  }
  if (isQueued(r)) { keepAhead(j, { status: 'on_site' }); toast(t('shell.queued')); void carAtArrival(j); return; }
  void afterArrival(j);
}
async function afterArrival(j: Job): Promise<void> {
  const said = t('jobs.did.arrive', { name: jobFirstName(j) });
  if (!wantsArrivalText(j)) toast(said, { kind: 'ok' });
  else if (!(await sendText('arrived', j, { okText: t('jobs.did.arriveInvoice', { name: jobFirstName(j) }) }))) toast(said, { kind: 'ok' });
  await carAtArrival(j);
}

/** the job's car as the phone has it (none: no car on the job, or its file was deleted) */
function carOf(j: Job): Vehicle | null {
  const found = j.vehicle_id ? getRow<Vehicle>('vehicles', j.vehicle_id) : null;
  return found && !found.deleted_at ? found : null;
}
/** the person is still in front of this job (its sheet, or « Aujourd'hui »): a slow text must not open its car sheet
    over another job's screen */
function stillHere(j: Job): boolean {
  const p = route.value.path;
  return p === '/' || p === '' || p === `/job/${j.id}`;
}
/** once there: the km on the dashboard, and the VIN when the car has none (« La voiture »; « Plus tard » skips it) */
async function carAtArrival(j: Job): Promise<void> {
  const car = carOf(j);
  // the VIN is asked before the work starts (the red button stays « Le NIV de l’auto » until it is given or said unreadable)
  const need = vinNeeded({ id: j.id, status: 'on_site', vehicle_id: j.vehicle_id }, car, vinSkips.value);
  if (!need && (!car || j.odometer_km != null)) return;
  // the text to send by hand (texts not connected) comes first: one sheet at a time
  await outcomeClosed();
  if (!stillHere(j)) return;
  const a = await askCar(j, car, need);
  if (a) await saveCar(j, car, a);
}
/** the red button « Le NIV de l’auto »: scan it, type it, or pick a car of the customer */
export async function doVin(j: Job): Promise<void> {
  const car = carOf(j);
  const a = await askCar(j, car, true);
  if (a) await saveCar(j, car, a);
}

/* ---------- Terminer ---------- */
/** the parts this job used, confirmed by the person: null when they stepped back; nothing to send when the phone knows of
    no planned part (the server then takes the parts it plans itself: a phone whose copy of the services' parts is not
    complete yet must not tell the server « none ») */
async function partsUsed(j: Job): Promise<{ parts?: UsedPart[] } | null> {
  const planned = plannedParts(j.id);
  if (!planned.length) return {};
  const parts = await confirmParts(j, planned);
  return parts ? { parts } : null;
}
/** « Le client paiera plus tard » (owner, office): the job ends, the invoice stays to collect */
export async function letGo(j: Job, used?: { parts?: UsedPart[] }): Promise<boolean> {
  const reason = await askText({ title: t('jobs.ask.payLaterTitle'), text: t('jobs.ask.payLaterText'), label: t('jobs.ask.payLaterLabel'), ok: t('jobs.ask.payLaterOk') });
  if (reason == null) return false;
  const parts = used ?? await partsUsed(j);
  if (!parts) return false;
  return stepKept(j, 'finish', { pay_later: true, reason, ...parts }, t('jobs.did.payLater'), 'done');
}
/** « Terminer la job »: the parts used are confirmed first (they leave the inventory with the step); needs the payment,
    unless the office lets the customer go (already granted when the job came back from « Terminée »: the same reason) */
export async function doFinish(j: Job, rights: Pick<JobRights, 'payLater'>): Promise<boolean> {
  const parts = await partsUsed(j);
  if (!parts) return false;
  const inv = invoiceOf(j.id);
  const later = j.pay_later && rights.payLater && inv?.status === 'issued' ? { pay_later: true, reason: j.pay_later_reason || '' } : {};
  try {
    const r = await jobStep(j.id, 'finish', { ...later, ...parts });
    if (isQueued(r)) keepAhead(j, { status: 'done' });
    toast(isQueued(r) ? t('shell.queued') : t('jobs.did.finish'), { kind: isQueued(r) ? 'info' : 'ok' });
    return true;
  } catch (e) {
    if (codeOf(e) === 'pay_first') {
      if (rights.payLater) return letGo(j, parts);
      const phone = settings.value.company?.phone;
      toast(t('jobs.ask.payFirstMechanic'), { kind: 'bad', action: phone ? { label: t('jobs.ask.callOffice'), run: () => { location.href = `tel:${phone.replace(/[^\d+]/g, '')}`; } } : undefined });
      void pull('invoices');
      return false;
    }
    refused(j, e);
    return false;
  }
}

/* ---------- the « … » menu's steps ---------- */
export async function doCancel(j: Job) {
  const reason = await askText({ title: t('jobs.ask.cancelTitle'), text: wt(j, 'jobs.ask.cancelText'), label: t('jobs.ask.cancelLabel'), ok: t('jobs.ask.cancelOk'), danger: true });
  if (reason == null) return false;
  return stepKept(j, 'cancel', { reason }, wt(j, 'jobs.did.cancel'), 'cancelled');
}
export async function doNoShow(j: Job) {
  const reason = await askText({ title: t('jobs.ask.noShowTitle'), text: t('jobs.ask.noShowText'), label: t('jobs.ask.noShowLabel'), ok: t('jobs.ask.noShowOk'), danger: true });
  if (reason == null) return false;
  return stepKept(j, 'no_show', { reason }, t('jobs.did.no_show'), 'no_show');
}
/** the status a step back leads to (null: nothing to undo) */
export function backTo(s: Job['status']): Job['status'] | null {
  return s === 'en_route' ? 'booked' : s === 'on_site' ? 'en_route' : s === 'done' ? 'on_site' : null;
}
export async function doBack(j: Job) {
  const text = j.status === 'en_route' ? t('jobs.ask.backRoute') : j.status === 'on_site' ? t('jobs.ask.backSite') : t('jobs.ask.backDone');
  if (!(await ask({ title: t('jobs.ask.backTitle'), text, ok: t('jobs.ask.backOk') }))) return false;
  return stepKept(j, 'back', {}, t('jobs.did.back'), backTo(j.status));
}
export async function doReopen(j: Job) {
  if (!(await ask({ title: t('jobs.ask.reopenTitle'), text: wt(j, 'jobs.ask.reopenText'), ok: t('jobs.ask.reopenOk') }))) return false;
  return stepKept(j, 'reopen', {}, t('jobs.did.reopen'), 'booked');
}

/** « Faire la facture »: the draft is made from the work, once (an existing draft keeps its changes: never p_refresh here,
    a call sent late must not rewrite the lines of a draft someone edited meanwhile) */
export async function startInvoice(j: Job): Promise<boolean> {
  if (invoiceOf(j.id)) return true;
  // already asked, waiting for signal: not a second time
  if (invoiceWaiting(j.id)) { toast(t('shell.queued')); return true; }
  return (await run(() => invoiceForJob(j.id, false), { ok: t('jobs.did.invoice') })) !== undefined;
}
