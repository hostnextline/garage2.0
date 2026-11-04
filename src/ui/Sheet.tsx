/* Sheets: a panel that rises from the bottom on the phone and opens as a window on the computer.
   The phone's back button (Android) closes the sheet instead of leaving the screen.
   ask() / askText(): a short question with two answers, returned as a promise. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { signal } from '@preact/signals';
import { X } from 'lucide-preact';
import { t } from '../lib/i18n';
import { Button } from './Button';
import { Textarea } from './forms';

let openCount = 0;
let seq = 0;
function lockScroll(on: boolean) {
  openCount += on ? 1 : -1;
  document.documentElement.classList.toggle('is-locked', openCount > 0);
}
/* A sheet closed by one of its buttons steps back over its own history entry. That step is asynchronous: a
   navigation asked meanwhile waits for it (see whenHistorySettled), or it would be undone by the step back. */
let backPending = 0;
const afterBack: (() => void)[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (backPending > 0 && --backPending === 0) for (const f of afterBack.splice(0)) f();
  });
}
export function whenHistorySettled(fn: () => void) { if (backPending > 0) afterBack.push(fn); else fn(); }
function stepBack() {
  backPending++;
  history.back();
  // a browser that never answers the step back must not hold navigation
  setTimeout(() => { if (backPending > 0) { backPending = 0; for (const f of afterBack.splice(0)) f(); } }, 600);
}
const stackOf = (st: unknown): string[] => ((st as { sheets?: string[] } | null)?.sheets || []);

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  sub?: ComponentChildren;
  wide?: boolean;
  footer?: ComponentChildren;
  children?: ComponentChildren;
  /** false: only the buttons close it (a signature in progress…) */
  dismissable?: boolean;
  'data-tour'?: string;
  'data-testid'?: string;
}
export function Sheet(p: SheetProps) {
  if (!p.open) return null;
  return <SheetOpen {...p} />;
}
function SheetOpen(p: SheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const dismissable = p.dismissable !== false;
  const [id] = useState(() => `s${++seq}`);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    lockScroll(true);
    // the back button closes the sheet: one history step that belongs to it
    let popped = false;
    try { history.pushState({ ...(history.state || {}), sheets: [...stackOf(history.state), id] }, '', location.href); } catch { /* ignore */ }
    const onPop = () => { if (!stackOf(history.state).includes(id) && !popped) { popped = true; closeRef.current(); } };
    window.addEventListener('popstate', onPop);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    const first = box.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea, button:not(.sheet-x)');
    (first || box.current)?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      lockScroll(false);
      // closed by a button: remove our history step, but only if nothing navigated meanwhile
      const st = stackOf(history.state);
      if (!popped && st[st.length - 1] === id) stepBack();
      before?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div class="sheet-back" onPointerDown={(e) => { if (dismissable && e.target === e.currentTarget) p.onClose(); }}>
      <div ref={box} class={`sheet glass-strong${p.wide ? ' sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}
        data-tour={p['data-tour']} data-testid={p['data-testid']}>
        <span class="sheet-grip" aria-hidden="true" />
        <div class="sheet-head">
          <div class="grow">
            <h2 id={`${id}-t`}>{p.title}</h2>
            {p.sub && <p class="muted small" style={{ margin: '4px 0 0' }}>{p.sub}</p>}
          </div>
          {dismissable && <button type="button" class="iconbtn sheet-x" aria-label={t('common.close')} onClick={() => p.onClose()}><X /></button>}
        </div>
        <div class="sheet-body">{p.children}</div>
        {p.footer && <div class="sheet-foot">{p.footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- short questions ---------- */
interface Ask { id: number; title: string; text?: string; ok: string; cancel: string; danger: boolean; input?: { label: string; value: string; required: boolean }; resolve: (v: string | boolean | null) => void }
const asks = signal<Ask[]>([]);
let askSeq = 0;
/** a yes/no question: resolves true (ok) or false */
export function ask(o: { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    asks.value = [...asks.value, { id: ++askSeq, title: o.title, text: o.text, ok: o.ok || t('common.ok'), cancel: o.cancel || t('common.cancel'), danger: !!o.danger, resolve: (v) => resolve(v === true) }];
  });
}
/** a question that needs a few words (a reason…): resolves the text, or null when cancelled */
export function askText(o: { title: string; text?: string; label: string; value?: string; ok?: string; required?: boolean; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    asks.value = [...asks.value, {
      id: ++askSeq, title: o.title, text: o.text, ok: o.ok || t('common.ok'), cancel: t('common.cancel'), danger: !!o.danger,
      input: { label: o.label, value: o.value || '', required: o.required !== false }, resolve: (v) => resolve(typeof v === 'string' ? v : null)
    }];
  });
}
export function AskHost() {
  const a = asks.value[0];
  const [text, setText] = useState('');
  useEffect(() => { setText(a?.input?.value || ''); }, [a?.id]);
  if (!a) return null;
  const done = (v: string | boolean | null) => { asks.value = asks.value.slice(1); a.resolve(v); };
  const okDisabled = !!a.input?.required && !text.trim();
  return (
    <Sheet open onClose={() => done(a.input ? null : false)} title={a.title}
      footer={<>
        <Button onClick={() => done(a.input ? null : false)}>{a.cancel}</Button>
        <Button variant={a.danger ? 'danger' : 'primary'} disabled={okDisabled} onClick={() => done(a.input ? text.trim() : true)} data-testid="ask-ok">{a.ok}</Button>
      </>}>
      {a.text && <p class="muted">{a.text}</p>}
      {a.input && (
        <label class="field">
          <span class="field-label">{a.input.label}</span>
          <Textarea value={text} onValue={setText} rows={2} autoFocus />
        </label>
      )}
    </Sheet>
  );
}
