/* When a text to the customer could not go (texts not set up, no cell number, the service refused): the message and
   the link are ready, to send from the person's own phone (Messages, share, copy). Drawn by one host (hosts.ts): dropped
   when the person leaves for a screen that shows none, rather than popping up later somewhere else.
   Part 28 (REARRANGE.md §3.3-5, days F6): when the answer says the hours that text told (a booking / window / moved text
   with texting off, or one that failed), « C'est envoyé » marks the customer told by hand (tell_mark how 'hand'), so
   « Envoyer les heures aux clients » never texts him again what someone already sent him. */
import { MessageSquareText, Share2, Copy, CheckCheck } from 'lucide-preact';
import { Sheet, Button, toast } from '../../ui';
import { t } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import { tellMark, type TellKindName } from '../../data/tell';
import { errorMessage } from '../../data/api';
import { isNetworkError, refetch } from '../../data/sync';
import { job as jobRow } from '../../data/select';
import { outcome, type TextOutcome } from './texts';
import { useHostTurn } from './hosts';
import { jobFirstName } from './select';

/** copies a text; false when the phone refuses (then the person selects it by hand) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
/** a « sms: » link that opens Messages with the text written (iPhone and Android) */
export function smsHref(phone: string | null | undefined, body: string): string {
  return `sms:${e164(phone) || ''}?&body=${encodeURIComponent(body)}`;
}

const close = () => { outcome.value = null; };

const KINDS: readonly string[] = ['booking', 'window', 'moved'];
/** « C'est envoyé »: the text sent by hand told him those hours (marked only while they are still the ones to tell) */
export async function sentByHand(o: Pick<TextOutcome, 'told' | 'kind' | 'jobId'>): Promise<boolean> {
  if (!o.told || !o.jobId) return false;
  const kind = (o.kind && KINDS.includes(o.kind) ? o.kind : null) as TellKindName | null;
  try {
    const a = await tellMark([{ id: o.jobId, how: 'hand', kind, day: o.told.day, start: o.told.start, end: o.told.end }]);
    const j = jobRow(o.jobId);
    const names = j ? jobFirstName(j) : '';
    void refetch('jobs', o.jobId);
    if (a.marked.includes(o.jobId)) { toast(t('tell.marked', { n: 1, names }), { kind: 'ok' }); return true; }
    if (a.busy.includes(o.jobId)) toast(t('tell.busy', { names }));
    else toast(t('tell.markChanged', { names }));
    return false;
  } catch (e) {
    toast(isNetworkError(e) ? t('tell.offline') : errorMessage(e), { kind: 'bad' });
    return false;
  }
}

export function TextOutcomeHost() {
  const mine = useHostTurn('text-outcome', close);
  const o = outcome.value;
  if (!o || !mine) return null;
  const body = (o.message || o.link || '').trim();
  const why = o.status === 'no_phone' ? t('jobs.text.no_phone') : o.status === 'error' ? t('jobs.text.error') : t('jobs.text.off');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Sheet open onClose={close} title={t('jobs.text.failTitle')} data-testid="text-outcome"
      footer={<>
        <Button onClick={close}>{t('common.close')}</Button>
        {o.told && o.jobId && <Button variant="primary" icon={<CheckCheck />} onClick={async () => { if (await sentByHand(o)) close(); }} data-testid="text-outcome-handed">{t('tell.sentByHand')}</Button>}
      </>}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{why}</p>
        {o.status === 'error' && o.error && <p class="small faint" style={{ margin: 0 }}>{t('jobs.text.errorDetail', { error: o.error })}</p>}
        {body && (
          <div class="field">
            <span class="field-label">{t('jobs.text.message')}</span>
            <p class="jobs-msgbox" data-testid="text-outcome-message">{body}</p>
          </div>
        )}
        {o.link && o.message && !o.message.includes(o.link) && (
          <div class="field">
            <span class="field-label">{t('jobs.text.link')}</span>
            <p class="jobs-msgbox jobs-msgbox-link">{o.link}</p>
          </div>
        )}
        {body && (
          <div class="jobs-outcome-actions">
            {o.status !== 'no_phone' && <Button variant="primary" icon={<MessageSquareText />} href={smsHref(o.phone, body)}>{t('jobs.text.openSms')}</Button>}
            {canShare && <Button icon={<Share2 />} onClick={async () => { try { await navigator.share({ text: body }); } catch { /* closed */ } }}>{t('jobs.text.share')}</Button>}
            <Button icon={<Copy />} onClick={async () => { const ok = await copyText(body); toast(ok ? t('jobs.text.copied') : t('jobs.text.copyFail'), { kind: ok ? 'ok' : 'bad' }); }}>{t('jobs.text.copy')}</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
