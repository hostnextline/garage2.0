/* A report the server computes (dashboard, treasury_report): loading, refusal, no signal. The last answer is kept on
   this device for this person, so with no signal the screen still shows the numbers of last time, with their time.
   It loads again by itself when the signal comes back. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../data/api';
import { net, isNetworkError } from '../../data/sync';

export interface ReportState<T> { data: T | null; loading: boolean; error: string | null; offline: boolean; at: string | null; fromCache: boolean }
interface Cached { at: string; data: unknown }
const mem = new Map<string, Cached>();
function readCache(k: string): Cached | null {
  const m = mem.get(k);
  if (m) return m;
  try {
    const s = localStorage.getItem(k);
    if (!s) return null;
    const v = JSON.parse(s) as Cached;
    if (v && typeof v.at === 'string') { mem.set(k, v); return v; }
  } catch { /* private mode, or damaged */ }
  return null;
}
function writeCache(k: string, v: Cached) {
  mem.set(k, v);
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private: memory only */ }
}
export function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((res, rej) => {
    const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    p.then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); });
  });
}

/** `key` names the report (person + what + period); `load` asks the server and returns the shaped answer */
export function useReport<T>(key: string, load: () => Promise<T>): ReportState<T> & { reload: () => void } {
  const [tick, setTick] = useState(0);
  const [st, setSt] = useState<ReportState<T> & { key: string }>(() => {
    const c = readCache(key);
    return { key, data: (c?.data as T) ?? null, at: c?.at ?? null, fromCache: !!c, loading: true, error: null, offline: false };
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    const c = readCache(key);
    setSt({ key, data: (c?.data as T) ?? null, at: c?.at ?? null, fromCache: !!c, loading: true, error: null, offline: false });
    withTimeout(loadRef.current()).then((data) => {
      if (!alive) return;
      const at = new Date().toISOString();
      writeCache(key, { at, data });
      setSt({ key, data, at, fromCache: false, loading: false, error: null, offline: false });
    }, (e) => {
      if (!alive) return;
      const off = isNetworkError(e) || (typeof navigator !== 'undefined' && navigator.onLine === false);
      setSt((s) => ({ ...s, loading: false, error: off ? null : errorMessage(e), offline: off }));
    });
    return () => { alive = false; };
  }, [key, tick]);
  // the signal is back: try again by itself
  const online = net.value.online;
  useEffect(() => { if (online && st.offline && !st.loading) setTick((n) => n + 1); }, [online]);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
  const view = st.key === key ? st : { ...st, data: null, at: null, fromCache: false, loading: true };
  return { ...view, reload: () => setTick((n) => n + 1) };
}
