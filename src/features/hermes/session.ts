/* 🤖 Hermes: one person's conversation. Kept while the app is open, the panel closed or not, and dropped the moment the
   signed-in account changes: sign-out does not reload the page, so on a shared office computer the next person would
   otherwise find the owner's questions (unpaid invoices, the month's expenses) in the panel and send them again under
   their own name. « Voir l'app comme… » is the same owner: it keeps the conversation (the bubble is hidden meanwhile).
   This module is loaded with the bubble (host.tsx), not with the lazy panel, so the reset works even if the panel was
   never opened. No drawing here: tested in session.test.ts. */
import { signal, effect, untracked } from '@preact/signals';
import { access, callFn } from '../../data/auth';
import { errorMessage, isNetworkError } from '../../lib/errors';
import { t } from '../../lib/i18n';
import { setHermesOpen } from '../../services/bubbles';
import { stopSpeaking } from './speech';

export type Msg = { role: 'user' | 'assistant'; content: string };
export const HERMES_MS = 150000;

const newSession = () => Math.random().toString(36).slice(2, 12);
export const chat = signal<Msg[]>([]);
/** a question is on its way (the bubble shows a dot while the panel is closed) */
export const hermesBusy = signal(false);
/** the question being written: it survives closing the panel, and a question that failed comes back here */
export const draft = signal('');
/** the server said Hermes is switched off: its words, shown as a banner until an answer comes */
export const offNote = signal<string | null>(null);
let session = newSession();
let pending: AbortController | null = null;

export function sessionId(): string { return session; }

export type Ask = (body: Record<string, unknown>) => Promise<{ ok: boolean; text?: string; code?: string; error?: string }>;
const viaServer: Ask = (body) => callFn<{ text?: string }>('hermes', body, HERMES_MS);

/** what happened to a question, for the panel: a toast to show, read the answer aloud */
export type Outcome = { kind: 'answer'; text: string } | { kind: 'failed'; message: string | null } | { kind: 'dropped' };

/** the question goes with the whole conversation so far; the answer that comes after a newer question, after
    « Arrêter », « Nouvelle conversation » or a change of account is thrown away */
export async function askHermes(text: string, context: () => string, ask: Ask = viaServer): Promise<Outcome> {
  const q = text.trim();
  if (!q || hermesBusy.value) return { kind: 'dropped' };
  stopSpeaking();
  const msgs: Msg[] = [...chat.value, { role: 'user', content: q }];
  chat.value = msgs; draft.value = ''; hermesBusy.value = true;
  const mine = (pending = new AbortController());
  let ctx = '';
  try { ctx = context(); } catch { ctx = 'The garage data is not available right now.'; }
  const stopped = new Promise<never>((_, rej) => mine.signal.addEventListener('abort', () => rej(Object.assign(new Error('stop'), { name: 'AbortError' }))));
  try {
    const r = await Promise.race([ask({ messages: msgs, context: ctx, session }), stopped]);
    if (pending !== mine) return { kind: 'dropped' };
    if (r.ok && r.text) {
      chat.value = [...chat.value, { role: 'assistant', content: r.text }];
      offNote.value = null;
      return { kind: 'answer', text: r.text };
    }
    giveBack(q);
    if (r.code === 'hermes_off') { offNote.value = r.error ? said(r) : null; return { kind: 'failed', message: null }; }
    return { kind: 'failed', message: said(r) };
  } catch (e) {
    if (pending !== mine) return { kind: 'dropped' };
    giveBack(q);
    return { kind: 'failed', message: isNetworkError(e) ? errorMessage(e) : t('errors.server') };
  } finally {
    if (pending === mine) { pending = null; hermesBusy.value = false; }
  }
}
/** a refusal of the server in the person's language: its code says it in English, its own sentence in French (R145) */
function said(r: { code?: string; error?: string }): string {
  return r.code ? errorMessage({ code: r.code, error: r.error }) : r.error || t('errors.server');
}
/** the question that got no answer leaves the conversation and goes back in the box (unless something new is written) */
function giveBack(q: string) {
  const last = chat.value[chat.value.length - 1];
  if (last?.role === 'user' && last.content === q) chat.value = chat.value.slice(0, -1);
  if (!draft.value.trim()) draft.value = q;
}

/** « Arrêter »: stop waiting; the question goes back in the box, so the next one is not sent after an unanswered one */
export function stopHermes() {
  const q = pending ? chat.value[chat.value.length - 1] : null;
  pending?.abort(); pending = null; hermesBusy.value = false;
  if (q?.role === 'user') giveBack(q.content);
}
/** « Nouvelle conversation » */
export function restartHermes() {
  pending?.abort(); pending = null; hermesBusy.value = false;
  stopSpeaking();
  chat.value = []; offNote.value = null; session = newSession();
}
/** everything of this person forgotten, the panel closed (another account is now signed in, or nobody) */
export function resetHermes() {
  restartHermes();
  draft.value = '';
  setHermesOpen(false);
}

/* ---------- the account the conversation belongs to ---------- */
let owner: string | null = null;
/** called with the signed-in account's id each time it may have changed */
export function claimHermes(id: string | null) {
  if (id === owner) return;
  if (owner !== null || chat.value.length || draft.value || hermesBusy.value) resetHermes();
  owner = id;
}
// sign-out sets access to null (the buttons, another tab, a refused token), a new sign-in to the new person
effect(() => { const id = access.value?.id ?? null; untracked(() => claimHermes(id)); });
