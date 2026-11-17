/* The frame of the team app: the bars (bars.tsx), the banners and the screen in the middle, and what floats over every
   screen (hosts.tsx). Computer (≥ 960 px): the menu on the left; phone: a bar on top and one at the bottom. */
import { useEffect } from 'preact/hooks';
import { t } from '../lib/i18n';
import { wide } from '../platform/media';
import { reportError } from '../platform/report';
import { Sidebar, TopBar, TabBar } from './bars';
import { ShellBanners } from './ShellBanners';
import { ScreenHost } from './ScreenHost';
import { Hosts } from './hosts';
import { interceptLinks } from './links';

/** the waits before a background start that failed is tried again (the last one repeats) */
export const BACKGROUND_RETRY_MS = [5_000, 30_000, 120_000, 300_000] as const;

/** runs `run` until it works: one that fails (its code did not come: no signal, a flaky network that still says online,
    a new version that replaced the files of a page with no service worker) is tried again at the first of: the signal
    back (`online`), the app back on screen, or a wait (BACKGROUND_RETRY_MS), whatever the phone says of its signal.
    A failure with signal is reported once; with no signal it is not a fault of the app. (app-shell-r2-2: before, a
    failure with signal was reported and never tried again: the mechanic's position stayed unshared all day.) */
export function startWithRetry(name: string, run: () => Promise<void>): void {
  let tries = 0;
  let reported = false;
  const attempt = () => {
    run().catch((e) => {
      if (!reported && navigator.onLine !== false) { reported = true; reportError(e, `start:${name}`, 'chunk'); }
      const wait = BACKGROUND_RETRY_MS[Math.min(tries++, BACKGROUND_RETRY_MS.length - 1)];
      const again = () => {
        clearTimeout(tm);
        window.removeEventListener('online', again);
        document.removeEventListener('visibilitychange', onShow);
        attempt();
      };
      const onShow = () => { if (document.visibilityState === 'visible') again(); };
      const tm = setTimeout(again, wait);
      window.addEventListener('online', again);
      document.addEventListener('visibilitychange', onShow);
    });
  };
  attempt();
}

let backgroundStarted = false;
/** background work started with the frame, each in a file of its own (the first download stays small): the mechanic's
    position (shared only between « Commencer ma journée » and the end of the day, app on screen) and the search of the
    addresses with no position. Started once for the life of the page (both are for the whole session); code that could
    not come is asked again (startWithRetry). */
export function startBackground(): void {
  if (backgroundStarted) return;
  backgroundStarted = true;
  startWithRetry('position', () => import('../services/position').then((m) => m.startPositionSharing()));
  startWithRetry('locator', () => import('../shared/customers/locator').then((m) => m.startLocator()));
}

export function Shell() {
  useEffect(() => { startBackground(); }, []);
  useEffect(() => interceptLinks(), []);
  const isWide = wide.value;
  return (
    <div class={`app${isWide ? ' app-wide' : ''}`} data-testid="app">
      <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('shell.skip')}</a>
      {isWide ? <Sidebar /> : <TopBar />}
      <main id="main" tabIndex={-1}>
        <ShellBanners />
        <ScreenHost />
      </main>
      {!isWide && <TabBar />}
      <Hosts />
    </div>
  );
}
