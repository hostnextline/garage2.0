/* What the floating hosts of the frame share (🤖 Hermes, « Appel entrant », « Texto entrant »), and what Réglages asks them.
   The hosts themselves stay in their sections (features/hermes/host.tsx, features/booking/CallBanner.tsx,
   features/conversation/TextHost.tsx). No screen here. */
import { signal } from '@preact/signals';
import { isOwner, preview, access } from '../data/auth';

/* ---------- 🤖 Hermes ---------- */
export const hermesOpen = signal(false);
const remember = (v: boolean) => { try { localStorage.setItem('his-hermes-open', v ? '1' : '0'); } catch { /* private window */ } };
export function setHermesOpen(v: boolean) { hermesOpen.value = v; remember(v); }

/* ---------- « Appel entrant » ---------- */
export interface IncomingCall { id: string; phone: string; name: string | null; at: string }
/** Appel entrant with the number (10 digits) and the name already there */
export function callLink(c: Pick<IncomingCall, 'phone' | 'name'>): string {
  const d = c.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return `/call?phone=${encodeURIComponent(d)}${c.name ? `&name=${encodeURIComponent(c.name)}` : ''}`;
}
let askCalls: (() => void) | null = null;
/** the host on screen says how to look now (null when it leaves) */
export function onCheckCalls(look: (() => void) | null) { askCalls = look; }
/** look now (after « Essayer » in Réglages) */
export const checkCalls = () => askCalls?.();

/** this account gets the incoming calls: an owner who switched them on */
export function callsOn(): boolean { return isOwner() && !preview.value && access.value?.prefs?.calls === true; }

/* ---------- « Texto entrant » ---------- */
let askTexts: (() => void) | null = null;
/** the host on screen says how to look now (null when it leaves) */
export function onCheckTexts(look: (() => void) | null) { askTexts = look; }
/** look now (after « Essayer » in Réglages) */
export const checkTexts = () => askTexts?.();

/** the texts come to this account: an owner who switched them on for themself (Réglages → Branchements) */
export function textsOn(): boolean { return isOwner() && !preview.value && access.value?.prefs?.texts === true; }
