/* What every settings section shares: its draft (kept while the app is open, so leaving a section does not lose what
   was typed), the « changements non enregistrés » bar with one Save, and small inputs (numbers with a unit, times). */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t, lang } from '../../lib/i18n';
import { hm, parseHm } from '../../lib/dates';
import { access } from '../../data/auth';
import { Button } from '../../ui';
import { isDirty } from './draft';

/** the drafts of the sections that have changes not saved yet (a section absent here is clean), per person */
export const drafts = signal<Record<string, unknown>>({});
export const draftKey = (section: string) => `${access.value?.id || ''}:${section}`;
export const hasDraft = (section: string) => draftKey(section) in drafts.value;

export function useSectionDraft<T>(section: string, saved: T) {
  const key = draftKey(section);
  const has = key in drafts.value;
  const draft = (has ? drafts.value[key] : saved) as T;
  const dirty = has && isDirty(saved, draft);
  const set = (next: T | ((d: T) => T)) => {
    const cur = (key in drafts.value ? drafts.value[key] : saved) as T;
    const v = typeof next === 'function' ? (next as (d: T) => T)(cur) : next;
    const all = { ...drafts.value };
    if (isDirty(saved, v)) all[key] = v; else delete all[key];   // back to what is saved: nothing to save
    drafts.value = all;
  };
  const reset = () => { if (key in drafts.value) { const all = { ...drafts.value }; delete all[key]; drafts.value = all; } };
  return { draft, set, dirty, reset };
}

/** one Save per section; says when something is not saved yet */
export function SaveBar(p: { dirty: boolean; onSave: () => unknown; onReset: () => void; label?: string }) {
  return (
    <div class={`settings-savebar glass-strong${p.dirty ? ' is-dirty' : ''}`} data-testid="settings-savebar">
      <span class="settings-savestate grow" aria-live="polite">
        {p.dirty ? <><span class="settings-dot" aria-hidden="true" />{t('settings.unsaved')}</> : t('settings.allSaved')}
      </span>
      {p.dirty && <Button variant="ghost" onClick={p.onReset} label={t('settings.undo')} data-testid="settings-undo">{t('settings.undoShort')}</Button>}
      <Button variant="primary" disabled={!p.dirty} onClick={p.onSave} data-testid="settings-save">{p.label || t('settings.save')}</Button>
    </div>
  );
}

/** a section: its panels, then the bar */
export function Section(p: { children: ComponentChildren; bar?: ComponentChildren; testid?: string }) {
  return <div class="settings-section stack-lg" data-testid={p.testid}>{p.children}{p.bar}</div>;
}

const fmtNum = (v: number | null | undefined, l: string) => (v == null || !Number.isFinite(v) ? '' : l === 'en' ? String(v) : String(v).replace('.', ','));
const parseNum = (s: string): number | null => {
  const x = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!x) return null;
  return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : Number.NaN;
};
/** a number with its unit (« 35 km/h »); an empty field gives null, a wrong one NaN (the section says what to fix) */
export function NumInput(p: { value: number | null | undefined; onValue: (v: number | null) => void; unit?: string; decimals?: boolean; invalid?: boolean; id?: string; 'aria-label'?: string; placeholder?: string; 'data-testid'?: string }) {
  const [text, setText] = useState(() => fmtNum(p.value, lang.value));
  const focused = useRef(false);
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

/** « Entre 10 et 120. » when a number is missing or out of range; null when fine */
export function rangeError(v: number | null | undefined, min: number, max: number): string | null {
  if (v == null || !Number.isFinite(v)) return t('settings.needNumber');
  if (v < min || v > max) return t('settings.between', { min, max });
  return null;
}
