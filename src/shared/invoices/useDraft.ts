/* A form saved by itself (the draft invoice, the estimate): changes show at once and are saved a moment after the
   last keystroke (and when the screen closes). A version from the server (another phone, the server following the
   job's work, « Refaire depuis le travail ») replaces what is on screen only when nothing typed here is still on its
   way: not typed and unsent, not being sent, not waiting in the phone's outbox. Without that, on a weak signal the
   answer to an older save put the older text back on screen, and the next keystroke saved over the newer one. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../ui';

export type DraftState = 'saved' | 'waiting' | 'saving' | 'kept' | 'failed';
export interface Draft<T> {
  value: T;
  /** a change made here (saved after the delay) */
  change: (next: T) => void;
  /** a change built on what is on screen now (an undo, a line added by itself): never on an older copy */
  update: (f: (cur: T) => T) => void;
  /** saves now what is waiting, after the saves already on their way (before finishing, sharing…) */
  flush: () => Promise<void>;
  /** takes this version as the saved one (after the server replaced it) */
  reset: (next: T) => void;
  /** what is on screen right now (after an update made in the same tap, before the next render) */
  peek: () => T;
  /** saved · waiting (typed, not sent) · saving · kept (on the phone, no signal) · failed (refused, the toast said why) */
  state: DraftState;
}
export interface DraftOptions<T> {
  delay?: number;
  /** a save of this row still waits in the phone's outbox */
  busy?: boolean;
  /** no signal: what is saved is kept on the phone */
  offline?: boolean;
  /** puts the server's version on screen from what is shown (keeps the lines' keys, so the focus stays) */
  adopt?: (server: T, shown: T) => T;
}
/** a save just handed to the outbox shows there a moment later: the server's version is not taken meanwhile */
const SETTLE_MS = 1500;

export function useDraft<T>(server: T, sig: (v: T) => string, save: (v: T, base: T) => Promise<unknown>, o: DraftOptions<T> = {}): Draft<T> {
  const delay = o.delay ?? 700;
  const [value, setValue] = useState<T>(server);
  const [phase, setPhase] = useState<'saved' | 'waiting' | 'saving' | 'failed'>('saved');
  const [recheck, setRecheck] = useState(0);
  const st = useRef({
    dirty: false, saving: 0, sentAt: 0, alive: true,
    timer: undefined as ReturnType<typeof setTimeout> | undefined, settle: undefined as ReturnType<typeof setTimeout> | undefined,
    cur: server, base: server, baseSig: sig(server), chain: Promise.resolve() as Promise<void>
  });
  const saveRef = useRef(save);
  saveRef.current = save;
  const adoptRef = useRef(o.adopt);
  adoptRef.current = o.adopt;
  const serverSig = sig(server);
  const busy = !!o.busy;

  useEffect(() => {
    const s = st.current;
    if (s.dirty || s.saving > 0 || busy) return;
    const left = s.sentAt + SETTLE_MS - Date.now();
    if (left > 0) { clearTimeout(s.settle); s.settle = setTimeout(() => setRecheck((n) => n + 1), left); return; }
    if (serverSig === sig(s.cur)) { s.base = server; s.baseSig = serverSig; return; }
    const next = adoptRef.current ? adoptRef.current(server, s.cur) : server;
    s.cur = next; s.base = server; s.baseSig = serverSig;
    setValue(next); setPhase('saved');
  }, [serverSig, busy, recheck]);

  const send = async () => {
    const s = st.current;
    if (!s.dirty) return;
    s.dirty = false;
    const v = s.cur, base = s.base;
    s.base = v; s.baseSig = sig(v);
    s.saving++;
    if (s.alive) setPhase('saving');
    try {
      await saveRef.current(v, base);
      if (s.alive && !s.dirty) setPhase('saved');
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
      if (s.alive && !s.dirty) setPhase('failed');
    } finally {
      s.saving--; s.sentAt = Date.now();
      if (s.alive) setRecheck((n) => n + 1);
    }
  };
  const flush = () => {
    const s = st.current;
    clearTimeout(s.timer);
    s.chain = s.chain.then(send);
    return s.chain;
  };
  const change = (next: T) => {
    const s = st.current;
    s.cur = next;
    setValue(next);
    clearTimeout(s.timer);
    // back to what was last sent (a price field left without a change, a letter typed then erased): nothing to send
    if (sig(next) === s.baseSig) { s.dirty = false; setPhase(s.saving > 0 ? 'saving' : 'saved'); return; }
    s.dirty = true;
    setPhase('waiting');
    s.timer = setTimeout(() => { void flush(); }, delay);
  };
  const update = (f: (cur: T) => T) => { const cur = st.current.cur, next = f(cur); if (next !== cur) change(next); };
  const reset = (next: T) => {
    const s = st.current;
    clearTimeout(s.timer);
    s.dirty = false; s.cur = next; s.base = next; s.baseSig = sig(next);
    setValue(next); setPhase('saved');
  };
  // leaving the screen: what was typed is saved
  useEffect(() => () => { const s = st.current; s.alive = false; clearTimeout(s.settle); void flush(); }, []);

  const state: DraftState = phase === 'saved' && busy ? (o.offline ? 'kept' : 'saving') : phase;
  return { value, change, update, flush, reset, state, peek: () => st.current.cur };
}
