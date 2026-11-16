/* The small inputs of the settings sections: a number with its unit, a time of day. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { lang } from '../../lib/i18n';
import { hm, parseHm } from '../../lib/dates';
import { fmtNum, parseNum } from './checks';

/** a number with its unit (« 35 km/h »); an empty field gives null, a wrong one NaN (the section says what to fix) */
export function NumInput(p: { value: number | null | undefined; onValue: (v: number | null) => void; unit?: string; decimals?: boolean; invalid?: boolean; id?: string; 'aria-label'?: string; placeholder?: string; 'data-testid'?: string }) {
  const [text, setText] = useState(() => fmtNum(p.value, lang.value));
  const focused = useRef(false);
  // the stored value changed while the field is not being typed in: show it (never under the person's fingers)
  useEffect(() => { if (!focused.current) setText(fmtNum(p.value, lang.value)); }, [p.value, lang.value]);
  return (
    <span class="input-wrap settings-num">
      <input class="input" inputMode={p.decimals ? 'decimal' : 'numeric'} id={p.id} aria-label={p['aria-label']} placeholder={p.placeholder} data-testid={p['data-testid']}
        aria-invalid={p.invalid || (text.trim() !== '' && Number.isNaN(parseNum(text))) || undefined} value={text}
        style={p.unit ? { paddingRight: `${18 + p.unit.length * 9}px` } : undefined}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(fmtNum(p.value, lang.value) || text); }}
        onInput={(e) => { const s = (e.currentTarget as HTMLInputElement).value; setText(s); p.onValue(parseNum(s)); }} />
      {p.unit && <span class="input-unit" aria-hidden="true">{p.unit}</span>}
    </span>
  );
}

/** a time of day (minutes after midnight) */
export function TimeInput(p: { value: number; onValue: (v: number) => void; invalid?: boolean; 'aria-label'?: string; 'data-testid'?: string }) {
  return (
    <input class="input settings-time" type="time" step={900} aria-label={p['aria-label']} aria-invalid={p.invalid || undefined} data-testid={p['data-testid']}
      value={hm(Math.max(0, Math.min(1439, p.value)))}
      onInput={(e) => { const m = parseHm((e.currentTarget as HTMLInputElement).value); if (m != null) p.onValue(m); }} />
  );
}
