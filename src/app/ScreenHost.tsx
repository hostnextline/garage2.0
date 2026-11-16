/* The screen for the current address: not found, not allowed, its code on its way (a skeleton), its code that would
   not download (tried once more, then « Recharger »), or the screen itself inside an error boundary: a screen that
   throws while drawing shows « Quelque chose n'a pas marché » and the bars keep working; the next address tries again. */
import { useEffect, useState } from 'preact/hooks';
import { route } from '../platform/router';
import { reportError } from '../platform/report';
import { t } from '../lib/i18n';
import { Button, Banner, Empty, Skeleton, ErrorBoundary } from '../ui';
import { updateReady, applyUpdate } from '../shared/app/pwa';
import { findRoute, loadScreen, loadedScreen } from './routes';

/** a failed download is tried once more after this long (a phone switching from wifi to the street) */
export const RETRY_MS = 1500;

export function ScreenHost() {
  const r = route.value;
  const found = findRoute(r.path);
  const [, force] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const key = found?.def.pattern || '';
  const Comp = found ? loadedScreen(found.def) : undefined;
  useEffect(() => {
    if (!found || Comp) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    setFailed(null);
    const def = found.def;
    loadScreen(def).then(() => { if (alive) force((n) => n + 1); }, () => {
      retry = setTimeout(() => {
        loadScreen(def).then(() => { if (alive) force((n) => n + 1); }, (e) => {
          reportError(e, `screen:${def.pattern}`, 'chunk');
          if (alive) setFailed(key);
        });
      }, RETRY_MS);
    });
    return () => { alive = false; if (retry) clearTimeout(retry); };
  }, [key]);
  if (!found) {
    return <div class="page"><Empty title={t('shell.notFound')} action={<Button variant="primary" href="#/">{t('shell.home')}</Button>} /></div>;
  }
  if (found.def.allow && !found.def.allow()) {
    return <div class="page"><Empty title={t('shell.noRight')} text={t('common.notAllowed')} action={<Button variant="primary" href="#/">{t('shell.home')}</Button>} /></div>;
  }
  if (failed === key) {
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
