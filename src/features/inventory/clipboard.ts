/* Copying the shopping list: the clipboard of the browser, or the old way where it is missing (an iPhone in an app
   frame). Says in a toast whether it worked. */
import { t } from '../../lib/i18n';
import { toast } from '../../ui';

export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy refused');
    }
    toast(t('inventory.needs.copied'), { kind: 'ok' });
  } catch (e) {
    // the browser refused (no permission, no focus): the person can still read the list on screen
    console.warn('copy', e);
    toast(t('inventory.needs.copyFailed'), { kind: 'bad' });
  }
}
