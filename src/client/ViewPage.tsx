/* client.html#t=<token>: the customer's appointment (or estimate). The estimate to sign with the finger (it carries the
   conditions of the work), « Payer maintenant », the invoice being made while the mechanic is there, the extra work to
   accept or refuse, the invoice, card payment through Stripe and, back from Stripe (&retour=paye), the payment check. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, CreditCard, Lock, MapPin, Printer, RefreshCw, Link2Off, Clock, FileX, WifiOff, OctagonAlert, PenLine } from 'lucide-preact';
import { Button } from '../ui/Button';
import { callClient, ClientError, type View, type JobView, type QuoteView, type ExtraV, type Garage, type InvoiceLineV } from './api';
import { ct, pickLang, type CLang } from './i18n';
import { cad, dayTitle, relDay, slotText, lineCents, qtyText, localDayOf } from './format';
import { invoicePaid, invoiceBalance, chargesTaxes, sections, afterCheck, type PayCheck } from './view-state';
import { linkHash, replaceHash, remember, recall, rememberGarage, recallGarage } from './link';
import { Header, Footer, Note, Stamp, CallUs, Sums, Skeleton, PrintIdentity, garageName } from './ui';
import { shortDate, today } from '../lib/dates';
import { SignaturePad } from '../features/jobs/SignaturePad';
import { hasEnoughInk, exportSignature, type Stroke } from '../features/jobs/signature';

type Phase = { k: 'loading' } | { k: 'error'; code: string; garage: Garage | null } | { k: 'ready'; v: View };
const CHECK_TRIES = 5;
const CHECK_EVERY = 2500;

export function ViewPage(p: { token: string; linkLang: CLang | null; retour: string | null; onLang: (l: CLang) => void }) {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [check, setCheck] = useState<PayCheck>(p.retour === 'paye' ? 'checking' : 'idle');
  const [justPaid, setJustPaid] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const tries = useRef(0);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const v = phase.k === 'ready' ? phase.v : null;
  const l = pickLang(p.linkLang, v?.lang);
  const garage: Garage | null = v?.garage || (phase.k === 'error' ? phase.garage : null) || recallGarage();

  const show = (nv: View) => { setPhase({ k: 'ready', v: nv }); rememberGarage(nv.garage); };
  const fail = (e: unknown) => {
    const err = e instanceof ClientError ? e : new ClientError('server', String(e));
    setPhase((cur) => (cur.k === 'ready' && (err.code === 'network' || err.code === 'server') ? cur : { k: 'error', code: err.code, garage: err.garage || null }));
  };
  const load = async () => {
    try { const nv = await callClient<View>('view', p.token); if (alive.current) show(nv); } catch (e) { if (alive.current) fail(e); }
  };
  const runCheck = async () => {
    if (timer.current) clearTimeout(timer.current);
    tries.current += 1;
    setCheck('checking');
    try {
      const nv = await callClient<View>('check', p.token);
      if (!alive.current) return;
      show(nv);
      if (nv.kind !== 'job') { setCheck('idle'); return; }
      const s = afterCheck(nv, tries.current, CHECK_TRIES);
      setCheck(s);
      if (s === 'paid') { setJustPaid(true); replaceHash(linkHash('t', p.token, p.linkLang)); }
      else if (s === 'checking') timer.current = setTimeout(() => void runCheck(), CHECK_EVERY);
    } catch (e) {
      if (!alive.current) return;
      const code = e instanceof ClientError ? e.code : 'server';
      if ((code === 'network' || code === 'server') && tries.current < CHECK_TRIES) { timer.current = setTimeout(() => void runCheck(), CHECK_EVERY); return; }
      setCheck('late');
      fail(e);
    }
  };

  useEffect(() => {
    alive.current = true;
    remember('t', p.token);
    if (p.retour === 'paye') void runCheck(); else void load();
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [p.token]);

  // the page's title and language follow what it shows
  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
    const name = garageName(garage, l);
    const what = !v ? '' : v.kind === 'quote' ? ct(l, 'quote.number', { number: v.number }) : v.invoice ? ct(l, 'invoice.title', { number: v.invoice.number }) : ct(l, 'job.title');
    document.title = what ? `${what} – ${name}` : name;
  }, [l, v, garage?.name]);

  const answer = async (x: ExtraV, accept: boolean) => {
    const nv = await callClient<View>('answer', p.token, { item_id: x.id, accept, confirm: true });
    if (!alive.current) return;
    show(nv);
    setThanks(true);
  };
  const sign = async (signer: string, strokes: Stroke[]) => {
    const png = exportSignature(strokes);
    if (!png) throw new ClientError('signature', 'no ink');
    const nv = await callClient<View>('sign', p.token, { signer, png: png.dataUrl, width: png.width, height: png.height, confirm: true });
    if (alive.current) show(nv);
  };
  const pay = async () => {
    setPayErr(null);
    try {
      const r = await callClient<{ ok: true; url?: string; paid?: boolean }>('pay', p.token);
      if (r.url) {
        location.href = r.url;
        await new Promise((res) => setTimeout(res, 8000));   // the spinner stays while the card page opens
        return;
      }
      if (r.paid) { await load(); setJustPaid(true); }
    } catch (e) {
      const code = e instanceof ClientError ? e.code : 'server';
      if (code === 'nothing') { await load(); return; }
      setPayErr(ct(l, 'pay.fail'));
    }
  };
  const switchLang = () => {
    const next: CLang = l === 'en' ? 'fr' : 'en';
    replaceHash(linkHash('t', p.token, next));
    p.onLang(next);
  };

  return (
    <div class="cl">
      <Header garage={garage} l={l} />
      <main class="cl-wrap cl-main" id="main">
        {phase.k === 'loading' && <Skeleton l={l} />}
        {phase.k === 'error' && <ErrorState code={phase.code} l={l} garage={garage} onRetry={() => { setPhase({ k: 'loading' }); void load(); }} />}
        {v?.kind === 'quote' && <QuotePage v={v} l={l} />}
        {v?.kind === 'job' && (
          <JobPage v={v} l={l} token={p.token} check={check} justPaid={justPaid} thanks={thanks} payErr={payErr}
            onAnswer={answer} onPay={pay} onSign={sign} onCheckAgain={() => { tries.current = 0; void runCheck(); }} />
        )}
      </main>
      <Footer garage={garage} l={l} onLang={switchLang} />
    </div>
  );
}

/* ---------- an appointment ---------- */
function JobPage(p: { v: JobView; l: CLang; token: string; check: PayCheck; justPaid: boolean; thanks: boolean; payErr: string | null;
  onAnswer: (x: ExtraV, accept: boolean) => Promise<void>; onPay: () => Promise<void>; onSign: (signer: string, strokes: Stroke[]) => Promise<void>; onCheckAgain: () => void }) {
  const { v, l } = p;
  const s = sections(v);
  const inv = v.invoice;
  const first = v.customer?.first;
  const onSite = !inv && !!v.bill && v.job.status === 'on_site';
  return (
    <>
      <section class="cl-hero">
        <p class="cl-hello">{first ? ct(l, 'hello', { name: first }) : ct(l, 'helloAlone')}</p>
        <h1>{inv ? ct(l, 'invoice.heroTitle') : onSite ? ct(l, 'work.billTitle') : ct(l, 'job.title')}</h1>
        <p class="cl-lead">{ct(l, inv ? 'job.leadInvoice' : onSite ? 'job.leadOnSite' : 'job.lead', { garage: garageName(v.garage, l) })}</p>
      </section>
      <PrintIdentity garage={v.garage} l={l} />
      {p.check === 'checking' && <Note icon={<span class="cl-spin" aria-hidden="true" />} title={ct(l, 'pay.checking')} data-testid="client-checking">{ct(l, 'pay.checkingLead')}</Note>}
      {p.check === 'paid' && <Note kind="ok" data-testid="client-paid-note">{ct(l, 'pay.done')}</Note>}
      {p.check === 'late' && (
        <Note kind="warn" data-testid="client-late">
          <p>{ct(l, 'pay.late')}</p>
          <Button size="sm" icon={<RefreshCw />} onClick={p.onCheckAgain} class="cl-noprint" data-testid="client-check-again">{ct(l, 'pay.checkAgain')}</Button>
        </Note>
      )}
      {(s.proposed.length > 0 || p.thanks) && <ExtrasPanel v={v} l={l} thanks={p.thanks} onAnswer={p.onAnswer} />}
      {inv && <InvoicePanel v={v} l={l} justPaid={p.justPaid} payErr={p.payErr} onPay={p.onPay} />}
      {/* the mechanic is there: the invoice to pay comes first */}
      {onSite && <PlannedPanel v={v} l={l} payErr={p.payErr} onPay={p.onPay} onSign={p.onSign} />}
      <AppointmentPanel v={v} l={l} printable={!inv} token={p.token} />
      {!inv && !onSite && <PlannedPanel v={v} l={l} payErr={p.payErr} onPay={p.onPay} onSign={p.onSign} />}
    </>
  );
}

