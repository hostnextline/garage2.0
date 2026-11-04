/* What the buttons of a job do, the same from « Ma journée » and from the job sheet: the steps (Je pars, Je suis arrivé,
   Terminer…), the texts to the customer and what to do when a text could not go, the signatures.
   Every action shows its own result (a toast, or the text to send by hand) and never throws. */
import { signal } from '@preact/signals';
import type { Job, JobItem, JobStatus } from '../../data/types';
import { jobStep, enroute, notify, errorMessage, shiftStart, invoiceForJob, saveSignature, answerExtra, Refused, type StepAction } from '../../data/api';
import { pull, refetch, insertRow, uuid, isNetworkError } from '../../data/sync';
import { me, preview } from '../../data/auth';
import { openShift, truck, invoiceOf, settings } from '../../data/select';
import { toast, ask, askText, attempt, run } from '../../ui';
import { t } from '../../lib/i18n';
import { quickPosition } from '../today/position';
import { jobFirstName, rememberLink, clockOf, keepAhead, type JobRights } from './select';
import { exportSignature, type Stroke } from './signature';

const isQueued = (r: unknown) => !!r && typeof r === 'object' && (r as { queued?: boolean }).queued === true;

/** a step: on screen at once when it waits for signal; the result toast says what happened */
async function stepKept(j: Job, action: StepAction, data: Record<string, unknown>, ok: string, after: JobStatus | null): Promise<boolean> {
  const r = await run(() => jobStep(j.id, action, data), { ok });
  if (r === undefined) return false;
  if (isQueued(r) && after) keepAhead(j, { status: after });
  return true;
}
const codeOf = (e: unknown) => String((e as { hint?: string } | null)?.hint || (e as { code?: string } | null)?.code || '');

/* ---------- a text that did not go: the message and the link, to send by hand ---------- */
export interface TextOutcome { status: string; message?: string | null; link?: string | null; phone?: string | null; error?: string | null }
export const outcome = signal<TextOutcome | null>(null);
/** jobs whose « en route » text went out (or is going out) from this phone; the trip row comes with the next refresh */
export const trackingSent = signal<Set<string>>(new Set());

function textResult(status: string, r: TextOutcome, name: string, okText?: string) {
  if (status === 'sent') toast(okText || t('jobs.text.sentTo', { name }), { kind: 'ok' });
  else if (status === 'already') toast(t('jobs.text.already'));
  else if (status === 'quiet') toast(t('jobs.text.quiet'));
  else outcome.value = { ...r, status };
}

/** a text to the customer through the server (confirmation, moved, extra work to approve) */
export async function sendText(kind: 'booking' | 'moved' | 'extras', j: Job, opts: { resend?: boolean } = {}): Promise<boolean> {
  try {
    const r = await notify(kind, j.id, opts);
    rememberLink(j.id, r.link);
    // no status: the server refused (not booked any more, no template…)
    if (!r.status) { toast(errorMessage(r), { kind: 'bad' }); return false; }
    textResult(r.status, { status: r.status, message: r.message, link: r.link, phone: r.phone, error: r.error }, jobFirstName(j));
    void refetch('jobs', j.id);
    void pull('messages');
    return true;
  } catch (e) {
    toast(isNetworkError(e) ? t('jobs.text.offline') : errorMessage(e), { kind: 'bad' });
    return false;
  }
}

