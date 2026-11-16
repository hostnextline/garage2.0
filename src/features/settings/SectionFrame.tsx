/* What every settings section shares: its draft (kept while the app is open, so leaving a section does not lose what
   was typed), the « changements non enregistrés » bar with one Save, and the frame of the section. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t } from '../../lib/i18n';
import { tableSignal } from '../../data/store';
import { access } from '../../data/auth';
import { Button, Panel, Skeleton } from '../../ui';
import { changesOf, editsOf, pruneDraft, withChanges, sameChanges } from './draft';

/** per person and section, ONLY the fields changed and not saved yet, as typed (a section absent here is clean) */
export const drafts = signal<Record<string, Record<string, unknown>>>({});
export const draftKey = (section: string) => `${access.value?.id || ''}:${section}`;
/** the dot of the list: the same rule as the section's bar, against the section's saved value NOW (`savedNow`), so a
    section left closed while the same value was saved on another device no longer says « non enregistrés »
    (settings-team-24c) */
export function hasDraft(section: string, savedNow?: () => object): boolean {
  const kept = drafts.value[draftKey(section)];
  if (!kept || !Object.keys(kept).length) return false;
  if (!savedNow) return true;
  const saved = savedNow() as Record<string, unknown>;
  return Object.keys(changesOf(saved, withChanges(saved, pruneDraft(saved, kept)))).length > 0;
}

function write(key: string, changes: Record<string, unknown>) {
  const all = { ...drafts.peek() };
  if (Object.keys(changes).length) all[key] = changes; else delete all[key];
  drafts.value = all;
}

/** `saved`: the section's fields as stored now. `draft`: what to show. `changes`: what the person changed (what to save). */
export function useSectionDraft<T extends object>(section: string, saved: T) {
  const key = draftKey(section);
  const stored = (drafts.value[key] || {}) as Partial<T>;
  // the saved value of the last render: a field whose saved value moved to what was typed leaves the draft
  const seen = useRef<T>(saved);
  const kept = pruneDraft(saved, stored, seen.current);
  const draft = withChanges(saved, kept);
  const changes = changesOf(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  // the saved value caught up with a change (saved here, or the same value saved elsewhere), or the field is no longer
  // part of the section (a text whose kind is hidden): it leaves the draft. What is typed stays as typed (st-1).
  useEffect(() => {
    seen.current = saved;
    if (!sameChanges(stored, kept)) write(key, kept as Record<string, unknown>);
  });
  const set = (next: T | ((d: T) => T)) => {
    const cur = withChanges(saved, pruneDraft(saved, (drafts.peek()[key] || {}) as Partial<T>));
    const v = typeof next === 'function' ? (next as (d: T) => T)(cur) : next;
    write(key, editsOf(saved, v) as Record<string, unknown>);
  };
  const reset = () => write(key, {});
  return { draft, set, dirty, changes, reset };
}

/** the settings row has reached this device: until then a section shows a placeholder, never the built-in defaults
    (one keystroke on a form drawn from them used to write them over the garage's settings: settings-team-03). A short
    line says it is coming: a device that starts offline and never got the row is not left with a bare skeleton. */
export const settingsHere = () => tableSignal('settings').value.has('1');
export function SectionWait(p: { testid?: string }) {
  return (
    <div class="settings-section stack-lg" data-testid={p.testid} aria-busy="true">
      <Panel><Skeleton h={18} lines={4} /></Panel>
      <p class="small muted" style={{ margin: 0 }} aria-live="polite" data-testid="settings-wait">{t('common.loading')}</p>
    </div>
  );
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