const TONES: Record<string, string> = { booked: 'booked', en_route: 'en_route', on_site: 'on_site', done: 'done', cancelled: 'cancelled', no_show: 'no_show' };
function AppointmentPanel(p: { v: JobView; l: CLang; printable: boolean; token: string }) {
  const { v, l } = p;
  const j = v.job;
  const rel = relDay(j.day);
  const slot = slotText(j.start, j.end, l);
  const block = ['am', 'pm', 'eve'].includes(j.block) ? ct(l, `blocks.${j.block}`) : null;
  const closed = j.status === 'cancelled' || j.status === 'no_show';
  // the appointment's own link also opens the live trip (same secret), so the link is always there
  const trackToken = j.status === 'en_route' && j.tracking ? (recall('suivi') || p.token) : null;
  const explain = j.status === 'en_route' && !trackToken ? ct(l, 'job.explain.en_routeNoLink') : ct(l, `job.explain.${j.status}`);
  return (
    <section class={`cl-panel glass${p.printable ? '' : ' cl-noprint'}`} aria-labelledby="cl-appt" data-testid="client-appointment">
      <div class="cl-appt-top">
        <span class={`pill pill-${TONES[j.status] || 'booked'}`} data-testid="client-status">{ct(l, `job.status.${j.status}`)}</span>
      </div>
      {rel && !closed && <p class="cl-eyebrow">{ct(l, rel)}</p>}
      <div class={closed ? 'cl-closed' : undefined}>
        <h2 class="cl-day" id="cl-appt">{dayTitle(j.day, l)}</h2>
        {(slot || block) && (
          <p class="cl-slot">{slot && <b>{slot}</b>}{block && <span>{block}</span>}</p>
        )}
      </div>
      <p class="cl-explain">{explain}</p>
      {trackToken && (
        <div class="cl-track-link cl-noprint">
          <Button variant="primary" block icon={<MapPin />} href={`#suivi=${trackToken}${l === 'en' ? '&l=en' : ''}`} data-testid="client-track-link">{ct(l, 'job.track')}</Button>
        </div>
      )}
      <dl class="cl-facts">
        {j.vehicle && <><dt>{ct(l, 'job.vehicle')}</dt><dd>{j.vehicle}</dd></>}
        <dt>{ct(l, 'job.number')}</dt><dd>{j.number}</dd>
      </dl>
      {closed && <div style={{ marginTop: 'var(--sp-4)' }} class="cl-noprint"><CallUs garage={v.garage} l={l} /></div>}
    </section>
  );
}

