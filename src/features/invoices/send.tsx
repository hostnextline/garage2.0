/* Texting an invoice or a reminder to the customer (notify). When the garage's automatic texts are not set up, the
   number is missing or the service failed, the server gives back the message and the link: the person sends it
   from their own phone (Messages, copy, « Partager »). */
import { MessageSquareText, Copy, Share2 } from 'lucide-preact';
import { notify, errorMessage } from '../../data/api';
import { t } from '../../lib/i18n';
import { formatPhone } from '../../lib/text';
import { Sheet, Button, Banner, toast } from '../../ui';
import { copyText, canShareText, shareText, smsHref } from './share';

export type TextKind = 'invoice' | 'payment_reminder';
export interface SendResult { kind: TextKind; status: string; message: string; link?: string; phone?: string | null }

/** sends the text; returns what to send by hand when the server could not (null when sent, or refused: a toast says so) */
export async function sendText(kind: TextKind, jobId: string, okText?: string): Promise<SendResult | null> {
  try {
    const r = await notify(kind, jobId);
    if (r.status === 'sent') { toast(okText || t(kind === 'invoice' ? 'invoices.send.sent' : 'invoices.send.reminded'), { kind: 'ok' }); return null; }
    if (r.message && ['off', 'no_phone', 'error', 'quiet'].includes(String(r.status))) {
      return { kind, status: String(r.status), message: r.message, link: r.link, phone: r.phone ?? null };
    }
    toast(errorMessage(r), { kind: 'bad' });
  } catch (e) {
    toast(errorMessage(e), { kind: 'bad' });
  }
  return null;
}

/** « Envoie-le de ton téléphone »: the text the server prepared, ready for Messages, copy or « Partager » */
export function SendSheet(p: { result: SendResult | null; onClose: () => void }) {
  const r = p.result;
  if (!r) return null;
  const why = ['off', 'no_phone', 'error', 'quiet'].includes(r.status) ? r.status : 'error';
  return (
    <Sheet open onClose={p.onClose} title={t('invoices.send.manualTitle')} data-testid="send-sheet"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        <Banner kind="warn">{t(`invoices.send.why.${why}`)}</Banner>
        {r.phone && <p class="muted small" style={{ margin: 0 }}>{t('invoices.send.to', { phone: formatPhone(r.phone) })}</p>}
        <p class="inv-message" data-testid="send-message">{r.message}</p>
        {r.link && !r.message.includes(r.link) && (
          <div class="stack" style={{ gap: 'var(--sp-2)' }}>
            <span class="field-label">{t('invoices.send.link')}</span>
            <p class="inv-message" data-testid="send-link">{r.link}</p>
            <Button icon={<Copy />} onClick={async () => { const ok = await copyText(r.link!); toast(ok ? t('invoices.send.linkCopied') : t('invoices.send.copyFailed'), { kind: ok ? 'ok' : 'bad' }); }}>{t('invoices.send.copyLink')}</Button>
          </div>
        )}
        <div class="inv-actions">
          <Button variant="primary" icon={<MessageSquareText />} href={smsHref(r.phone, r.message)} data-testid="send-sms">{t('invoices.send.openSms')}</Button>
          <Button icon={<Copy />} onClick={async () => { const ok = await copyText(r.message); toast(ok ? t('invoices.send.copied') : t('invoices.send.copyFailed'), { kind: ok ? 'ok' : 'bad' }); }} data-testid="send-copy">{t('common.copy')}</Button>
          {canShareText() && <Button icon={<Share2 />} onClick={() => shareText({ text: r.message })}>{t('common.share')}</Button>}
        </div>
      </div>
    </Sheet>
  );
}
