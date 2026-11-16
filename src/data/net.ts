/* What the frame says about the link with the server (the `net` signal), and when the phone counts as online.
   Online on any answer of the server; offline at once when the browser says so, or after two failures in a row
   (one when the browser already knows it has no network): one lost request on a weak signal no longer flips the
   « Pas de réseau » banners back and forth under the mechanic's finger. The signal is written only when something
   in it changed. */
import { signal } from '@preact/signals';
import type { OutboxEntry } from './local';
import { sameValue } from './merge';

export interface NetState {
  online: boolean;          // the server answers
  realtime: boolean;
  pending: number;          // changes waiting
  failed: OutboxEntry[];    // changes the server refused
  sending: boolean;
  lastPull: string | null;
  ready: boolean;           // the first pull is done, well or not (or the device copy is shown offline)
  storageBroken: boolean;   // = storage !== 'ok'
  /** ok; expired: the session is being renewed (changes wait, nothing is refused); lost: the server ended the session
      (signed out elsewhere, account blocked): changes stay on the phone until this person signs in again here */
  session: 'ok' | 'expired' | 'lost';
  /** ok; memory: this phone cannot keep changes right now (private window, storage lost or full): they are sent while
      the app stays open, and a copy is kept in the browser's small storage when it can be */
  storage: 'ok' | 'memory';
  /** the change at the head of the queue has not passed for a while (no signal, server unwell, app to update) */
  stuck: { label?: string; since: string; tries: number; why: 'network' | 'server' | 'update' } | null;
  /** the first download of this session: not finished, all tables received, or some could not be read */
  firstPull: 'no' | 'ok' | 'failed';
}

const START: NetState = {
  online: true, realtime: false, pending: 0, failed: [], sending: false, lastPull: null, ready: false, storageBroken: false,
  session: 'ok', storage: 'ok', stuck: null, firstPull: 'no'
};
export const net = signal<NetState>(START);
/** the changes waiting on this device and the refused ones, oldest first (redrawn only when the queue changes) */
export const outbox = signal<OutboxEntry[]>([]);

const sameFailed = (a: OutboxEntry[], b: OutboxEntry[]) => a.length === b.length && a.every((e, i) => e.seq === b[i].seq && e.error === b[i].error && e.op === b[i].op);

export function setNet(p: Partial<NetState>) {
  const cur = net.value;
  let changed = false;
  for (const k of Object.keys(p) as (keyof NetState)[]) {
    const a = cur[k], b = p[k];
    if (k === 'failed' ? !sameFailed(a as OutboxEntry[], b as OutboxEntry[]) : k === 'stuck' ? !sameValue(a, b) : a !== b) { changed = true; break; }
  }
  if (!changed) return;
  const next = { ...cur, ...p };
  next.storageBroken = next.storage !== 'ok';
  net.value = next;
}

let failures = 0;
/** every request tells how it went: an answer (whatever its status) or no answer at all */
export function noteTraffic(answered: boolean) {
  if (answered) { failures = 0; setNet({ online: true }); return; }
  failures++;
  const browserOff = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (browserOff || failures >= 2) setNet({ online: false });
}
/** the browser says the network is gone */
export function browserOffline() { failures = 2; setNet({ online: false }); }
