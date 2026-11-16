/* One submit at a time. The kit's Button shows a spinner only for an onClick, and a <Form>'s submit button has none,
   so a second tap (gloves, a slow answer) sent the same purchase twice: two expenses. The guard is a ref (two taps in
   the same frame both see it) and `busy` drives the button's spinner and aria-busy. */
import { useEffect, useRef, useState } from 'preact/hooks';

export function useOnce(): { busy: boolean; once: (fn: () => Promise<unknown>) => Promise<void> } {
  const inFlight = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { alive.current = false; }, []);
  const once = async (fn: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await fn(); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { busy, once };
}
