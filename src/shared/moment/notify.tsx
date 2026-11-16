/* After a booking or a move: the customer's text (confirmation, change). When the texts are not connected (or fail),
   the person gets the message and the link to send it from their own phone. The sheet lives in its own little root
   so it stays open when the screen changes (after « Réserver », the app goes to the job). */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { MessageSquare, Copy, Share2 } from 'lucide-preact';
import { notify, errorMessage } from '../../data/api';
import { job as jobRow, customer as customerRow, settings } from '../../data/select';
import { choiceWords } from '../../domain/moment/choice';
import { t } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import type { Job } from '../../data/types';
import { Sheet, Button, toast } from '../../ui';

export type NotifyKind = 'booking' | 'moved';
/** `when`: « Plages d'arrivée »: the window the customer was told (« Demain, entre 14 h et 18 h »), said above the text so
    the person sending it by hand sees the two agree */
interface Msg { name: string; phone: string | null; message: string; link: string | null; when?: string | null }
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

/** sends the customer's text and says what happened (never throws) */
export async function notifyCustomer(kind: NotifyKind, jobId: string, opts: { customerId?: string | null; when?: string | null } = {}): Promise<void> {
  const c = customerRow(opts.customerId ?? jobRow(jobId)?.customer_id);
  const name = c ? (c.first_name || c.company || c.last_name || '') : '';
  try {
    const r = await notify(kind, jobId);
    const status = String(r?.status || (r?.ok === false ? 'error' : ''));
    // the window as the server has it now (the job's row), else the one just chosen on the screen
    const open = () => openMessage({ name, phone: r?.phone ?? c?.phone ?? null, message: r?.message || '', link: r?.link || null, when: windowSaid(jobRow(jobId)) ?? opts.when ?? null });
    if (status === 'sent') toast(t(`booking.sms.sent.${kind}`), { kind: 'ok' });
    else if (status === 'already') toast(t('booking.sms.already'));
    else if (status === 'no_phone') toast(t('booking.sms.noPhone'));
    // the customer does not want texts, or this kind is switched off: nothing failed
    else if (status === 'quiet') toast(t('booking.momentPickers.smsQuiet'));
    else if ((status === 'off' || status === 'error') && (r?.message || r?.link)) {
      toast(t(status === 'off' ? 'booking.sms.off' : 'booking.sms.error'), { kind: status === 'error' ? 'bad' : 'info', ms: 12000, action: { label: t('booking.sms.show'), run: open } });
    } else if (r?.ok === false || status === 'error') toast(t('booking.sms.failed', { msg: r?.error || '' }).trim(), { kind: 'bad' });
  } catch (e) {
    toast(t('booking.sms.failed', { msg: errorMessage(e) }), { kind: 'bad' });
  }
}

function openMessage(m: Msg) { ensureHost(); msg.value = m; }

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
      footer={<Button variant="primary" block icon={<MessageSquare />} href={smsHref}>{t('booking.sms.open')}</Button>}>
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
