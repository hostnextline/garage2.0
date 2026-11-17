/* A report the server computes (dashboard, treasury_report): loading, refusal, no signal. The last answer is kept on
   this device for this person (reportCache.ts), so with no signal the screen still shows the numbers of last time,
   with their time. It loads again by itself when the signal comes back after a failure, when the app comes back to
   the front with numbers older than a few minutes, and every few minutes while it stays open on a screen (an office
   computer left on « Chiffres du garage » all day). The numbers already shown stay while it reloads (no blank frame),
   and an answer that arrives after a newer request (another month chosen meanwhile) is ignored. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { errorMessage } from '../../lib/errors';
import { net, isNetworkError } from '../../data/sync';
import { authState } from '../../data/auth';
import { clearReports, readReport, writeReport } from './reportCache';

/* The garage's numbers kept on this device leave it as soon as nobody is signed in on it (« Me déconnecter », a
   session lost): no revenue nor taxes stay in the phone's storage once its person has left it, and that person, back
   with no signal, finds no kept numbers. This net only works once this module is loaded (a report screen opened since
   the app started: it ships with the Dashboard, Trésorerie and Coffre chunks); a sign-out right after a restart is
   covered by the sign-out flow itself calling clearReports() (R104, app-shell). Twice is harmless. */
effect(() => { if (authState.value === 'signed_out') clearReports(); });

export interface ReportState<T> { data: T | null; loading: boolean; error: string | null; offline: boolean; at: string | null; fromCache: boolean }
/** numbers older than this are loaded again when the screen is looked at */
export const STALE_MS = 5 * 60 * 1000;

export function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((res, rej) => {
    const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    p.then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); });
  });
}

function fromCache<T>(key: string, normalize?: (raw: unknown) => T): ReportState<T> & { key: string } {
  const c = readReport<T>(key, normalize);
  return { key, data: c?.data ?? null, at: c?.at ?? null, fromCache: !!c, loading: true, error: null, offline: false };
}

/** `key` names the report (person + what + period); `load` asks the server and returns the shaped answer;
    `normalize` shapes a kept answer when it is read back (an older app may have kept another shape) */
export function useReport<T>(key: string, load: () => Promise<T>, normalize?: (raw: unknown) => T): ReportState<T> & { reload: () => void } {
  const [tick, setTick] = useState(0);
  const [st, setSt] = useState<ReportState<T> & { key: string }>(() => fromCache(key, normalize));
  const loadRef = useRef(load);
  loadRef.current = load;
  const stRef = useRef(st);
  stRef.current = st;
  const seq = useRef(0);
  /** when the server was last asked: a failing server is not asked again every minute (the online listener retries a lost signal) */
  const tried = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    tried.current = Date.now();
    // another report: start from what this device kept for it; the same report again: keep the numbers on screen
    setSt((s) => (s.key === key ? { ...s, loading: true, error: null } : fromCache(key, normalize)));
    withTimeout(loadRef.current()).then((data) => {
      if (mine !== seq.current) return;
      const at = new Date().toISOString();
      writeReport(key, { at, data });
      setSt({ key, data, at, fromCache: false, loading: false, error: null, offline: false });
    }, (e) => {
      if (mine !== seq.current) return;
      const off = isNetworkError(e) || (typeof navigator !== 'undefined' && navigator.onLine === false);
      setSt((s) => ({ ...s, loading: false, error: off ? null : errorMessage(e), offline: off }));
    });
    return () => { seq.current++; };
  }, [key, tick]);

  // the signal is back (the app's own signal or the browser's): try again, only when the last try failed
  const online = net.value.online;
  useEffect(() => {
    const retry = () => { const s = stRef.current; if ((s.offline || s.error) && !s.loading) setTick((n) => n + 1); };
    if (online) retry();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [online]);

  // numbers that got old while the app was in the background, or left open on a screen
  useEffect(() => {
    const refresh = () => {
      const s = stRef.current;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (s.loading || !s.at || Date.now() - Math.max(Date.parse(s.at), tried.current) < STALE_MS) return;
      setTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    // looked at every minute: the numbers are loaded again once they are STALE_MS old, and at most once per STALE_MS
    // while the server keeps failing (the error banner is not hidden and shown again each minute)
    const timer = setInterval(refresh, 60_000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, []);

  // between a new key and its effect: what this device kept for it, never an empty frame
  const view = st.key === key ? st : fromCache(key, normalize);
  return { ...view, reload: () => setTick((n) => n + 1) };
}
