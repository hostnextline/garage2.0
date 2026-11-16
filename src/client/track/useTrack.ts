/* The tracking page's polling (public_track): at once, every 15 s while the page is on screen, again when it comes
   back on screen; stops once the trip is over. A 20 s tick redraws the minutes left between two answers. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { attemptCall, callTrack, type TrackAnswer } from '../api';
import { rememberGarage } from '../link';
import { isFinal, trackView } from './track-state';

const EVERY = 15000;
const TICK = 20000;

export function useTrack(token: string) {
  const [ans, setAns] = useState<{ a: TrackAnswer; at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true, over = false, busy = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const ask = async () => {
      // one question at a time; none while the page is hidden (the phone's battery) or once the trip is over
      if (busy || over || document.visibilityState === 'hidden') return;
      busy = true;
      const r = await attemptCall(() => callTrack(token));
      busy = false;
      if (!alive) return;
      if (!r.ok) { setErr(r.error.code); return; }
      const at = Date.now();
      setAns({ a: r.value, at });
      setNow(at);
      setErr(null);
      rememberGarage(r.value.garage);
      if (isFinal(trackView(r.value, at).kind)) { over = true; if (timer) clearInterval(timer); }
    };
    kick.current = () => { void ask(); };
    void ask();
    timer = setInterval(() => void ask(), EVERY);
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void ask(); } };
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(() => setNow(Date.now()), TICK);
    return () => { alive = false; if (timer) clearInterval(timer); clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  }, [token]);

  return { view: ans ? trackView(ans.a, ans.at, now) : null, err, retry: () => { setErr(null); kick.current(); } };
}
