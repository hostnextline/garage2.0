/* After a booking or a move: the customer's text (confirmation, change). When the texts are not connected (or fail),
   the person gets the message and the link to send it from their own phone. The sheet lives in its own little root
   so it stays open when the screen changes (after « Réserver », the app goes to the job).
   Part 28 (REARRANGE.md §3.3-5, days F6): when the server's answer says the hours that text told (`told`), the sheet
   offers « C'est envoyé »: the customer is marked told by hand (tell_mark how 'hand'), so « Envoyer les heures aux
   clients » never texts him a second time what was sent from this phone. */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { MessageSquare, Copy, Share2, CheckCheck } from 'lucide-preact';
import { notify, errorMessage } from '../../data/api';
import { tellMark, type TellKindName } from '../../data/tell';
import { uuid, refetch } from '../../data/sync';
import { isNetworkError } from '../../lib/errors';
import { job as jobRow, customer as customerRow, settings } from '../../data/select';
import { choiceWords } from '../../domain/moment/choice';
import { t } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import type { Job } from '../../data/types';
import { Sheet, Button, toast } from '../../ui';
import './notify.css';

export type NotifyKind = 'booking' | 'moved';
/** `when`: « Plages d'arrivée »: the window the customer was told (« Demain, entre 14 h et 18 h »), said above the text so
    the person sending it by hand sees the two agree */
interface Msg {
  name: string; phone: string | null; message: string; link: string | null; when?: string | null;
  /** the hours this text told, its kind and appointment (Part 28): « C'est envoyé » */
  told?: { day: string; start: number | null; end: number | null } | null; kind?: string | null; jobId?: string | null;
}
const msg = signal<Msg | null>(null);
let host: HTMLElement | null = null;
function ensureHost() {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.dataset.owner = 'booking-sms';
  document.body.appendChild(host);
  render(<MessageHost />, host);
}

/** should a text go out for this job? (the setting is on, the customer has a number and accepts texts). A switch the
    settings do not hold yet counts as ON, as for the server (`notify` is quiet only on `false`) and Réglages */
export function wantsText(kind: NotifyKind, jobId: string): boolean {
  if (settings.value.messages?.on?.[kind] === false) return false;
  const j = jobRow(jobId);
  const c = customerRow(j?.customer_id);
  return !!c && !!c.phone && c.sms_ok !== false;
}

/** the window of an appointment booked by window, in words (a block appointment: nothing, its text says the block) */
function windowSaid(j: Pick<Job, 'day' | 'block' | 'win_start' | 'win_end' | 'win_flex'> | null | undefined): string | null {
  if (!j || j.block !== 'day') return null;
  return choiceWords({ day: j.day, block: 'day', win_start: j.win_start ?? null, win_end: j.win_end ?? null, win_flex: !!j.win_flex && j.win_start == null });
}

/** the wait before the one new try of a send whose answer never came (a weak signal) */
export const NOTIFY_RETRY_MS = 2000;
/** the wait before asking once more a send the server says is still going on (« busy », after a lost answer) */
export const NOTIFY_BUSY_MS = 5000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** the send, with its own id (`op`, R27): when the answer is lost on the way (no network, a timeout), it is asked once more
    with the SAME id, so the server answers what the first one did (« sent ») instead of texting the customer twice; a
    refusal or any answer of the server is never asked again. After a timeout the first send may still be running on the
    server (a slow text provider): the server then answers « busy » (409) without its outcome, and the same id is asked
    one last time a few seconds later (moment-pickers-r2-1) */
async function sendOnce(kind: NotifyKind, jobId: string) {
  const op = uuid();
  try { return await notify(kind, jobId, { op }); } catch (e) {
    if (!isNetworkError(e)) throw e;
    await pause(NOTIFY_RETRY_MS);
    const r = await notify(kind, jobId, { op });
    if (r?.code !== 'busy') return r;
    await pause(NOTIFY_BUSY_MS);
    return await notify(kind, jobId, { op });
  }
}

