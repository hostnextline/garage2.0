/* Getting a text or a file out of the app: copy, the phone's « Partager », or a download on a computer. */
import { touch } from '../../app/media';

/** copies text; works without the Clipboard API too (an older phone, a page not in https) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function canShareText(): boolean { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; }
export type ShareOutcome = 'shared' | 'cancelled' | 'failed' | 'blocked' | 'downloaded';
function outcomeOf(e: unknown): ShareOutcome {
  const name = (e as { name?: string } | null)?.name;
  return name === 'AbortError' ? 'cancelled' : name === 'NotAllowedError' ? 'blocked' : 'failed';
}
export async function shareText(o: { title?: string; text: string }): Promise<ShareOutcome> {
  if (!canShareText()) return 'failed';
  try { await navigator.share({ title: o.title, text: o.text }); return 'shared'; } catch (e) { return outcomeOf(e); }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** can this phone hand a file to another app (Messages, Mail, WhatsApp…)? */
export function canShareFile(blob: Blob, name: string): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([blob], name, { type: blob.type || 'application/pdf' })] });
  } catch { return false; }
}
/** on a phone: the « Partager » panel with the file; on a computer (or when sharing files is not possible): a download.
    'blocked' means the phone wants a fresh tap before sharing (the file took a moment to make). */
export async function shareOrDownload(blob: Blob, name: string, o: { title?: string; text?: string } = {}): Promise<ShareOutcome> {
  if (touch.value && canShareFile(blob, name)) {
    try {
      await navigator.share({ files: [new File([blob], name, { type: blob.type || 'application/pdf' })], title: o.title, text: o.text });
      return 'shared';
    } catch (e) {
      const r = outcomeOf(e);
      if (r !== 'failed') return r;
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}
/** the same file, shared now (after a fresh tap) */
export async function shareFileNow(blob: Blob, name: string, o: { title?: string; text?: string } = {}): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [new File([blob], name, { type: blob.type || 'application/pdf' })], title: o.title, text: o.text });
    return 'shared';
  } catch (e) { return outcomeOf(e); }
}

/** a text message ready to send from this phone's own Messages app */
export function smsHref(phone: string | null | undefined, body: string): string {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  // « ?&body= » is read by both iPhone and Android
  return `sms:${d}?&body=${encodeURIComponent(body)}`;
}
