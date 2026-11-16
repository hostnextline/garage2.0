/* The frame of the team app: the bars (bars.tsx), the banners and the screen in the middle, and what floats over every
   screen (hosts.tsx). Computer (≥ 960 px): the menu on the left; phone: a bar on top and one at the bottom. */
import { useEffect } from 'preact/hooks';
import { t } from '../lib/i18n';
import { wide } from '../platform/media';
import { startPositionSharing } from '../services/position';
import { startLocator } from '../shared/customers/locator';
import { Sidebar, TopBar, TabBar } from './bars';
import { ShellBanners } from './ShellBanners';
import { ScreenHost } from './ScreenHost';
import { Hosts } from './hosts';
import { interceptLinks } from './links';

export function Shell() {
  // the mechanic's position is shared only between « Commencer ma journée » and the end of the day, app on screen
  useEffect(() => { startPositionSharing(); startLocator(); }, []);
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