function Line(p: { desc: string; meta?: ComponentChildren; cents: number; l: CLang; off?: boolean }) {
  return (
    <li class="cl-line">
      <span class="cl-line-main">
        <span class="cl-line-desc" style={p.off ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>{p.desc}</span>
        {p.meta && <span class="cl-line-meta">{p.meta}</span>}
      </span>
      <span class="cl-line-amt" style={p.off ? { color: 'var(--ink-3)' } : undefined}>{cad(p.cents, p.l)}</span>
    </li>
  );
}

function PlannedPanel(p: { v: JobView; l: CLang; payErr: string | null; onPay: () => Promise<void>; onSign: (signer: string, strokes: Stroke[]) => Promise<void> }) {
  const { v, l } = p;
  const s = sections(v);
  const taxed = chargesTaxes(v);
  const e = v.expected;
  const prepay = v.pay.available && v.pay.kind === 'prepay';
  // the mechanic is there: the invoice being made (its own lines, rebates and taxes) is what is due
  const bill = v.job.status === 'on_site' && v.bill ? v.bill : null;
  return (
    <section class="cl-panel glass" aria-labelledby="cl-work" data-testid="client-work">
      <h2 id="cl-work">{ct(l, bill ? 'work.billTitle' : 'work.title')}</h2>
      {bill && <p class="cl-sub" data-testid="client-bill-lead">{ct(l, 'work.billLead')}</p>}
      {bill ? (
        <ul class="cl-lines" data-testid="client-bill">
          {bill.lines.map((x, i) => {
            const q = qtyText(x, l);
            return <Line key={i} desc={x.description} l={l} cents={lineCents(x)} meta={q ? <span>{q}</span> : undefined} />;
          })}
        </ul>
      ) : s.planned.length ? (
        <ul class="cl-lines">
          {s.planned.map((i) => {
            const q = qtyText(i, l);
            const tag = i.status === 'done' ? <span class="cl-tag"><Check aria-hidden="true" />{ct(l, 'work.done')}</span>
              : i.status === 'approved' ? <span class="cl-tag"><Check aria-hidden="true" />{ct(l, 'work.accepted')}</span> : null;
            return <Line key={i.id} desc={i.description} l={l} cents={lineCents(i)} meta={(q || tag) ? <>{q && <span>{q}</span>}{tag}</> : undefined} />;
          })}
        </ul>
      ) : <p class="cl-muted">{ct(l, 'work.none')}</p>}
      {e.total > 0 && (
        <>
          <div class="cl-total">
            <span class="cl-total-label">{ct(l, bill ? 'work.billTotal' : taxed ? 'work.expected' : 'work.expectedNoTax')}</span>
            <b class="cl-total-amt" data-testid="client-expected">{cad(e.total, l)}</b>
          </div>
          {taxed && (
            <details class="cl-details">
              <summary>{ct(l, 'work.taxDetail')}</summary>
              <Sums l={l} rows={[[ct(l, 'invoice.subtotal'), e.subtotal], [ct(l, 'invoice.tps'), e.tps], [ct(l, 'invoice.tvq'), e.tvq], [ct(l, 'invoice.total'), e.total, true]]} />
            </details>
          )}
          {v.prepaid_cents > 0 && <Sums l={l} rows={[[ct(l, 'work.prepaid'), -v.prepaid_cents], [ct(l, 'work.left'), Math.max(0, e.total - v.prepaid_cents), true]]} />}
        </>
      )}
      {s.declined.length > 0 && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <h3 class="cl-small cl-muted" style={{ margin: '0 0 var(--sp-2)', fontWeight: 560 }}>{ct(l, 'extras.declinedTitle')}</h3>
          <ul class="cl-lines">
            {s.declined.map((x) => <Line key={x.id} desc={x.description} l={l} cents={lineCents(x)} off meta={<span class="cl-tag cl-tag-off">{ct(l, 'extras.declined')}</span>} />)}
          </ul>
        </div>
      )}
      <EstimateSign v={v} l={l} onSign={p.onSign} />
      {prepay && <PayBox v={v} l={l} prepay={!bill} now err={p.payErr} onPay={p.onPay} />}
    </section>
  );
}

