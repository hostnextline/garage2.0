/* A form saved by itself: changes show at once, are saved a moment after the last keystroke (and when the screen
   closes), and a newer version from the server (another phone, « Refaire depuis le travail ») replaces what is on
   screen only when nothing typed here is still waiting. */
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Draft<T> {
  value: T;
  /** a change made here (saved after `delay`) */
  change: (next: T) => void;
  /** save now what is waiting (before finishing, sharing…) */
  flush: () => Promise<void>;
  /** take this version as the saved one (after the server replaced it) */
  reset: (next: T) => void;
  state: 'saved' | 'waiting' | 'saving';
}

export function useDraft<T>(server: T, sig: (v: T) => string, save: (v: T) => Promise<unknown>, delay = 700): Draft<T> {
  const [value, setValue] = useState<T>(server);
  const [state, setState] = useState<Draft<T>['state']>('saved');
  const st = useRef({ dirty: false, timer: 0 as unknown as ReturnType<typeof setTimeout>, lastSent: sig(server), cur: server, alive: true });
  const saveRef = useRef(save);
  saveRef.current = save;
  const serverSig = sig(server);
  useEffect(() => {
    const s = st.current;
    if (s.dirty) return;
    if (serverSig !== s.lastSent && serverSig !== sig(s.cur)) { s.cur = server; s.lastSent = serverSig; setValue(server); }
  }, [serverSig]);
  const flush = async () => {
    const s = st.current;
    clearTimeout(s.timer);
    if (!s.dirty) return;
    s.dirty = false;
    s.lastSent = sig(s.cur);
    if (s.alive) setState('saving');
    try { await saveRef.current(s.cur); } finally { if (s.alive && !s.dirty) setState('saved'); }
  };
  const change = (next: T) => {
    const s = st.current;
    s.cur = next; s.dirty = true;
    setValue(next); setState('waiting');
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { void flush(); }, delay);
  };
  const reset = (next: T) => {
    const s = st.current;
    clearTimeout(s.timer);
    s.dirty = false; s.cur = next; s.lastSent = sig(next);
    setValue(next); setState('saved');
  };
  // leaving the screen: what was typed is saved
  useEffect(() => () => { st.current.alive = false; void flush(); }, []);
  return { value, change, flush, reset, state };
}
