/* The appointment page's work with the server (client.html#t=<token>): the first load, the way back from Stripe and its
   payment check, the card page already open, the signature, the answers to extra work, card payment, and a fresh look
   when the customer comes back to the tab. The screens only draw what this hook holds. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { attemptCall, callClient, type ClientError, type ExtraV, type Garage, type JobStatus, type JobView, type View } from '../api';
import { lineCents } from '../format';
import type { CLang } from '../i18n';
import { forgetAppointment, forgetPaying, linkHash, recallPaying, rememberAppointment, rememberGarage, rememberPaying, replaceHash } from '../link';
import { exportSignature, type Stroke } from '../../shared/sign/signature';
import { afterCheck, cardPaid, estimateSigned, extraStatus, moneyIn, refusalKey, type PayCheck } from './view-state';

export type Phase = { k: 'loading' } | { k: 'error'; code: string; garage: Garage | null } | { k: 'ready'; v: View };
/** what the extra work panel says after an answer: thanks, or the answer another phone gave first */
export type Reply = null | { kind: 'thanks' } | { kind: 'already'; status: string } | { kind: 'closed' };
/** what a signature or an answer came to: done, or the words to show (with the new amount when it moved) */
export type ActResult = { ok: true } | { ok: false; code: string; key: string; cents: number | null };
export interface Drawn { signer: string; strokes: Stroke[] }

const CHECK_TRIES = 5;
const CHECK_EVERY = 2500;
/** back on the tab after this long: the file is read again (the mechanic may be at the door, a price may have moved) */
const STALE_MS = 15000;
/** the link itself is refused: the phone stops offering it from the tracking page */
const LINK_REFUSED = ['bad_link', 'expired', 'gone'];
/** an appointment still to happen, the one a trip of its day drives to */
const OPEN: JobStatus[] = ['booked', 'en_route', 'on_site'];