/* ---------- the estimate, signed with the finger (with the conditions of the work) ---------- */
function EstimateSign(p: { v: JobView; l: CLang; onSign: (signer: string, strokes: Stroke[]) => Promise<void> }) {
  const { v, l } = p;
  const e = v.estimate;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (open) titleRef.current?.focus(); }, [open]);
  if (!e) return null;
  const total = cad(v.expected.total, l);
  if (!e.can_sign) {
    if (!e.signed_at) return null;
    return (
      <div class="cl-sign-done" data-testid="client-signed">
        <Note kind="ok">{(() => { const d = localDayOf(e.signed_at); return d ? ct(l, 'sign.done', { name: e.signer || '', date: shortDate(d, l) }) : ct(l, 'sign.doneShort'); })()}</Note>
      </div>
    );
  }
  if (!open) {
    return (
      <div class="cl-sign cl-noprint" data-testid="client-sign">
        {e.changed && <Note kind="warn">{ct(l, 'sign.changed')}</Note>}
        <Button variant="primary" block icon={<PenLine />} onClick={() => { setOpen(true); setErr(null); }} data-testid="client-sign-open">{ct(l, 'sign.open')}</Button>
      </div>
    );
  }
  const submit = async () => {
    setErr(null);
    if (name.trim().length < 2) { setErr(ct(l, 'sign.needName')); return; }
    if (!hasEnoughInk(strokes)) { setErr(ct(l, 'sign.needInk')); return; }
    if (!agree) { setErr(ct(l, 'sign.needAgree')); return; }
    setBusy(true);
    try { await p.onSign(name.trim(), strokes); setOpen(false); }
    catch (x) { setErr(x instanceof ClientError && x.code === 'signed' ? x.message : ct(l, 'sign.fail')); }
    finally { setBusy(false); }
  };
  return (
    <div class="cl-sign cl-sign-open cl-noprint" data-testid="client-sign-form">
      <h3 ref={titleRef} tabIndex={-1}>{ct(l, 'sign.title')}</h3>
      <p class="cl-sub">{ct(l, 'sign.lead', { total })}</p>
      {v.conditions && (
        <details class="cl-details">
          <summary>{ct(l, 'sign.conditions')}</summary>
          <p class="cl-cond">{v.conditions}</p>
        </details>
      )}
      <label class="cl-field">
        <span>{ct(l, 'sign.name')}</span>
        <input class="input" value={name} onInput={(x) => { setName((x.currentTarget as HTMLInputElement).value); setErr(null); }} autoComplete="name" autoCapitalize="words" data-testid="client-sign-name" />
      </label>
      <SignaturePad strokes={strokes} onStrokes={(x) => { setStrokes(x); setErr(null); }} label={ct(l, 'sign.padLabel')} hint={ct(l, 'sign.pad')} clearLabel={ct(l, 'sign.clear')} height={190} data-testid="client-sign-pad" />
      <label class="cl-check">
        <input type="checkbox" checked={agree} onChange={(x) => { setAgree((x.currentTarget as HTMLInputElement).checked); setErr(null); }} data-testid="client-sign-agree" />
        <span>{ct(l, 'sign.agree', { total })}</span>
      </label>
      {err && <Note kind="bad">{err}</Note>}
      <div class="cl-choice">
        <Button onClick={() => setOpen(false)} data-testid="client-sign-cancel">{ct(l, 'sign.cancel')}</Button>
        <Button variant="primary" busy={busy} onClick={submit} data-testid="client-sign-submit">{ct(l, 'sign.submit')}</Button>
      </div>
    </div>
  );
}

