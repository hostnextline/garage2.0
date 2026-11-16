/* client.html#t=<token>: the customer's appointment (or estimate). The estimate to sign (it carries the conditions of
   the work), the invoice being made while the mechanic is there with « Payer maintenant », the extra work to accept or
   refuse, the invoice, card payment through Stripe and, back from Stripe (&retour=paye), the payment check.
   The work with the server is in useAppointment; the panels are in this folder. */
import { useEffect } from 'preact/hooks';
import type { Garage } from '../api';
import { ct, pickLang, type CLang } from '../i18n';
import { linkHash, recallGarage, replaceHash } from '../link';
import { ErrorState, Footer, Header, Skeleton, garageName } from '../ui';
import { CheckingNote, JobPage } from './JobPage';
import { QuotePage } from './QuotePage';
import { useAppointment } from './useAppointment';

export function ViewPage(p: { token: string; linkLang: CLang | null; retour: string | null; onLang: (l: CLang) => void }) {
  const a = useAppointment(p.token, p.retour, p.linkLang);
  const { phase, view: v } = a;
  const l = pickLang(p.linkLang, v?.lang);
  const garage: Garage | null = v?.garage || (phase.k === 'error' ? phase.garage : null) || recallGarage();

  // the page's title and language follow what it shows
  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
    const name = garageName(garage, l);
    const what = !v ? '' : v.kind === 'quote' ? ct(l, 'quote.number', { number: v.number }) : v.invoice ? ct(l, 'invoice.title', { number: v.invoice.number }) : ct(l, 'job.title');
    document.title = what ? `${what} – ${name}` : name;
  }, [l, v, garage?.name]);

  const switchLang = () => {
    const next: CLang = l === 'en' ? 'fr' : 'en';
    replaceHash(linkHash('t', p.token, next));
    p.onLang(next);
  };

  return (
    <div class="cl">
      <Header garage={garage} l={l} />
      <main class="cl-wrap cl-main" id="main">
        {phase.k === 'loading' && <>{a.check === 'checking' && <CheckingNote l={l} />}<Skeleton l={l} /></>}
        {phase.k === 'error' && <ErrorState code={phase.code} l={l} garage={garage} onRetry={a.retry} />}
        {v?.kind === 'quote' && <QuotePage v={v} l={l} />}
        {v?.kind === 'job' && <JobPage v={v} l={l} token={p.token} a={a} onPay={() => a.pay(l)} />}
      </main>
      <Footer garage={garage} l={l} onLang={switchLang} />
    </div>
  );
}
