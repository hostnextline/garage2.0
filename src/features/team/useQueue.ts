/* The person's sheet sends every change at once, one after the other: two quick taps never overwrite each other. */
import { useRef } from 'preact/hooks';

export type Enqueue = <T>(fn: () => Promise<T>) => Promise<T>;

export function useQueue(): Enqueue {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    // a failed change (already said by its own toast) does not stop the ones after it
    queue.current = next.catch(() => undefined);
    return next;
  };
}

/** an optimistic value shown until the LAST change of it is answered (two quick changes no longer flicker back to the
    stored value between them) */
export function useOptimistic() {
  const seq = useRef(0);
  return {
    /** call when a change starts; returns « is this still the latest change? » for when it ends */
    start: () => { const n = ++seq.current; return () => n === seq.current; }
  };
}
