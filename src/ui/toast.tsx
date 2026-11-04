/* Toasts: a short line at the bottom that says what just happened (and, for an error, what to do).
   run(fn) / attempt(fn): do an action, show its result or the server's refusal in a toast. */
import { signal } from '@preact/signals';
import { t } from '../lib/i18n';
import { errorMessage } from '../data/api';

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'bad'; action?: { label: string; run: () => unknown }; ms: number }
export const toasts = signal<Toast[]>([]);
let seq = 0;

export function toast(text: string, o: { kind?: Toast['kind']; action?: Toast['action']; ms?: number } = {}): number {
  const id = ++seq;
  const kind = o.kind || 'info';
  const ms = o.ms ?? (kind === 'bad' ? 7000 : o.action ? 6000 : 3200);
  toasts.value = [...toasts.value.filter((x) => x.text !== text), { id, text, kind, action: o.action, ms }].slice(-3);
  setTimeout(() => dismissToast(id), ms);
  return id;
}
export function dismissToast(id: number) { toasts.value = toasts.value.filter((x) => x.id !== id); }

export function ToastHost() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((x) => (
        <div key={x.id} class={`toast${x.kind === 'bad' ? ' toast-bad' : ''}`} data-testid={`toast-${x.kind}`}>
          <span class="grow">{x.text}</span>
          {x.action && <button type="button" class="btn btn-sm" onClick={() => { dismissToast(x.id); void x.action!.run(); }}>{x.action.label}</button>}
          <button type="button" class="toast-x" aria-label={t('common.close')} onClick={() => dismissToast(x.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

function isQueued(r: unknown): boolean { return !!r && typeof r === 'object' && (r as { queued?: boolean }).queued === true; }

/** does the action; on success shows `ok` (or « gardé sur le téléphone » when it waits for signal); on refusal
    shows the reason. Returns the result, or undefined when it failed. Never throws. */
export async function run<T>(fn: () => Promise<T> | T, o: { ok?: string; quiet?: boolean } = {}): Promise<T | undefined> {
  try {
    const r = await fn();
    if (isQueued(r)) toast(t('shell.queued'));
    else if (o.ok) toast(o.ok, { kind: 'ok' });
    return r;
  } catch (e) {
    if (!o.quiet) toast(errorMessage(e), { kind: 'bad' });
    return undefined;
  }
}
/** the same, for actions that return nothing: true when it worked */
export async function attempt(fn: () => Promise<unknown> | unknown, o: { ok?: string; quiet?: boolean } = {}): Promise<boolean> {
  try {
    const r = await fn();
    if (isQueued(r)) toast(t('shell.queued'));
    else if (o.ok) toast(o.ok, { kind: 'ok' });
    return true;
  } catch (e) {
    if (!o.quiet) toast(errorMessage(e), { kind: 'bad' });
    return false;
  }
}
