/* How full a truck is in a place: a bar (the time taken by jobs and driving over its hours), read out for screen readers. */
import { lang } from '../../lib/i18n';
import { fillOf, fillWords } from './layout';

export function Meter(p: { used: number; cap: number; label: string; small?: boolean }) {
  const f = fillOf(p.used, p.cap);
  return (
    <span class={`agenda-meter${p.small ? ' is-small' : ''}${f.over ? ' is-over' : ''}`} role="meter" aria-label={p.label}
      aria-valuemin={0} aria-valuemax={Math.max(1, p.cap)} aria-valuenow={Math.min(Math.max(0, p.used), Math.max(1, p.cap))} aria-valuetext={fillWords(p.used, p.cap, lang.value)}>
      <span class="agenda-meter-fill" style={{ width: `${Math.round(f.pct * 100)}%` }} />
    </span>
  );
}