/** the « en route » text with the arrival time and the tracking link */
export async function sendTracking(j: Job, o: { pos?: { lat: number; lng: number }; resend?: boolean; afterLeave?: boolean } = {}): Promise<boolean> {
  // in progress counts as sent (no « not sent » warning while it goes); a failure takes it back
  const mark = (on: boolean) => { const n = new Set(trackingSent.value); if (on) n.add(j.id); else n.delete(j.id); trackingSent.value = n; };
  mark(true);
  // after « Je pars » the position was already asked (it may be unknown: the server then uses the last one it has)
  const pos = o.pos || o.afterLeave ? o.pos : await quickPosition();
  try {
    const e = await enroute('start', j.id, { pos, notify: true, resend: o.resend });
    if (!e.ok) { mark(false); toast(errorMessage(e), { kind: 'bad' }); return false; }
    const time = e.eta_at ? clockOf(e.eta_at) : '';
    if (o.afterLeave) {
      if (e.sms === 'sent') toast(time ? t('jobs.did.leaveEta', { time }) : t('jobs.did.leave'), { kind: 'ok' });
      else if (e.sms === 'quiet') toast(t('jobs.did.leaveQuiet'));
      else if (e.sms === 'already') toast(t('jobs.did.leaveNoText'), { kind: 'ok' });
      else { toast(t('jobs.did.leaveNoText'), { kind: 'ok' }); outcome.value = { status: e.sms, message: e.message, link: e.link, phone: e.phone, error: e.error }; }
    } else {
      textResult(e.sms, { status: e.sms, message: e.message, link: e.link, phone: e.phone, error: e.error }, jobFirstName(j));
    }
    void pull('trips');
    void pull('messages');
    void pull('jobs');
    return true;
  } catch (err) {
    mark(false);
    toast(isNetworkError(err) ? t('jobs.did.leaveTextFailed') : errorMessage(err), { kind: 'bad' });
    return false;
  }
}

/* ---------- the steps ---------- */
/** « Je pars »: the day starts if needed, the job goes en route (kept on the phone without signal), then the customer
    gets the text with the arrival time (worked out from where the phone is) */
export async function doLeave(j: Job): Promise<void> {
  const mine = me.value?.id;
  if (mine && !preview.value && truck(j.truck_id)?.driver_id === mine && !openShift(mine)) {
    // the first departure starts the driver's day: the office and the customer can follow the truck
    try { await shiftStart(); toast(t('jobs.did.shiftStarted')); } catch { /* « Je pars » goes on */ }
  }
  // where the phone is (for the arrival time), asked while the step goes: it never holds « Je pars »
  const where = quickPosition();
  let r: unknown;
  try {
    r = await jobStep(j.id, 'leave');
  } catch (e) {
    toast(errorMessage(e), { kind: 'bad' });
    return;
  }
  if (isQueued(r)) { keepAhead(j, { status: 'en_route' }); toast(t('jobs.did.leaveOffline')); return; }
  // the text goes on its own (its result comes as a toast): the button is free at once for « Je suis arrivé »
  void where.then((pos) => sendTracking(j, { pos, afterLeave: true }));
}

/** « Je suis arrivé »: on site; the customer's tracking stops */
export async function doArrive(j: Job): Promise<void> {
  try {
    const r = await jobStep(j.id, 'arrive');
    if (isQueued(r)) { keepAhead(j, { status: 'on_site' }); toast(t('shell.queued')); return; }
    toast(t('jobs.did.arrive', { name: jobFirstName(j) }), { kind: 'ok' });
    void enroute('end', j.id).then(() => pull('trips'), () => undefined);
  } catch (e) {
    toast(errorMessage(e), { kind: 'bad' });
  }
}

/** « Le client paiera plus tard » (owner, office): the job ends, the invoice stays to collect */
export async function letGo(j: Job): Promise<boolean> {
  const reason = await askText({ title: t('jobs.ask.payLaterTitle'), text: t('jobs.ask.payLaterText'), label: t('jobs.ask.payLaterLabel'), ok: t('jobs.ask.payLaterOk') });
  if (reason == null) return false;
  return stepKept(j, 'finish', { pay_later: true, reason }, t('jobs.did.payLater'), 'done');
}

/** « Terminer la job »: needs the payment, unless the office lets the customer go */
export async function doFinish(j: Job, rights: Pick<JobRights, 'payLater'>): Promise<boolean> {
  try {
    const r = await jobStep(j.id, 'finish');
    if (isQueued(r)) keepAhead(j, { status: 'done' });
    toast(isQueued(r) ? t('shell.queued') : t('jobs.did.finish'), { kind: isQueued(r) ? 'info' : 'ok' });
    return true;
  } catch (e) {
    if (codeOf(e) === 'pay_first') {
      if (rights.payLater) return letGo(j);
      const phone = settings.value.company?.phone;
      toast(t('jobs.ask.payFirstMechanic'), { kind: 'bad', action: phone ? { label: t('jobs.ask.callOffice'), run: () => { location.href = `tel:${phone.replace(/[^\d+]/g, '')}`; } } : undefined });
      return false;
    }
    toast(errorMessage(e), { kind: 'bad' });
    return false;
  }
}

