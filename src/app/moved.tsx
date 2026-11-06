/* On the app's old address (GitHub Pages, still working): a note that the app lives at its new address now, with a
   button that opens it. Closing the note hides it until the app is opened again. Shown on the sign-in screen too. */
import { useState } from 'preact/hooks';
import { ExternalLink, X } from 'lucide-preact';
import { t } from '../lib/i18n';
import { movedTo } from '../lib/config';
import { Banner, Button, IconButton } from '../ui';
import './moved.css';

const KEY = 'his.moved.hidden';
function hidden(): boolean {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function MovedBanner() {
  const to = movedTo();
  const [off, setOff] = useState(hidden);
  if (!to || off) return null;
  const hide = () => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* hidden on this screen all the same */ }
    setOff(true);
  };
  return (
    <div class="moved" data-testid="moved-banner">
      <Banner kind="info" title={t('shell.moved.title', { host: new URL(to).host })}
        action={<IconButton icon={<X />} label={t('shell.moved.hide')} onClick={hide} data-testid="moved-hide" />}>
        <span class="small">{t('shell.moved.lead')}</span>
        <Button size="sm" variant="primary" href={to} target="_blank" icon={<ExternalLink size={16} />} data-testid="moved-open">{t('shell.moved.open')}</Button>
      </Banner>
    </div>
  );
}