/* ---------- the extra work the mechanic proposes ---------- */
function ExtrasPanel(p: { v: JobView; l: CLang; thanks: boolean; onAnswer: (x: ExtraV, accept: boolean) => Promise<void> }) {
  const { v, l } = p;
  const s = sections(v);
  const taxed = chargesTaxes(v);
  return (
    <section class="cl-panel glass cl-extras cl-noprint" aria-labelledby="cl-extras" data-testid="client-extras">
      <h2 id="cl-extras">{ct(l, 'extras.title')}</h2>
      {s.proposed.length > 0 && <p class="cl-sub">{ct(l, 'extras.lead')}</p>}
      <div class="cl-stack">
        {p.thanks && (
          <Note kind="ok" data-testid="client-thanks">
            <p class="cl-thanks">{ct(l, 'extras.thanks')}</p>
            {v.expected.total > 0 && <p>{ct(l, 'extras.newTotal', { total: cad(v.expected.total, l) })}</p>}
          </Note>
        )}
        {s.proposed.map((x) => <ExtraCard key={x.id} x={x} l={l} taxed={taxed} onAnswer={p.onAnswer} />)}
      </div>
    </section>
  );
}

function ExtraCard(p: { x: ExtraV; l: CLang; taxed: boolean; onAnswer: (x: ExtraV, accept: boolean) => Promise<void> }) {
  const { x, l } = p;
  const [step, setStep] = useState<'idle' | 'accept' | 'decline'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const price = cad(lineCents(x), l);
  useEffect(() => { if (step !== 'idle') confirmRef.current?.focus(); }, [step]);
  const send = async () => {
    setErr(null);
    try { await p.onAnswer(x, step === 'accept'); } catch { setErr(ct(l, 'errors.answer')); }
  };
  const id = `cl-x-${x.id}`;
  return (
    <article class="cl-extra" aria-labelledby={id} data-testid="client-extra">
      <h3 id={id}>{x.description}</h3>
      {x.note && <p class="cl-why"><b>{ct(l, 'extras.why')}</b> {x.note}</p>}
      <p class="cl-price" style={{ margin: 0 }}><b>{price}</b>{p.taxed && <span>{ct(l, 'extras.plusTax')}</span>}</p>
      {step === 'idle' ? (
        <div class="cl-choice">
          <Button onClick={() => setStep('decline')} data-testid="client-extra-decline">{ct(l, 'extras.decline')}</Button>
          <Button variant="primary" onClick={() => setStep('accept')} data-testid="client-extra-accept">{ct(l, 'extras.accept')}</Button>
        </div>
      ) : (
        <>
          <p class="cl-confirm" ref={confirmRef} tabIndex={-1}>
            {step === 'accept' ? ct(l, p.taxed ? 'extras.confirmAccept' : 'extras.confirmAcceptNoTax', { price }) : ct(l, 'extras.confirmDecline')}
          </p>
          <div class="cl-choice">
            <Button onClick={() => { setErr(null); setStep('idle'); }} data-testid="client-extra-back">{ct(l, 'extras.back')}</Button>
            <Button variant={step === 'accept' ? 'primary' : 'danger'} onClick={send} data-testid="client-extra-confirm">
              {ct(l, step === 'accept' ? 'extras.yesAccept' : 'extras.yesDecline')}
            </Button>
          </div>
        </>
      )}
      {err && <Note kind="bad">{err}</Note>}
    </article>
  );
}

