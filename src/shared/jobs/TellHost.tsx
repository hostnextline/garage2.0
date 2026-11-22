/* « Envoyer les heures aux clients » (Part 28, REARRANGE.md §3.3): openTell(day) opens the day's send list over any
   screen. Its host is mounted on first use in its own little root on document.body (the « Texter … ? » and
   « booking-sms » way), so no screen mounts it and it opens also from a toast whose screen is gone. It needs the
   network: offline, a tap says so and nothing opens (the texts could not go, the server's list could not come). */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { t } from '../../lib/i18n';
import { net } from '../../data/sync';
import { toast } from '../../ui';
import { TellSheet } from './TellSheet';

const open = signal<{ day: string; seq: number } | null>(null);
let seq = 0;
let host: HTMLElement | null = null;
function ensureHost() {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.dataset.owner = 'tell';
  document.body.appendChild(host);
  render(<TellHost />, host);
}

/** opens the send list of `day` (a day already open is shown again from the start) */
export function openTell(day: string): void {
  if (!net.peek().online) { toast(t('tell.offline'), { kind: 'bad' }); return; }
  ensureHost();
  open.value = { day, seq: ++seq };
}
/** the day whose list is open (null: none); tests */
export const tellOpen = (): string | null => open.value?.day ?? null;
/** closes the list (tests, sign-out) */
export function closeTell(): void { open.value = null; }

export function TellHost() {
  const o = open.value;
  if (!o) return null;
  return <TellSheet key={o.seq} day={o.day} onClose={() => { if (open.peek()?.seq === o.seq) open.value = null; }} />;
}
