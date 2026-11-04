/* After a booking or a move: the customer's text (confirmation, change). When the texts are not connected (or fail),
   the person gets the message and the link to send it from their own phone. The sheet lives in its own little root
   so it stays open when the screen changes (after « Réserver », the app goes to the job). */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { MessageSquare, Copy, Share2 } from 'lucide-preact';
import { notify, errorMessage } from '../../data/api';
import { job as jobRow, customer as customerRow, settings } from '../../data/select';
import { t } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import { Sheet, Button, toast } from '../../ui';

export type NotifyKind = 'booking' | 'moved';
interface Msg { name: string; phone: string | null; message: string; link: string | null }
const msg = signal<Msg | null>(null);
let host: HTMLElement | null = null;
function ensureHost() {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.dataset.owner = 'booking-sms';
  document.body.appendChild(host);
  render(<MessageHost />, host);
}

/** should a text go out for this job? (the setting is on, the customer has a number and accepts texts) */
export function wantsText(kind: NotifyKind, jobId: string): boolean {
  if (!settings.value.messages?.on?.[kind]) return false;
  const j = jobRow(jobId);
  const c = customerRow(j?.customer_id);
  return !!c && !!c.phone && c.sms_ok !== false;
}

/** sends the customer's text and says what happened (never throws) */
export async function notifyCustomer(kind: NotifyKind, jobId: string, opts: { customerId?: string | null } = {}): Promise<void> {
  const c = customerRow(opts.customerId ?? jobRow(jobId)?.customer_id);
  const name = c ? (c.first_name || c.company || c.last_name || '') : '';
  try {
    const r = await notify(kind, jobId);
    const status = String(r?.status || (r?.ok === false ? 'error' : ''));
    const open = () => openMessage({ name, phone: r?.phone ?? c?.phone ?? null, message: r?.message || '', link: r?.link || null });
    if (status === 'sent') toast(t(`booking.sms.sent.${kind}`), { kind: 'ok' });
    else if (status === 'already') toast(t('booking.sms.already'));
    else if (status === 'no_phone') toast(t('booking.sms.noPhone'));
    else if ((status === 'off' || status === 'error') && (r?.message || r?.link)) {
      toast(t(status === 'off' ? 'booking.sms.off' : 'booking.sms.error'), { kind: status === 'error' ? 'bad' : 'info', ms: 12000, action: { label: t('booking.sms.show'), run: open } });
    } else if (r?.ok === false || status === 'error') toast(t('booking.sms.failed', { msg: r?.error || '' }).trim(), { kind: 'bad' });
  } catch (e) {
    toast(t('booking.sms.failed', { msg: errorMessage(e) }), { kind: 'bad' });
  }
}

export function openMessage(m: Msg) { ensureHost(); msg.value = m; }

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
        <p class="sms-bubble" data-testid="sms-text">{body}</p>
        <div class="row-wrap">
          <Button icon={<Copy />} onClick={copy}>{t('booking.sms.copy')}</Button>
          {canShare && <Button icon={<Share2 />} onClick={async () => { try { await navigator.share({ text: body }); } catch { /* closed */ } }}>{t('booking.sms.share')}</Button>}
        </div>
      </div>
    </Sheet>
  );
}
