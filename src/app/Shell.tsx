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

/** background work started with the frame, each in a file of its own (the first download stays small): the mechanic's
    position (shared only between « Commencer ma journée » and the end of the day, app on screen) and the search of the
    addresses with no position. Code that could not come (no signal, no offline copy yet) is asked again when the signal
    is back. */
export function startBackground(): void {
  const start = (name: string, run: () => Promise<void>, again = true) => {
    run().catch((e) => {
      // with no signal it is not a fault of the app: asked again when the signal is back
      if (again && navigator.onLine === false) window.addEventListener('online', () => start(name, run, false), { once: true });
      else reportError(e, `start:${name}`, 'chunk');
    });
  };
  start('position', () => import('../services/position').then((m) => m.startPositionSharing()));
  start('locator', () => import('../shared/customers/locator').then((m) => m.startLocator()));
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