export function useAppointment(token: string, retour: string | null, linkLang: CLang | null) {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [check, setCheck] = useState<PayCheck>(retour === 'paye' ? 'checking' : 'idle');
  const [justPaid, setJustPaid] = useState(false);
  const [reply, setReply] = useState<Reply>(null);
  // the words when the card page did not open ('' = it did not fail): Stripe not answering (« pay_unavailable ») has its own
  const [payFailed, setPayFailed] = useState<'' | 'pay.fail' | 'pay.down'>('');
  const [pendingChecked, setPendingChecked] = useState(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tries = useRef(0);
  // every answer carries the number of its request: one that arrives after a newer one was shown is dropped
  const issued = useRef(0);
  const shown = useRef(0);
  const latest = useRef<View | null>(null);
  const loadedAt = useRef(0);
  const checking = useRef(false);
  // a signature or an answer on its way: the refresh on tab return waits (read before the write landed, it would show
  // the file as it was and drop the write's own answer, which carries a lower number — client-r2)
  const writing = useRef(0);
  const whileWriting = async <T,>(f: () => Promise<T>): Promise<T> => {
    writing.current += 1;
    try { return await f(); } finally { writing.current -= 1; }
  };
  // what the file had received before this tab left for Stripe (read once, on the way back: not at every render — client-r5)
  const [paidBefore] = useState<number | null>(() => (retour === 'paye' ? recallPaying(token) : null));
  const receivedBefore = useRef<number | null>(paidBefore);

  const show = (n: number, nv: View): boolean => {
    if (!alive.current || n < shown.current) return false;
    shown.current = n;
    latest.current = nv;
    loadedAt.current = Date.now();
    setPhase({ k: 'ready', v: nv });
    rememberGarage(nv.garage);
    // a quote is never the appointment of a trip; only an appointment still open is (booked, en route, on site): a
    // cancelled or missed one, nearer, would keep the customer's next appointment off the phone (client-r2-2)
    if (nv.kind === 'job') {
      if (OPEN.includes(nv.job.status)) rememberAppointment(token, nv.job.day);
      else if (nv.job.status === 'cancelled' || nv.job.status === 'no_show') forgetAppointment(token);
    }
    return true;
  };
  const fail = (e: ClientError) => {
    if (!alive.current) return;
    if (LINK_REFUSED.includes(e.code)) forgetAppointment(token);
    // a failed refresh never replaces a page already shown: only a refusal of the link does
    setPhase((cur) => (cur.k === 'ready' && (e.code === 'network' || e.code === 'server') ? cur : { k: 'error', code: e.code, garage: e.garage || null }));
  };
  const ask = async (action: 'view' | 'check' | 'sign' | 'answer', extra: Record<string, unknown> = {}) => {
    const n = ++issued.current;
    return { n, r: await attemptCall(() => callClient<View>(action, token, extra)) };
  };

  const load = async (): Promise<View | null> => {
    const { n, r } = await ask('view');
    if (!r.ok) { fail(r.error); return null; }
    return show(n, r.value) ? r.value : null;
  };

  /** a card page is already open (the customer paid but the way back was lost, or he stopped on Stripe): ask Stripe
      once. The note « il s'affichera ici dans un instant » stays only while this check runs. */
  const settlePending = async (before: JobView) => {
    const { n, r } = await ask('check');
    if (!alive.current) return;
    // a failed check leaves the page as the first load showed it
    if (r.ok && show(n, r.value) && r.value.kind === 'job' && (cardPaid(r.value) || moneyIn(r.value) > moneyIn(before))) { setCheck('paid'); setJustPaid(true); }
    setPendingChecked(true);
  };

  /** back from Stripe: the server asks Stripe and applies the payment; a few tries while the bank answers */
  const runCheck = async () => {
    if (timer.current) clearTimeout(timer.current);
    checking.current = true;
    tries.current += 1;
    setCheck('checking');
    const { n, r } = await ask('check');
    if (!alive.current) return;
    if (!r.ok) {
      if ((r.error.code === 'network' || r.error.code === 'server') && tries.current < CHECK_TRIES) { timer.current = setTimeout(() => void runCheck(), CHECK_EVERY); return; }
      checking.current = false;
      setPendingChecked(true);
      setCheck('late');
      fail(r.error);
      return;
    }
    show(n, r.value);
    if (r.value.kind !== 'job') { checking.current = false; setCheck('idle'); return; }
    const s = afterCheck(r.value, tries.current, CHECK_TRIES, receivedBefore.current);
    setCheck(s);
    if (s === 'checking') { timer.current = setTimeout(() => void runCheck(), CHECK_EVERY); return; }
    checking.current = false;
    setPendingChecked(true);
    if (s === 'paid') { setJustPaid(true); forgetPaying(); replaceHash(linkHash('t', token, linkLang)); }
  };

  useEffect(() => {
    alive.current = true;
    if (retour === 'paye') void runCheck();
    else void load().then((nv) => { if (nv?.kind === 'job' && nv.pay.pending) void settlePending(nv); });
    const refresh = () => {
      if (document.visibilityState !== 'visible' || checking.current || writing.current > 0 || !latest.current) return;
      if (Date.now() - loadedAt.current < STALE_MS) return;
      void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [token]);

  /** a refusal of sign or answer: the amount moved, or someone signed meanwhile, so the page shows the file as it is
      now before asking again */
  const refused = async (action: 'sign' | 'answer', e: ClientError): Promise<ActResult> => {
    if (e.code === 'amount_changed' || e.code === 'signed') await load();
    // the visit was closed meanwhile: the proposal can no longer be answered here; the page shows the file as it is now
    if (action === 'answer' && e.code === 'closed') { setReply({ kind: 'closed' }); await load(); }
    return { ok: false, code: e.code, key: refusalKey(action, e.code), cents: e.currentCents };
  };

  /** the extra work accepted or refused, for the amount the page shows (the server refuses another one) */
  const answer = (x: ExtraV, accept: boolean): Promise<ActResult> => whileWriting(async () => {
    const { n, r } = await ask('answer', { item_id: x.id, accept, confirm: true, shown_cents: lineCents(x) });
    if (!alive.current) return { ok: true };
    if (!r.ok) return refused('answer', r.error);
    show(n, r.value);
    // the server keeps the first answer: a second phone that answered the other way is told so, not thanked
    const now = r.value.kind === 'job' ? extraStatus(r.value, x.id) : null;
    const wanted = accept ? 'approved' : 'declined';
    setReply(now && now !== 'proposed' && now !== wanted ? { kind: 'already', status: now } : { kind: 'thanks' });
    return { ok: true };
  });

  /** the estimate signed: one tap (drawn = null, the name on the file) or the name and the finger; always for the total
      the page shows */
  const sign = (drawn: Drawn | null): Promise<ActResult> => whileWriting(async () => {
    const v = latest.current;
    let body: Record<string, unknown> = { click: true, confirm: true };
    if (drawn) {
      const png = exportSignature(drawn.strokes);
      if (!png) return { ok: false, code: 'signature', key: refusalKey('sign', 'signature'), cents: null };
      body = { signer: drawn.signer, png: png.dataUrl, width: png.width, height: png.height, confirm: true };
    }
    if (v?.kind === 'job') body.shown_cents = v.expected.total;
    const { n, r } = await ask('sign', body);
    if (!alive.current) return { ok: true };
    if (r.ok) { show(n, r.value); return { ok: true }; }
    // the answer was lost (weak signal, the 15 s limit) but the signature may have reached the server: read the file
    // before saying it failed, so a second tap never meets « already signed »
    if (r.error.code === 'network') {
      const nv = await load();
      if (nv?.kind === 'job' && estimateSigned(nv)) return { ok: true };
    }
    return refused('sign', r.error);
  });

  /** Stripe's card page, in the page's language */
  const pay = async (l: CLang) => {
    setPayFailed('');
    const v = latest.current;
    const r = await attemptCall(() => callClient<{ ok: true; url?: string; paid?: boolean }>('pay', token, { lang: l }));
    if (!alive.current) return;
    if (r.ok) {
      if (r.value.url) {
        if (v?.kind === 'job') rememberPaying(token, moneyIn(v));
        location.href = r.value.url;
        await new Promise((res) => setTimeout(res, 8000));   // the spinner stays while the card page opens
        return;
      }
      if (r.value.paid) { await load(); setJustPaid(true); }
      return;
    }
    if (r.error.code === 'nothing') { await load(); return; }
    setPayFailed(r.error.code === 'pay_unavailable' ? 'pay.down' : 'pay.fail');
  };

  const retry = () => { setPhase({ k: 'loading' }); void load(); };
  const checkAgain = () => { tries.current = 0; void runCheck(); };
  const view = phase.k === 'ready' ? phase.v : null;
  return {
    phase, view, check, justPaid, reply, payFailed,
    /** « Un paiement par carte a été commencé… »: only until the page asked Stripe */
    pendingNote: view?.kind === 'job' && view.pay.pending && !pendingChecked,
    retry, answer, sign, pay, checkAgain
  };
}
export type Appointment = ReturnType<typeof useAppointment>;
