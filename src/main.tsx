/* Start of the team app, in this order: errors are caught from the first line; the colours (no flash) and the
   language; the first picture; the first screen's code asked at once (in parallel with the session); then the person
   and their copy of the data (app/boot.ts). */
import { render } from 'preact';
import { effect } from '@preact/signals';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './app/shell.css';
import { installGlobalErrorHandlers, reportError } from './platform/report';
import { parseHash } from './platform/router';
import { lang } from './lib/i18n';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { App, bootFailed } from './app/App';
import { runBoot, wantsDemo } from './app/boot';
import { pickLang, showLang, storedLang } from './app/lang';
import { preloadRoute } from './app/routes';
import { startTheme } from './services/theme';
import { startPwa } from './shared/app/pwa';
import { startAuth, finishOAuth, access } from './data/auth';

installGlobalErrorHandlers();
startTheme();
showLang(lang.value);
// a person's language follows their account once known, unless they chose one on this device
let langFromAccount = false;
effect(() => {
  const a = access.value;
  if (!a || langFromAccount) return;
  langFromAccount = true;
  showLang(pickLang({ stored: storedLang(), account: a.lang, guess: lang.value }));
});

render(<ErrorBoundary name="root"><App /></ErrorBoundary>, document.getElementById('app')!);

// someone signed in on this device before: the first screen's code comes while the session is checked
try { if (localStorage.getItem('his.lastuid')) preloadRoute(parseHash(location.hash).path); } catch { /* private mode */ }

const demo = import.meta.env.DEV && wantsDemo(location.search, location.hash);
void runBoot({
  demo,
  // written so the production build drops the demo entirely (import.meta.env.DEV is false there)
  startDemo: import.meta.env.DEV ? async () => { const { startDemo } = await import('./dev/demo'); await startDemo(); } : async () => undefined,
  finishOAuth, startAuth, startPwa,
  report: (e) => reportError(e, 'boot', 'boot'),
  failed: () => { bootFailed.value = true; }
});