/* ---------- the invoice ---------- */
/** a sentence with a number that must not break across lines (« Facture F-0043 ») */
function keepTogether(text: string, value: string): ComponentChildren {
  const [a, b = ''] = text.split('\u0001');
  return <>{a}<span style={{ whiteSpace: 'nowrap' }}>{value}</span>{b}</>;
}
function invoiceLineMeta(x: InvoiceLineV, l: CLang) { return qtyText(x, l); }
function InvoicePanel(p: { v: JobView; l: CLang; justPaid: boolean; payErr: string | null; onPay: () => Promise<void> }) {
  const { v, l } = p;
  const inv = v.invoice!;
  const paid = invoicePaid(inv);
  const balance = invoiceBalance(inv);
  const taxed = inv.tps_cents + inv.tvq_cents > 0;
  const issuedDay = inv.issued_at ? localDayOf(inv.issued_at) : null;
  const g = v.garage;
  const footer = l === 'en' ? g.footer_en || g.footer_fr : g.footer_fr || g.footer_en;
  return (
    <section class="cl-panel glass cl-invoice" aria-labelledby="cl-inv" data-testid="client-invoice">
      <div class="cl-inv-head">
        <h2 id="cl-inv">{keepTogether(ct(l, 'invoice.title', { number: '\u0001' }), inv.number)}</h2>
        <div class="cl-inv-meta">
          <div>
            {issuedDay && <p>{ct(l, 'invoice.issued', { date: shortDate(issuedDay, l) })}</p>}
            {v.job.vehicle && <p>{v.job.vehicle}</p>}
          </div>
          {paid && <Stamp l={l} animate={p.justPaid} />}
        </div>
      </div>
      <ul class="cl-lines">
        {(inv.lines || []).map((x, i) => {
          const q = invoiceLineMeta(x, l);
          return <Line key={i} desc={x.description} l={l} cents={lineCents(x)} meta={q ? <span>{q}</span> : undefined} />;
        })}
      </ul>
      <Sums l={l} class="cl-inv-sums" rows={[[ct(l, 'invoice.subtotal'), inv.subtotal_cents], taxed && [ct(l, 'invoice.tps'), inv.tps_cents], taxed && [ct(l, 'invoice.tvq'), inv.tvq_cents]]} />
      <div class="cl-total">
        <span class="cl-total-label">{ct(l, 'invoice.total')}</span>
        <b class="cl-total-amt" data-testid="client-total">{cad(inv.total_cents, l)}</b>
      </div>
      {inv.paid_cents > 0 && <Sums l={l} rows={[[ct(l, 'invoice.paid'), -inv.paid_cents], [ct(l, 'invoice.balance'), balance, true]]} />}
      {(g.tps_no || g.tvq_no) && (
        <p class="cl-taxnos">
          {g.tps_no && <span>{ct(l, 'invoice.tpsNo', { no: g.tps_no })}</span>}
          {g.tvq_no && <span>{ct(l, 'invoice.tvqNo', { no: g.tvq_no })}</span>}
        </p>
      )}
      {inv.notes && <p class="cl-notes">{inv.notes}</p>}
      {footer && <p class="cl-notes cl-muted">{footer}</p>}
      {paid ? (
        <div class="cl-pay"><Note kind="ok">{ct(l, 'invoice.paidThanks')}</Note></div>
      ) : v.pay.available ? (
        <PayBox v={v} l={l} err={p.payErr} onPay={p.onPay} />
      ) : (
        <div class="cl-pay cl-noprint"><CallUs garage={g} l={l} primary={false} /></div>
      )}
      <div class="cl-tools cl-noprint">
        <Button icon={<Printer />} onClick={() => window.print()} data-testid="client-print">{ct(l, 'invoice.print')}</Button>
      </div>
    </section>
  );
}

