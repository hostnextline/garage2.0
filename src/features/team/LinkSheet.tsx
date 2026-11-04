/* The link of an invitation (or of a new password) when it was not sent by the app: the person copies it or shares it.
   Also: the choice « Courriel / Texto / Copier le lien » used by both. */
import { useState } from 'preact/hooks';
import { Copy, Share2, MessageSquare, Mail } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Sheet, Button, Banner, Seg, Field, toast } from '../../ui';
import { copyText, canShare, shareLink, smsHref, mailHref, type LinkResult, type SendHow } from './teamApi';

export function HowSeg(p: { value: SendHow; onValue: (v: SendHow) => void; label: string }) {
  return (
    <Seg label={p.label} value={p.value} onValue={p.onValue} data-testid="send-how"
      options={[{ value: 'email', label: t('team.sendHow.email') }, { value: 'sms', label: t('team.sendHow.sms') }, { value: 'none', label: t('team.sendHow.none') }]} />
  );
}

export function LinkSheet(p: { result: LinkResult | null; onClose: () => void }) {
  const r = p.result;
  const [copied, setCopied] = useState(false);
  if (!r) return null;
  const why = ['off', 'no_phone', 'no_email', 'error', 'none'].includes(r.sent) ? r.sent : 'none';
  const smsBody = r.message?.sms || r.link;
  const mailBody = r.message?.text || r.link;
  const subject = r.message?.subject || t('team.link.title', { name: r.name });
  const copy = async () => {
    const ok = await copyText(r.link);
    setCopied(ok);
    toast(ok ? t('team.link.copied') : t('team.link.copyFail'), { kind: ok ? 'ok' : 'bad' });
  };
  return (
    <Sheet open onClose={p.onClose} title={t('team.link.title', { name: r.name })} data-testid="link-sheet"
      footer={<Button variant="primary" onClick={p.onClose}>{t('team.link.done')}</Button>}>
      <div class="stack">
        <Banner kind={why === 'error' ? 'warn' : 'info'}>
          {t(`team.link.${why}`, { name: r.name })}
          {why === 'error' && r.error ? <span class="small" style={{ display: 'block', marginTop: '4px' }}>{r.error}</span> : null}
        </Banner>
        <Field label={t('team.link.label')} hint={t('team.link.hint')}>
          <input class="input team-link" readOnly value={r.link} data-testid="invite-link" onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        </Field>
        <div class="row-wrap">
          <Button variant={copied ? 'secondary' : 'primary'} icon={<Copy size={18} />} onClick={copy} data-testid="link-copy">{copied ? t('team.link.copied') : t('team.link.copy')}</Button>
          {canShare() && <Button icon={<Share2 size={18} />} onClick={() => shareLink(subject, smsBody, r.link)} data-testid="link-share">{t('team.link.share')}</Button>}
          {r.phone && <Button icon={<MessageSquare size={18} />} href={smsHref(r.phone, smsBody)}>{t('team.link.text')}</Button>}
          {r.email && <Button icon={<Mail size={18} />} href={mailHref(r.email, subject, mailBody)}>{t('team.link.email')}</Button>}
        </div>
      </div>
    </Sheet>
  );
}
