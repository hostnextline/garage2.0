/* The tap shield: for a moment after a sheet closes, an invisible layer takes the taps. The second tap of a double tap
   on « Annuler » (or any button that closes its sheet at once) used to land on what was under the finger: the tab bar,
   a row, the red button. */
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';

/** how long the shield stays after a sheet closes */
export const SHIELD_MS = 350;
const until = signal(0);

export function raiseShield(ms = SHIELD_MS, now = Date.now()) {
  if (now + ms > until.value) until.value = now + ms;
}
export function shieldUp(now = Date.now()): boolean { return until.value > now; }

export function TapShield() {
  const end = until.value;
  const left = end - Date.now();
  useEffect(() => {
    if (left <= 0) return;
    const tm = setTimeout(() => { if (until.value === end) until.value = 0; }, left);
    return () => clearTimeout(tm);
  }, [end]);
  if (left <= 0) return null;
  return <div class="tap-shield" aria-hidden="true" />;
}
