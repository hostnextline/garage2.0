/* Small hooks of the section. */
import { useEffect, useState } from 'preact/hooks';

/** the value, `ms` after it stopped changing (immediately when ms is 0) */
export function useSettled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (!ms) { setV(value); return; }
    const tm = setTimeout(() => setV(value), ms);
    return () => clearTimeout(tm);
  }, [value, ms]);
  return ms ? v : value;
}

/** focuses an element once it is on screen: the autofocus attribute only works once per page load, not after moving
    from screen to screen in the app */
export function useFocusOnMount(on: boolean | undefined, find: () => HTMLElement | null | undefined) {
  useEffect(() => {
    if (!on) return;
    const tm = setTimeout(() => { const el = find(); if (el && document.activeElement !== el && !el.closest('[aria-hidden="true"]')) el.focus({ preventScroll: true }); }, 30);
    return () => clearTimeout(tm);
  }, []);
}