/** sends the customer's text and says what happened (never throws) */
export async function notifyCustomer(kind: NotifyKind, jobId: string, opts: { customerId?: string | null; when?: string | null } = {}): Promise<void> {
  const c = customerRow(opts.customerId ?? jobRow(jobId)?.customer_id);
  const name = c ? (c.first_name || c.company || c.last_name || '') : '';
  try {
    const r = await sendOnce(kind, jobId);
    const status = String(r?.status || (r?.ok === false ? 'error' : ''));
    // the window as the server has it now (the job's row), else the one just chosen on the screen
    const open = () => openMessage({ name, phone: r?.phone ?? c?.phone ?? null, message: r?.message || '', link: r?.link || null, when: windowSaid(jobRow(jobId)) ?? opts.when ?? null,
      ...(r?.told ? { told: r.told, kind: r.kind ?? kind, jobId: r.job_id ?? jobId } : {}) });
    if (status === 'sent') toast(t(`booking.sms.sent.${kind}`), { kind: 'ok' });
    else if (status === 'already') toast(t('booking.sms.already'));
    else if (status === 'no_phone') toast(t('booking.sms.noPhone'));
    // the customer does not want texts, or this kind is switched off: nothing failed
    else if (status === 'quiet') toast(t('booking.momentPickers.smsQuiet'));
    else if ((status === 'off' || status === 'error') && (r?.message || r?.link)) {
      toast(t(status === 'off' ? 'booking.sms.off' : 'booking.sms.error'), { kind: status === 'error' ? 'bad' : 'info', ms: 12000, action: { label: t('booking.sms.show'), run: open } });
    }
    // the same send still going on on the server: its outcome is not known yet (the customer may have the text), never
    // « n'est pas parti »; the server's own words, calmly
    else if (r?.code === 'busy') toast(errorMessage(r));
    else if (r?.ok === false || status === 'error') toast(t('booking.sms.failed', { msg: r?.error || '' }).trim(), { kind: 'bad' });
  } catch (e) {
    toast(t('booking.sms.failed', { msg: errorMessage(e) }), { kind: 'bad' });
  }
}

function openMessage(m: Msg) { ensureHost(); msg.value = m; }

const KINDS: readonly string[] = ['booking', 'window', 'moved'];
/** « C'est envoyé »: marked told by hand with the hours that text said (only while they are still the ones to tell) */
async function handed(m: Msg): Promise<boolean> {
  if (!m.told || !m.jobId) return false;
  const kind = (m.kind && KINDS.includes(m.kind) ? m.kind : null) as TellKindName | null;
  try {
    const a = await tellMark([{ id: m.jobId, how: 'hand', kind, day: m.told.day, start: m.told.start, end: m.told.end }]);
    void refetch('jobs', m.jobId);
    if (a.marked.includes(m.jobId)) { toast(t('tell.marked', { n: 1, names: m.name }), { kind: 'ok' }); return true; }
    toast(t(a.busy.includes(m.jobId) ? 'tell.busy' : 'tell.markChanged', { names: m.name }));
    return false;
  } catch (e) {
    toast(isNetworkError(e) ? t('tell.offline') : errorMessage(e), { kind: 'bad' });
    return false;
  }
}

function MessageHost() {
  const m = msg.value;
  const close = () => { msg.value = null; };
  if (!m) return null;
  const body = m.link && !m.message.includes(m.link) ? `${m.message}\n${m.link}`.trim() : m.message;
  const tel = e164(m.phone) || m.phone || '';
  // « sms:+15145550141?&body=… » opens Messages on iPhone and Android with the text ready
  const smsHref = `sms:${tel}?&body=${encodeURIComponent(body)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); toast(t('booking.sms.copied'), { kind: 'ok' }); } catch { toast(t('booking.sms.copyFail')); }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Sheet open onClose={close} title={t('booking.sms.title', { name: m.name || '' }).trim()} sub={t('booking.sms.lead')} data-testid="sms-sheet"
      footer={<>
        <Button variant="primary" block icon={<MessageSquare />} href={smsHref}>{t('booking.sms.open')}</Button>
        {m.told && m.jobId && <Button block icon={<CheckCheck />} onClick={async () => { if (await handed(m)) close(); }} data-testid="sms-handed">{t('tell.sentByHand')}</Button>}
      </>}>
      <div class="stack">
        {m.when && <p class="small muted" style={{ margin: 0 }} data-testid="sms-when">{t('booking.win.smsWhen', { when: m.when })}</p>}
        <p class="sms-bubble" data-testid="sms-text">{body}</p>
        <div class="row-wrap">
          <Button icon={<Copy />} onClick={copy}>{t('booking.sms.copy')}</Button>
          {canShare && <Button icon={<Share2 />} onClick={async () => { try { await navigator.share({ text: body }); } catch { /* closed */ } }}>{t('booking.sms.share')}</Button>}
        </div>
      </div>
    </Sheet>
  );
}
