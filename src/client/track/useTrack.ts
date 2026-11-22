/* The tracking page's polling (public_track): at once, then every 5 s while the trip is on its way and the page on
   screen (the mechanic's phone sends its position about every 10 s while driving), again at once when the page comes
   back on screen; nothing while it is hidden; it stops once the trip is over. A failure waits longer before the next
   try (no hammering a server that does not answer): 15 s, then 30 s, then every minute, and 5 s again at the first
   answer. A 20 s tick redraws the minutes left between two answers (when answers stop coming).
   The arrival is live: where he is on his route (liveEta), kept calm answer after answer (calm); the server's eta_at
   when his position cannot be trusted. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { attemptCall, callTrack, type TrackAnswer } from '../api';
import { rememberGarage } from '../link';
import { calm, isFinal, liveEta, trackView, type Calm, type LiveHeld } from './track-state';

/** between two answers while the trip is on its way and the page on screen */
export const EVERY = 5000;
/** after a failure: 15 s (the old pace), twice longer at each failure in a row, a minute at most */
export const RETRY = 15000;
export const RETRY_MAX = 60000;
const TICK = 20000;
/** an answer after this long without one (the page was hidden, the network lost): the arrival starts again from it */
const STALE = 30000;

/** the wait before the next question, after `fails` failures in a row (0: the last one was answered) */
export function waitAfter(fails: number): number {
  return fails <= 0 ? EVERY : Math.min(RETRY_MAX, RETRY * 2 ** (fails - 1));
}

export function useTrack(token: string) {
  const [ans, setAns] = useState<{ a: TrackAnswer; at: number; live: LiveHeld | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true, over = false, busy = false, fails = 0, lastOk = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // the live arrival kept calm, in minutes: the minutes left, and the arrival moment (minutes since 1970, server's clock)
    let held: { left: Calm; arrive: Calm } | null = null;
    const later = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = alive && !over ? setTimeout(() => { timer = null; void ask(); }, ms) : null;
    };
    const ask = async () => {
      // one question at a time; none once the trip is over
      if (busy || over || !alive) return;
      if (timer) { clearTimeout(timer); timer = null; }
      // none while the page is hidden (the phone's battery): asked again when it comes back on screen
      if (document.visibilityState === 'hidden') return;
      busy = true;
      const asked = Date.now();
      const r = await attemptCall(() => callTrack(token));
      busy = false;
      if (!alive) return;
      if (!r.ok) { fails += 1; setErr(r.error.code); later(waitAfter(fails)); return; }
      fails = 0;
      const at = Date.now();
      const fresh = liveEta(r.value, at);
      if (!fresh || at - lastOk > STALE) held = null;
      held = fresh ? { left: calm(held?.left ?? null, fresh.left), arrive: calm(held?.arrive ?? null, fresh.arrive / 60000) } : null;
      lastOk = at;
      setAns({ a: r.value, at, live: held ? { left: held.left.v, arrive: held.arrive.v * 60000 } : null });
      setNow(at);
      setErr(null);
      rememberGarage(r.value.garage);
      if (isFinal(trackView(r.value, at).kind)) { over = true; return; }
      // every 5 s from one question to the next (the time the answer took is part of it)
      later(Math.max(1000, EVERY - (at - asked)));
    };
    kick.current = () => { void ask(); };
    void ask();
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void ask(); } };
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(() => setNow(Date.now()), TICK);
    return () => { alive = false; if (timer) clearTimeout(timer); clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  }, [token]);

  return { view: ans ? trackView(ans.a, ans.at, now, ans.live) : null, err, retry: () => { setErr(null); kick.current(); } };
}
