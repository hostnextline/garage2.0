/* « Faire signer l'autorisation »: the authorization text of the garage (Réglages) in the customer's language, the name
   of the person who signs, and the signature with the finger. Hassan's rule: a signature only, never a photo.
   The sheet cannot be closed by a tap outside once the customer started signing. */
import { useEffect, useState } from 'preact/hooks';
import type { Job } from '../../data/types';
import type { Lang } from '../../lib/i18n';
import { tl, t, lang } from '../../lib/i18n';
import { settings, garageName, customerName } from '../../data/select';
import { loadAttachment } from '../../data/api';
import { Sheet, Button, Field, Input, Spinner, Banner } from '../../ui';
import { dayOf } from '../../lib/dates';
import { SignaturePad } from './SignaturePad';
import { hasEnoughInk, type Stroke } from './signature';
import { signWaiver } from './flow';
import { jobCustomer, dayWord, clockOf } from './select';

/** the customer's language (their texts, invoice and signatures follow it) */
export function customerLang(j: Job): Lang { return jobCustomer(j)?.lang === 'en' ? 'en' : 'fr'; }

/** the authorization text, with the garage's name */
export function waiverText(l: Lang): string {
  const w = settings.value.waiver || { version: '1', fr: '', en: '' };
  return String((l === 'en' ? w.en : w.fr) || w.fr || w.en || '').replace(/\{garage\}/g, garageName.value);
}

export function WaiverSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  const l = customerLang(p.job);
  const [signer, setSigner] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [error, setError] = useState<string | null>(null);
  const customerNow = customerName(jobCustomer(p.job));
  useEffect(() => {
    if (p.open) { setSigner(customerNow); setStrokes([]); setError(null); }
  }, [p.open]);
  // the customer's file may arrive a moment later (a phone just signed in): fill the name if nothing was typed
  useEffect(() => { if (p.open && customerNow) setSigner((cur) => cur || customerNow); }, [customerNow]);
  const text = waiverText(l);
  const version = settings.value.waiver?.version || '1';
  const save = async () => {
    if (!signer.trim()) { setError(tl(l, 'jobs.sign.signerMissing')); return; }
    if (!hasEnoughInk(strokes)) { setError(tl(l, 'jobs.sign.tooSmall')); return; }
    if (await signWaiver(p.job, strokes, signer.trim())) p.onClose();
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={tl(l, 'jobs.sign.waiverTitle')} sub={tl(l, 'jobs.sign.version', { v: version })}
      dismissable={!strokes.length} data-testid="waiver-sheet"
      footer={<>
        <Button onClick={p.onClose}>{tl(l, 'jobs.sign.cancel')}</Button>
        <Button variant="primary" onClick={save} disabled={!strokes.length} data-testid="waiver-save">{tl(l, 'jobs.sign.save')}</Button>
      </>}>
      <div class="stack">
        {/* focus lands on the text, not on the name: the keyboard must not cover the box */}
        <div class="jobs-waiver-text" tabIndex={-1} autoFocus lang={l === 'en' ? 'en-CA' : 'fr-CA'}>
          {text.split('\n').filter((x) => x.trim()).map((line, i) => <p key={i}>{line}</p>)}
        </div>
        {/* the box first (on a small phone it must be in view without scrolling); the name is already written */}
        <SignaturePad strokes={strokes} onStrokes={(s) => { setStrokes(s); setError(null); }} label={tl(l, 'jobs.sign.pad')} hint={tl(l, 'jobs.sign.here')}
          clearLabel={tl(l, 'jobs.sign.clear')} data-testid="waiver-pad" />
        {error && <p class="field-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <Field label={tl(l, 'jobs.sign.signer')}>
          <Input value={signer} onValue={(v) => { setSigner(v); setError(null); }} autoComplete="name" enterKeyHint="done" data-testid="waiver-signer" />
        </Field>
      </div>
    </Sheet>
  );
}

/** the signature that was kept (fetched from the server: it is not copied on every phone) */
export function SignatureView(p: { job: Job; open: boolean; onClose: () => void }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!p.open || !p.job.waiver_attachment) return;
    let alive = true;
    setSrc(undefined);
    loadAttachment(p.job.waiver_attachment).then((s) => { if (alive) setSrc(s); }, () => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [p.open, p.job.waiver_attachment]);
  const when = signedWhen(p.job.waiver_signed_at);
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.waiver.seeTitle')} sub={p.job.waiver_signer ? `${t('jobs.waiver.signedBy', { name: p.job.waiver_signer })}, ${when}` : undefined}
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      {!p.job.waiver_attachment ? <p class="muted">{t('jobs.waiver.missing')}</p>
        : src === undefined ? <Spinner label={t('common.loading')} />
          : src === null ? <Banner kind="warn">{t('jobs.waiver.loadFail')}</Banner>
            : <div class="jobs-sign-view"><img src={src} alt={t('jobs.waiver.seeTitle')} /></div>}
    </Sheet>
  );
}
/** « Aujourd’hui, 9 h 50 » */
export function signedWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${dayWord(dayOf(d), lang.value)}, ${clockOf(iso)}`;
}
