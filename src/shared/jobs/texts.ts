/* The texts to the customer from the job's buttons (confirmation, moved, « en route » with the tracking link, arrived with
   the invoice, extra work to approve), and what to do when one could not go: the message and the link are put in
   `outcome`, which the « text to send by hand » sheet (TextOutcome.tsx) shows. Every function says how it went and never
   throws. */
import { signal } from '@preact/signals';
import type { Job } from '../../data/types';
import { enroute, notify, errorMessage } from '../../data/api';
import { pull, refetch, isNetworkError, uuid } from '../../data/sync';
import { jobTotals, settings, customer as customerRow, itemsOf, job as jobRow } from '../../data/select';
import { toast, whenHistorySettled } from '../../ui';
import { t } from '../../lib/i18n';
import { quickPosition } from '../../services/position';
import { arrivalTextWanted, textSays } from '../../domain/jobs/texts';
import { intents, keepOp, KEEP_OP_MS } from '../../domain/jobs/intents';
import { jobFirstName, clockOf } from './select';
import { rememberLink } from './links';

/* ---------- a text that did not go: the message and the link, to send by hand ---------- */
export interface TextOutcome { status: string; message?: string | null; link?: string | null; phone?: string | null; error?: string | null }
export const outcome = signal<TextOutcome | null>(null);
/** jobs whose « en route » text went out (or is going out) from this phone; the trip row comes with the next refresh */
export const trackingSent = signal<Set<string>>(new Set());

/** what the server said about a text: a toast when it went (or did not have to), else the sheet to send it by hand */
function textResult(r: TextOutcome, name: string, okText?: string) {
  if (r.status === 'sent') toast(okText || t('jobs.text.sentTo', { name }), { kind: 'ok' });
  else if (r.status === 'already') toast(t('jobs.text.already'));
  else if (r.status === 'quiet') toast(t('jobs.text.quiet'));
  else outcome.value = r;
}

/** one id per text asked, kept until the server answered it: tapped again after a lost answer, the customer gets one text.
    The same text only: what it tells is part of the ask (moved to Tuesday, the answer lost, then to Thursday: Thursday is
    texted), and a kept id waits a few minutes for its retry (« Renvoyer » an hour later sends again) (jobs-r2-1) */
const textSends = intents(uuid, { maxAge: KEEP_OP_MS });
/** a text to the customer through the server (confirmation, moved, the mechanic arrived with the invoice, extra work to approve) */
export async function sendText(kind: 'booking' | 'moved' | 'extras' | 'arrived', j: Job, opts: { resend?: boolean; okText?: string } = {}): Promise<boolean> {
  const key = `${kind}|${j.id}|${opts.resend ? 'again' : ''}`;
  // the job as the server will text it: « Déplacer » passes the job as its sheet showed it, before the move
  const now = jobRow(j.id) ?? j;
  const op = textSends.op(key, textSays(kind, now, { items: itemsOf(j.id), total: jobTotals(j.id).total }));
  try {
    const r = await notify(kind, j.id, { ...opts, op });
    textSends.done(key, op);
    rememberLink(j, r.link);
    // no status: the server refused (not booked any more, no template…)
    if (!r.status) { toast(errorMessage(r), { kind: 'bad' }); return false; }
    textResult({ status: r.status, message: r.message, link: r.link, phone: r.phone, error: r.error }, jobFirstName(j), opts.okText);
    void refetch('jobs', j.id);
    if (kind === 'arrived') { void pull('invoices'); void pull('payments'); }
    void pull('messages');
    return true;
  } catch (e) {
    if (!keepOp(e, isNetworkError(e))) textSends.done(key, op);
    toast(isNetworkError(e) ? t('jobs.text.offline') : errorMessage(e), { kind: 'bad' });
    return false;
  }
}

/** the « en route » text with the arrival time and the tracking link. `pos`: where the truck is; only the phone of the one
    driving says it (the owner pressing from home must not give the customer an arrival time from his house: without a
    position the server takes the driver's own). */
export async function sendTracking(j: Job, o: { pos?: { lat: number; lng: number }; resend?: boolean; afterLeave?: boolean; driving?: boolean } = {}): Promise<boolean> {
  // in progress counts as sent (no « not sent » warning while it goes); a failure takes it back
  const mark = (on: boolean) => { const n = new Set(trackingSent.value); if (on) n.add(j.id); else n.delete(j.id); trackingSent.value = n; };
  mark(true);
  // after « Je pars » the position was already asked (it may be unknown: the server then uses the last one it has)
  const pos = o.pos || o.afterLeave || !o.driving ? o.pos : await quickPosition();
  try {
    const e = await enroute('start', j.id, { pos, notify: true, resend: o.resend });
    if (!e.ok) { mark(false); toast(errorMessage(e), { kind: 'bad' }); return false; }
    const r: TextOutcome = { status: e.sms, message: e.message, link: e.link, phone: e.phone, error: e.error };
    if (o.afterLeave) {
      const time = e.eta_at ? clockOf(e.eta_at) : '';
      if (e.sms === 'sent') toast(time ? t('jobs.did.leaveEta', { time }) : t('jobs.did.leave'), { kind: 'ok' });
      else if (e.sms === 'quiet') toast(t('jobs.did.leaveQuiet'));
      // no cell number on the file: the button said « Le bureau voit que tu es en route », nothing to send by hand
      else if (e.sms === 'already' || e.sms === 'no_phone') toast(t('jobs.did.leaveNoText'), { kind: 'ok' });
      else { toast(t('jobs.did.leaveNoText'), { kind: 'ok' }); outcome.value = r; }
    } else {
      textResult(r, jobFirstName(j));
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

/** should the customer get the invoice when the mechanic arrives? (the switch is on, a number that takes texts, not the
    Coffre, and some priced work: an empty invoice is refused by the server and would only leave an empty draft) */
export function wantsArrivalText(j: Job): boolean {
  const c = customerRow(j.customer_id);
  return arrivalTextWanted({ on: settings.value.messages?.on?.arrived !== false, coffre: !!j.coffre_id, phone: c?.phone, smsOk: c?.sms_ok, total: jobTotals(j.id).total });
}

/** resolves once no « text to send by hand » sheet is open, and its step back in the history is done */
export function outcomeClosed(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let stop: (() => void) | undefined;
    stop = outcome.subscribe((o) => {
      if (o || done) return;
      done = true;
      setTimeout(() => { stop?.(); whenHistorySettled(resolve); }, 150);
    });
  });
}
