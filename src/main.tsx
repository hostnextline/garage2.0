/* Start of the team app: colours first (no flash), the language, then the person and their copy of the data. */
import { render } from 'preact';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './app/shell.css';
import { App } from './app/App';
import { startTheme } from './app/theme';
import { startPwa } from './app/pwa';
import { startErrors } from './app/errors';
import { setLang, lang } from './lib/i18n';
import { startAuth, finishOAuth, access } from './data/auth';
import { effect } from '@preact/signals';

startTheme();
startErrors();
setLang(lang.value);
// a person's language follows their account once known
let langFromAccount = false;
effect(() => { const a = access.value; if (a && !langFromAccount) { langFromAccount = true; try { if (!localStorage.getItem('his.lang')) setLang(a.lang); } catch { setLang(a.lang); } } });

async function boot() {
  if (import.meta.env.DEV && /[?&]demo\b/.test(location.search)) {
    const { startDemo } = await import('./dev/demo');
    await startDemo();
  } else {
    const back = await finishOAuth().catch(() => false);
    if (!back) await startAuth();
  }
  void startPwa();
}
render(<App />, document.getElementById('app')!);
void boot();
