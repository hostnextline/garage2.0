/* Signatures with the finger on the phone (never a photo, Hassan's rule): the authorization of work, and the customer's
   answer to proposed work (signed, or told to the office on the phone). Kept in the outbox like any change: a signature
   taken with no signal is sent when it comes back, and the screen shows it given meanwhile. */
import type { Job, JobItem } from '../../data/types';
import { saveSignature, answerExtra, Refused } from '../../data/api';
import { insertRow, uuid } from '../../data/sync';
import { preview } from '../../data/auth';
import { settings } from '../../data/select';
import { toast, attempt, run } from '../../ui';
import { t } from '../../lib/i18n';
import { exportSignature, type Stroke } from '../sign/signature';
import { keepAhead } from './select';

const isQueued = (r: unknown) => !!r && typeof r === 'object' && (r as { queued?: boolean }).queued === true;

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
    let attachment: string | null = null;
    if (png) {
      const data = png.dataUrl.split(',')[1] || '';
      attachment = uuid();
      await insertRow('attachments', { id: attachment, kind: 'signature', mime: 'image/png', data, bytes: Math.round(data.length * 0.75), width: png.width, height: png.height, job_id: item.job_id, created_at: new Date().toISOString() });
    }
    return answerExtra(item.id, accept, 'signature', attachment);
  }, { ok: accept ? t('jobs.work.accepted') : t('jobs.work.declined') });
}
/** the customer answered the office on the phone */
export function answerByVoice(item: JobItem, accept: boolean): Promise<boolean> {
  return attempt(() => answerExtra(item.id, accept, 'verbal'), { ok: accept ? t('jobs.work.accepted') : t('jobs.work.declined') });
}
