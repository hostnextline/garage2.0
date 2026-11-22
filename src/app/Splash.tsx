/* The first picture while the app starts (static: it draws before anything else is downloaded). */
import { t } from '../lib/i18n';

export function Splash() {
  return <div class="splash" aria-busy="true" aria-label={t('shell.splash')}><img src="./logo-his.png" alt="" width="96" height="96" /></div>;
}
