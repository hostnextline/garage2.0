/* The customer's page (client.html, its own small bundle): #t=<token> (the appointment, the extra work, the invoice,
   card payment, or an estimate) and #suivi=<token> (the mechanic on the way). No account: the link is the key.
   Light by default, dark when the phone is dark. French or English: « &l=en » in the link, else the customer's file. */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../ui/styles/tokens.css';
import '../ui/styles/base.css';
import '../ui/styles/components.css';
import './client.css';
import { parseLink, recallGarage, type Link } from './link';
import { pickLang, type CLang } from './i18n';
import { ViewPage, ErrorState } from './ViewPage';
import { TrackPage } from './TrackPage';
import { Header, Footer } from './ui';

/** the phone's light or dark, also when it changes while the page is open */
function followScheme() {
  try {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const set = () => {
      document.documentElement.dataset.mode = mq.matches ? 'dark' : 'light';
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta) meta.content = mq.matches ? '#000000' : '#E7EAEE';
    };
    set();
    mq.addEventListener?.('change', set);
  } catch { /* old browser: light */ }
}

function App() {
  const [link, setLink] = useState<Link>(() => parseLink(location.hash));
  useEffect(() => {
    const on = () => { setLink(parseLink(location.hash)); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // a language switch rewrites the address (no reload): read it again
  const onLang = () => setLink(parseLink(location.hash));
  if (link.kind === 't' && link.token) return <ViewPage key={`t-${link.token}`} token={link.token} linkLang={link.l} retour={link.retour} onLang={onLang} />;
  if (link.kind === 'suivi' && link.token) return <TrackPage key={`s-${link.token}`} token={link.token} linkLang={link.l} onLang={onLang} />;
  return <NoLink l={link.l} />;
}

/** client.html opened without a link (or a link cut short) */
function NoLink(p: { l: CLang | null }) {
  const [l, setL] = useState<CLang>(() => pickLang(p.l, null));
  const garage = recallGarage();
  useEffect(() => { document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA'; }, [l]);
  return (
    <div class="cl">
      <Header garage={garage} l={l} />
      <main class="cl-wrap cl-main" id="main"><ErrorState code="bad_link" l={l} garage={garage} /></main>
      <Footer garage={garage} l={l} onLang={() => setL(l === 'en' ? 'fr' : 'en')} />
    </div>
  );
}

async function boot() {
  followScheme();
  if (import.meta.env.DEV && /[?&]demo\b/.test(location.search)) {
    const m = await import('./demo');
    m.installClientDemo();
  }
  render(<App />, document.getElementById('client')!);
}
void boot();
