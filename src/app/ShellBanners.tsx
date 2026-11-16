/* The banners above every screen, in their own place (a banner that comes and goes never moves the screen's red
   button): the old address, « Voir l'app comme… », a lost session, a phone that cannot keep changes, an important
   update waiting, a new version installed by another tab, the changes the server refused. */
import { Eye, LogIn, ArrowUpCircle, RefreshCw } from 'lucide-preact';
import { t } from '../lib/i18n';
import { navigate } from '../platform/router';
import { net } from '../data/sync';
import { preview, viewAs, stopPreview } from '../data/auth';
import { Button, Banner } from '../ui';
import { MovedBanner } from '../shared/app/moved';
import { importantWaiting, installedElsewhere, applyUpdate } from '../shared/app/pwa';
import { netView, syncOpen } from './sync';
import { reconnectOpen } from './ReconnectSheet';
import { refusalText } from './netView';

export function ShellBanners() {
  const v = netView();
  const failed = net.value.failed;
  return (
    <div class="shell-banners">
      <MovedBanner />
      {preview.value && (
        <Banner kind="warn" title={t('shell.preview.banner', { name: viewAs.value?.short_name || viewAs.value?.full_name || '' })}
          action={<Button size="sm" variant="primary" icon={<Eye size={16} />} onClick={() => { stopPreview(); navigate('/team'); }}>{t('shell.preview.stop')}</Button>} data-testid="preview-banner" />
      )}
      {v.sessionLost && (
        <Banner kind="warn" title={v.pending ? t('shell.session.lost', { n: v.pending }) : t('shell.session.lostNone')}
          action={<Button size="sm" variant="primary" icon={<LogIn size={16} />} onClick={() => { reconnectOpen.value = true; }}>{t('shell.session.signIn')}</Button>} data-testid="session-banner" />
      )}
      {v.storageLost && <Banner kind="bad" title={t('shell.storageLost')} data-testid="storage-banner" />}
      {importantWaiting() && (
        <Banner kind="warn" title={t('shell.update.important')}
          action={<Button size="sm" variant="primary" icon={<ArrowUpCircle size={16} />} onClick={applyUpdate}>{t('shell.update.apply')}</Button>} data-testid="update-banner" />
      )}
      {installedElsewhere.value && (
        <Banner kind="info" title={t('shell.update.installed')}
          action={<Button size="sm" icon={<RefreshCw size={16} />} onClick={() => location.reload()}>{t('shell.reload')}</Button>} data-testid="update-installed" />
      )}
      {failed.length > 0 && (
        <Banner kind="bad" title={t('shell.failed.title', { n: failed.length })} action={<Button size="sm" onClick={() => { syncOpen.value = true; }}>{t('shell.failed.show')}</Button>} data-testid="failed-banner">
          <span class="small">{refusalText(failed[0])}</span>
        </Banner>
      )}
    </div>
  );
}
