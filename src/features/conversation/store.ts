/* « Texto entrant »: the state of the bubbles on this device, and what belongs to the person signed in.
   - The bubbles (open / round head / closed, read up to when) are kept on the device (`his-text-chats`), and the day this
     device started looking (`his-text-since`): only a text newer than that wakes a bubble the first time.
   - The answers being written, one per number, are kept while the app is open: « Réduire », « Sa fiche », another head or
     the Hermes panel close the window, not the answer.
   - When the account changes (sign-out, another person signing in in the same tab) the answers being written are
     dropped, and the alert of this browser is switched off: the customers' texts must not keep popping up on a device
     the owner left (the server forgets this device at its next alert, when the push service says it is gone). */
import { signal, effect, untracked } from '@preact/signals';
import { access } from '../../data/auth';
import { pushOff } from '../../services/push';
import { attempt } from '../../ui';
import { uuid } from '../../data/sender';
import { FRESH_MS, phoneId, type Chat } from '../../shared/customers/texts';

const LS_CHATS = 'his-text-chats', LS_SINCE = 'his-text-since';

export function readChats(raw: string | null): Chat[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((c) => c && typeof c.phone === 'string' && typeof c.seenAt === 'string') : [];
  } catch { return []; }
}
function load(): Chat[] { try { return readChats(localStorage.getItem(LS_CHATS)); } catch { return []; } }

export const chats = signal<Chat[]>(load());
export function setChats(next: Chat[]) {
  if (next === chats.value) return;
  chats.value = next;
  // a private window: the bubbles hold until the app closes
  try { localStorage.setItem(LS_CHATS, JSON.stringify(next)); } catch { /* not kept on this device */ }
}

/** since when this device looks at the texts (the first time: only a text of the last minutes wakes a bubble) */
export function since(now = Date.now()): string {
  const first = new Date(now - FRESH_MS).toISOString();
  try {
    const v = localStorage.getItem(LS_SINCE);
    if (v) return v;
    localStorage.setItem(LS_SINCE, first);
  } catch { /* a private window: the last minutes only, every time */ }
  return first;
}

/* ---------- the answers being written ---------- */
const drafts = new Map<string, string>();
export function draftOf(phone: string): string { return drafts.get(phoneId(phone)) || ''; }
export function setDraft(phone: string, text: string) {
  const k = phoneId(phone);
  if (text) drafts.set(k, text); else drafts.delete(k);
  // an answer changed (or sent, or emptied) is another text: its operation number goes (R28)
  if (ops.get(k)?.text !== text) ops.delete(k);
}
/* one operation number per answer typed (R28): the same while the words stay the same, so a « Envoyer » tapped again
   after an answer that never came back (no signal, a timeout) is the same text for the server, which sends it once */
const ops = new Map<string, { text: string; op: string }>();
export function opOf(phone: string, text: string, make: () => string = uuid): string {
  const k = phoneId(phone);
  const had = ops.get(k);
  if (had && had.text === text) return had.op;
  const op = make();
  ops.set(k, { text, op });
  return op;
}

/* ---------- the person signed in ---------- */
let owner: string | null = null;
export function claimTexts(id: string | null, alertOff: () => Promise<void> = pushOff) {
  if (id === owner) return;
  const left = owner;
  owner = id;
  drafts.clear(); ops.clear();
  // only an account that was signed in can have switched the alert on in this browser
  if (left) void attempt(alertOff, { quiet: true });
}
effect(() => { const id = access.value?.id ?? null; untracked(() => claimTexts(id)); });