export async function doCancel(j: Job) {
  const reason = await askText({ title: t('jobs.ask.cancelTitle'), text: t('jobs.ask.cancelText'), label: t('jobs.ask.cancelLabel'), ok: t('jobs.ask.cancelOk'), danger: true });
  if (reason == null) return false;
  return stepKept(j, 'cancel', { reason }, t('jobs.did.cancel'), 'cancelled');
}
export async function doNoShow(j: Job) {
  const reason = await askText({ title: t('jobs.ask.noShowTitle'), text: t('jobs.ask.noShowText'), label: t('jobs.ask.noShowLabel'), ok: t('jobs.ask.noShowOk'), danger: true });
  if (reason == null) return false;
  return stepKept(j, 'no_show', { reason }, t('jobs.did.no_show'), 'no_show');
}
export async function doBack(j: Job) {
  const text = j.status === 'en_route' ? t('jobs.ask.backRoute') : j.status === 'on_site' ? t('jobs.ask.backSite') : t('jobs.ask.backDone');
  if (!(await ask({ title: t('jobs.ask.backTitle'), text, ok: t('jobs.ask.backOk') }))) return false;
  const before: JobStatus | null = j.status === 'en_route' ? 'booked' : j.status === 'on_site' ? 'en_route' : j.status === 'done' ? 'on_site' : null;
  return stepKept(j, 'back', {}, t('jobs.did.back'), before);
}
export async function doReopen(j: Job) {
  if (!(await ask({ title: t('jobs.ask.reopenTitle'), text: t('jobs.ask.reopenText'), ok: t('jobs.ask.reopenOk') }))) return false;
  return attempt(() => jobStep(j.id, 'reopen'), { ok: t('jobs.did.reopen') });
}

/** « Faire la facture »: the draft is made from the work (once: an existing draft keeps its changes) */
export async function startInvoice(j: Job): Promise<boolean> {
  if (invoiceOf(j.id)) return true;
  return attempt(() => invoiceForJob(j.id, true), { ok: t('jobs.did.invoice') });
}

/* ---------- signatures (the finger on the phone; never a photo) ---------- */
/** the authorization of work, signed by the customer */
export async function signWaiver(j: Job, strokes: Stroke[], signer: string): Promise<boolean> {
  const png = exportSignature(strokes);
  if (!png) { toast(t('errors.signature'), { kind: 'bad' }); return false; }
  const r = await run(() => saveSignature(j.id, png.dataUrl, signer, settings.value.waiver?.version || '1'), { ok: t('jobs.did.waiver') });
  if (r === undefined) return false;
  if (isQueued(r)) keepAhead(j, { waiver: new Date().toISOString() });
  return true;
}
/** proposed work answered by the customer on the phone: the signature is kept with the job, then the answer */
export async function answerBySignature(item: JobItem, accept: boolean, strokes: Stroke[]): Promise<boolean> {
  return attempt(async () => {
    if (preview.value) throw new Refused('preview', t('errors.preview'));
    const png = accept ? exportSignature(strokes) : null;
    if (png) {
      const data = png.dataUrl.split(',')[1] || '';
      await insertRow('attachments', { id: uuid(), kind: 'signature', mime: 'image/png', data, bytes: Math.round(data.length * 0.75), width: png.width, height: png.height, job_id: item.job_id, created_at: new Date().toISOString() });
    }
    return answerExtra(item.id, accept, 'signature');
  }, { ok: accept ? t('jobs.work.accepted') : t('jobs.work.declined') });
}
/** the customer answered the office on the phone */
export function answerByVoice(item: JobItem, accept: boolean): Promise<boolean> {
  return attempt(() => answerExtra(item.id, accept, 'verbal'), { ok: accept ? t('jobs.work.accepted') : t('jobs.work.declined') });
}
