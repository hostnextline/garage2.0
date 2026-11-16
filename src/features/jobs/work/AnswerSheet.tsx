/* The customer's answer to proposed work, in the customer's language: signed on the phone (« J'accepte » / « Je refuse »,
   two taps to refuse: a brush of the finger must not refuse for good), by the link in a text (the answer comes back by
   itself), or told to the office on the phone (owner and office only). */
import { useMemo, useState } from 'preact/hooks';
import { MessageSquareText, Phone } from 'lucide-preact';
import type { Job, JobItem } from '../../../data/types';
import { Button, Sheet, Field, Seg } from '../../../ui';
import { t, tl } from '../../../lib/i18n';
import { money, totals } from '../../../lib/money';
import { settings } from '../../../data/select';
import type { JobRights } from '../../../domain/jobs/rights';
import { SignaturePad } from '../../../shared/sign/SignaturePad';
import { hasEnoughInk, type Stroke } from '../../../shared/sign/signature';
import { answerBySignature, answerByVoice } from '../../../shared/jobs/signatures';
import { sendText } from '../../../shared/jobs/texts';
import { customerLang } from '../WaiverSheet';
import { itemStatusText } from './words';

type How = 'sign' | 'text' | 'voice';
export function AnswerSheet(p: { job: Job; item: JobItem | undefined; rights: JobRights; onClose: () => void }) {
  const { job: j, item: i, rights } = p;
  const l = customerLang(j);
  const [how, setHow] = useState<How>(rights.office && !rights.mine ? 'voice' : 'sign');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const price = useMemo(() => {
    if (!i) return null;
    const tt = totals([{ qty: Number(i.qty), unitCents: Math.abs(i.unit_cents), taxable: i.taxable }], settings.value.taxes);
    return { sub: tt.subtotal, total: tt.total };
  }, [i?.qty, i?.unit_cents, i?.taxable]);
  if (!i) return null;
  const answered = i.status !== 'proposed';
  const close = p.onClose;
  const yes = async () => {
    if (!hasEnoughInk(strokes)) { setErr(tl(l, 'jobs.sign.tooSmall')); return; }
    if (await answerBySignature(i, true, strokes)) close();
  };
  const no = async () => { if (await answerBySignature(i, false, [])) close(); };
  const opts = [
    { value: 'sign' as How, label: t('jobs.work.howSign') },
    { value: 'text' as How, label: t('jobs.work.howText') },
    ...(rights.verbal ? [{ value: 'voice' as How, label: t('jobs.work.howVoice') }] : [])
  ];
  return (
    <Sheet open onClose={close} title={tl(l, 'jobs.sign.extraTitle')} dismissable={!strokes.length} data-testid="answer-sheet"
      footer={answered ? <Button onClick={close}>{t('common.close')}</Button>
        : how === 'sign' ? <>
          <Button onClick={no} confirm={tl(l, 'jobs.sign.declineConfirm')} data-testid="answer-no">{tl(l, 'jobs.sign.decline')}</Button>
          <Button variant="primary" onClick={yes} disabled={!strokes.length} data-testid="answer-yes">{tl(l, 'jobs.sign.accept')}</Button>
        </> : <Button onClick={close}>{t('common.close')}</Button>}>
      <div class="stack">
        <div class="jobs-extra" lang={l === 'en' ? 'en-CA' : 'fr-CA'} tabIndex={-1} autoFocus>
          <h3>{i.description}</h3>
          {i.note && <p><span class="jobs-extra-label">{tl(l, 'jobs.sign.extraWhy')}</span>{i.note}</p>}
          {price && <p class="jobs-extra-price">{tl(l, 'jobs.sign.extraPrice', { price: money(price.sub, l), total: money(price.total, l) })}</p>}
        </div>
        {answered ? <p class="muted" style={{ margin: 0 }}>{itemStatusText(i)}</p> : <>
          <Field label={t('jobs.work.how')} group>
            <Seg value={how} onValue={(v) => { setHow(v); setErr(null); }} options={opts} label={t('jobs.work.how')} class="jobs-seg" data-testid="answer-how" />
          </Field>
          {how === 'sign' && <>
            <SignaturePad strokes={strokes} onStrokes={(s) => { setStrokes(s); setErr(null); }} label={tl(l, 'jobs.sign.pad')} hint={tl(l, 'jobs.sign.acceptSign')} clearLabel={tl(l, 'jobs.sign.clear')} height={180} data-testid="answer-pad" />
            {err && <p class="field-error" role="alert" style={{ margin: 0 }}>{err}</p>}
          </>}
          {how === 'text' && <>
            <p class="muted" style={{ margin: 0 }}>{t('jobs.work.textLead')}</p>
            <Button variant="primary" icon={<MessageSquareText />} onClick={async () => { if (await sendText('extras', j)) close(); }} data-testid="answer-text">{t('jobs.work.textSend')}</Button>
          </>}
          {how === 'voice' && <>
            <p class="muted" style={{ margin: 0 }}>{t('jobs.work.voiceLead')}</p>
            <div class="jobs-two">
              <Button variant="primary" icon={<Phone />} onClick={async () => { if (await answerByVoice(i, true)) close(); }} data-testid="answer-voice-yes">{t('jobs.work.voiceYes')}</Button>
              <Button onClick={async () => { if (await answerByVoice(i, false)) close(); }}>{t('jobs.work.voiceNo')}</Button>
            </div>
          </>}
        </>}
      </div>
    </Sheet>
  );
}