function PayBox(p: { v: JobView; l: CLang; prepay?: boolean; now?: boolean; err: string | null; onPay: () => Promise<void> }) {
  const { v, l } = p;
  const amount = cad(v.pay.amount_cents, l);
  return (
    <div class="cl-pay cl-noprint" data-testid="client-pay">
      {v.pay.pending && <Note>{ct(l, 'pay.pending')}</Note>}
      <Button variant={p.prepay ? 'secondary' : 'primary'} block icon={<CreditCard />} onClick={p.onPay} data-testid="client-pay-button">
        {ct(l, p.now ? 'pay.now' : p.prepay ? 'pay.prepay' : 'pay.button', { amount })}
      </Button>
      <p class="cl-pay-note"><Lock aria-hidden="true" />{ct(l, 'pay.secure')}</p>
      {p.prepay && <p class="cl-pay-note">{ct(l, 'pay.prepayLead')}</p>}
      {p.err && <Note kind="bad">{p.err}</Note>}
    </div>
  );
}

/* ---------- an estimate ---------- */
function QuotePage(p: { v: QuoteView; l: CLang }) {
  const { v, l } = p;
  const taxed = v.totals.tps + v.totals.tvq > 0;
  const expired = !!v.valid_until && v.valid_until < today();
  return (
    <>
      <section class="cl-hero">
        <p class="cl-hello">{ct(l, 'helloAlone')}</p>
        <h1>{ct(l, 'quote.title')}</h1>
        <p class="cl-lead">{ct(l, 'quote.lead', { garage: garageName(v.garage, l) })}</p>
      </section>
      <PrintIdentity garage={v.garage} l={l} />
      <section class="cl-panel glass" aria-labelledby="cl-quote" data-testid="client-quote">
        <div class="cl-inv-head">
          <h2 id="cl-quote">{ct(l, 'quote.number', { number: v.number })}</h2>
          {v.vehicle && <div class="cl-inv-meta"><p>{v.vehicle}</p></div>}
        </div>
        <ul class="cl-lines">
          {v.items.map((x, i) => {
            const q = qtyText(x, l);
            return <Line key={i} desc={x.description} l={l} cents={lineCents(x)} meta={q ? <span>{q}</span> : undefined} />;
          })}
        </ul>
        {taxed && <Sums l={l} rows={[[ct(l, 'invoice.subtotal'), v.totals.subtotal], [ct(l, 'invoice.tps'), v.totals.tps], [ct(l, 'invoice.tvq'), v.totals.tvq]]} />}
        <div class="cl-total">
          <span class="cl-total-label">{ct(l, taxed ? 'quote.total' : 'quote.totalNoTax')}</span>
          <b class="cl-total-amt" data-testid="client-total">{cad(v.totals.total, l)}</b>
        </div>
        {v.valid_until && (expired
          ? <div style={{ marginTop: 'var(--sp-4)' }}><Note kind="warn">{ct(l, 'quote.expired', { date: shortDate(v.valid_until, l) })}</Note></div>
          : <p class="cl-small cl-muted" style={{ margin: 'var(--sp-4) 0 0' }}>{ct(l, 'quote.validUntil', { date: shortDate(v.valid_until, l) })}</p>)}
        <p class="cl-small cl-muted" style={{ margin: 'var(--sp-2) 0 0' }}>{ct(l, 'quote.note')}</p>
        <div class="cl-pay cl-noprint"><CallUs garage={v.garage} l={l} label={ct(l, 'quote.book')} /></div>
        <div class="cl-tools cl-noprint">
          <Button icon={<Printer />} onClick={() => window.print()} data-testid="client-print">{ct(l, 'invoice.print')}</Button>
        </div>
      </section>
    </>
  );
}

/* ---------- a link that does not open ---------- */
export function ErrorState(p: { code: string; l: CLang; garage: Garage | null; onRetry?: () => void }) {
  const { l } = p;
  const key = ['bad_link', 'expired', 'gone', 'network'].includes(p.code) ? p.code : 'server';
  const Icon = key === 'bad_link' ? Link2Off : key === 'expired' ? Clock : key === 'gone' ? FileX : key === 'network' ? WifiOff : OctagonAlert;
  const canRetry = (key === 'network' || key === 'server') && !!p.onRetry;
  return (
    <section class="cl-panel glass cl-state" role="alert" data-testid={`client-error-${key}`}>
      <span class="cl-state-icon" aria-hidden="true"><Icon /></span>
      <h1>{ct(l, `errors.${key}.title`)}</h1>
      <p>{ct(l, `errors.${key}.text`)}</p>
      {canRetry && <Button variant="primary" block icon={<RefreshCw />} onClick={p.onRetry} data-testid="client-retry">{ct(l, 'errors.retry')}</Button>}
      <CallUs garage={p.garage} l={l} primary={!canRetry} />
    </section>
  );
}
