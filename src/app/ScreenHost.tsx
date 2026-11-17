/* The screen for the current address: not found, not allowed, its code on its way (a skeleton), its code that would
   not download (tried once more, then said in the person's words), or the screen itself inside an error boundary: a
   screen that throws while drawing shows « Quelque chose n'a pas marché » and the bars keep working; the next address
   tries again.
   No signal: an installed phone has every screen's code (the service worker keeps them all, and takes the page at its
   first install). A page whose code is not on the phone yet says « Pas de réseau : cette page s'ouvrira quand le signal
   reviendra » (nothing reported: it is not a fault); when the signal is back it is asked again, and since a browser
   may remember the failed download, « Réessayer » then reloads the app, which is safe with signal. */
import { useEffect, useState } from 'preact/hooks';
import { route } from '../platform/router';
import { reportError } from '../platform/report';
import { browserOnline } from '../platform/media';
import { t } from '../lib/i18n';
import { Button, Banner, Empty, Skeleton, ErrorBoundary } from '../ui';
import { updateReady, applyUpdate } from '../shared/app/pwa';
import { findRoute, loadScreen, loadedScreen } from './routes';

/** a failed download is tried once more after this long (a phone switching from wifi to the street) */
export const RETRY_MS = 1500;

/** what a page whose code did not come says: no signal (it waits), the signal back (try again), or a real failure */
export type LoadFailure = 'offline' | 'back' | 'failed';
export function loadFailure(failedOffline: boolean, onlineNow: boolean): LoadFailure {
  if (!onlineNow) return 'offline';
  return failedOffline ? 'back' : 'failed';
}

export function ScreenHost() {
  const r = route.value;
  const found = findRoute(r.path);
  const [, force] = useState(0);
  const [failed, setFailed] = useState<{ key: string; offline: boolean } | null>(null);
  const key = found?.def.pattern || '';
  const Comp = found ? loadedScreen(found.def) : undefined;
  const online = browserOnline.value;
  useEffect(() => {
    if (!found || Comp) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    setFailed(null);
    const def = found.def;
    loadScreen(def).then(() => { if (alive) force((n) => n + 1); }, () => {
      retry = setTimeout(() => {
        loadScreen(def).then(() => { if (alive) force((n) => n + 1); }, (e) => {
          // with no signal it is not a fault of the app: nothing to report, the page says so
          const offline = !browserOnline.value;
          if (!offline) reportError(e, `screen:${def.pattern}`, 'chunk');
          if (alive) setFailed({ key, offline });
        });
      }, RETRY_MS);
    });
    return () => { alive = false; if (retry) clearTimeout(retry); };
  }, [key]);
  // the signal is back over a page that could not come: asked again at once (a browser that remembers the failure
  // keeps it failed: « Réessayer » then reloads)
  useEffect(() => {
    if (!online || !found || !failed || failed.key !== key || !failed.offline) return;
    let alive = true;
    loadScreen(found.def).then(() => { if (alive) { setFailed(null); force((n) => n + 1); } }, () => undefined);
    return () => { alive = false; };
  }, [online, failed]);
  if (!found) {
    return <div class="page"><Empty title={t('shell.notFound')} action={<Button variant="primary" href="#/">{t('shell.home')}</Button>} /></div>;
  }
  if (found.def.allow && !found.def.allow()) {
    return <div class="page"><Empty title={t('shell.noRight')} text={t('common.notAllowed')} action={<Button variant="primary" href="#/">{t('shell.home')}</Button>} /></div>;
  }
  if (failed && failed.key === key) {
    const why = loadFailure(failed.offline, online);
    if (why === 'offline') return <div class="page" data-testid="screen-offline"><Banner kind="warn" title={t('shell.loadOffline')} /></div>;
    if (why === 'back') {
      return <div class="page" data-testid="screen-offline"><Banner kind="warn" title={t('shell.loadBack')}
        action={<Button onClick={() => location.reload()}>{t('common.retry')}</Button>} /></div>;
    }
    // the app was probably updated meanwhile: the new version is the way out when it is ready
    const fix = updateReady.value
      ? <Button onClick={applyUpdate}>{t('shell.update.apply')}</Button>
      : <Button onClick={() => location.reload()}>{t('shell.reload')}</Button>;
    return <div class="page"><Banner kind="warn" title={t('shell.loadFail')} action={fix} /></div>;
  }
  if (!Comp) return <div class="page" aria-busy="true"><Skeleton h={34} w="50%" /><Skeleton h={18} lines={4} /></div>;
  return (
    <ErrorBoundary name={`screen:${found.def.pattern}`} resetKey={r.path}>
      <Comp key={found.def.key === 'pattern' ? found.def.pattern : r.path} params={found.params} query={r.query} />
    </ErrorBoundary>
  );
}
