/* Keeps this device's copy in step with the server, and sends this device's changes (the names every screen uses;
   the work is done by the account's engine, engine.ts).
   - Start: the screen shows the device copy at once, then each table pulls what changed since its cursor.
   - Live: realtime pushes changes as they happen; without it (or when it drops) the app pulls every 45 s and
     whenever it comes back to the screen. « Which rows do I still see? » is checked 4 s after start, every 30 min,
     after a long time away and when the person's rights change; a mechanic's coming jobs are checked every minute.
   - Changes made here show on screen at once and wait in the outbox, in order, until the server confirms. Every
     operation has its own id, so a repeat after a lost answer is harmless. A change the server refuses is never
     thrown away in silence: it stays listed with the reason until the person dismisses it or tries again. Trouble
     that is not a refusal (no signal, the server unwell, a session to renew) never makes a change « refusé ». */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from './schema';
import type { OutboxEntry } from './local';
import { clearAll, type Row } from './store';
import { Engine, uuid, type RpcAnswer } from './engine';
import { net, setNet, outbox, type NetState } from './net';
import { expectAccount } from './client';
import { REALTIME } from '../lib/config';
import { AppError, classify } from '../lib/errors';
export { isNetworkError } from '../lib/errors';
export { net, outbox, uuid, type NetState };

/** realtime can be switched off (the demo has no realtime server); storage 'memory' keeps nothing on the device */
export const syncOptions: { realtime: boolean; storage?: 'idb' | 'memory' } = { realtime: REALTIME };

/** told once a row has reached the server (api.ts: a new or renamed customer goes to GoHighLevel) */
export const sentHooks: { customer?: (id: string) => void } = {};
/** set by auth.ts: nothing may be changed during « Voir l'app comme… »; this person sees only part of the jobs */
export const accessHooks: { guard?: () => void; narrow?: () => boolean } = {};

const listeners = new Set<(t: TableName, rows: Row[]) => void>();
/** rows the server changed (only rows that really changed) */
export function onRemoteChange(fn: (t: TableName, rows: Row[]) => void) { listeners.add(fn); return () => listeners.delete(fn); }

let engine: Engine | null = null;
const live = (): Engine => {
  if (!engine || engine.closed) throw new AppError('bug', 'unknown', 'not started');
  return engine;
};

/* ---------- start / stop ---------- */
export async function startSync(client: SupabaseClient, userId: string) {
  // already running for this person (a second sign-in answer, a retry): just bring what is new
  if (engine && !engine.closed && engine.client === client && engine.uid === userId) { void engine.pullAll(); void engine.flush(); return; }
  stopSync();
  const e = new Engine(client, userId, {
    realtime: syncOptions.realtime,
    requireSession: !userId.startsWith('demo-'),
    storage: syncOptions.storage ?? 'idb',
    notify: (t, rows) => { for (const fn of listeners) fn(t, rows); },
    sent: (x) => {
      if (x.table !== 'customers' || !x.id) return;
      if (x.kind === 'insert' || (x.values && ['first_name', 'last_name', 'phone'].some((k) => k in x.values!))) sentHooks.customer?.(x.id);
    },
    narrow: () => accessHooks.narrow?.() ?? true,
    guard: () => accessHooks.guard?.()
  });
  engine = e;
  await e.start();
}
export function stopSync() {
  if (engine) engine.stop();
  engine = null;
  expectAccount(null);
}
/** signing out: forget what is on the screen (the device copy and its waiting changes stay for this account) */
export function resetScreen() { clearAll(); outbox.value = []; setNet({ ready: false, pending: 0, failed: [], sending: false, stuck: null, firstPull: 'no' }); }
/** the server ended this person's session: nothing is sent any more until they sign in again here */
export function sessionLost() { setNet({ session: 'lost' }); }

/* ---------- reading ---------- */
export function pullAll(): Promise<void> { return engine ? engine.pullAll() : Promise.resolve(); }
export function pull(t: TableName): Promise<void> { return engine ? engine.pull(t).then(() => undefined) : Promise.resolve(); }
/** reads one row from the server now; a failed read leaves the device copy as it is */
export function refetch(t: TableName, id: string): Promise<'updated' | 'gone' | 'failed'> { return engine ? engine.refetch(t, id) : Promise.resolve('failed'); }
/** rows the server deleted for good (an inventory item removed): gone from the screen and from the phone's copy */
export async function forgetLocal(t: TableName, ids: string[]) { if (ids.length) engine?.forget(t, ids); }
/** « which rows do I still see? » now (after a change of rights, trucks or roles) */
export function reconcile(): Promise<void> { return engine ? engine.reconcile() : Promise.resolve(); }
/** RPCs (and server functions) return the rows they changed as { rows: { table: [...] } }: put them on screen */
export function applyRows(data: unknown) { engine?.applyAnswer(data); }

/* ---------- writing ---------- */
export interface MutateOpts { label?: string }

/** new row: on screen at once, sent when possible. Returns the row as shown. */
export function insertRow(t: TableName | 'attachments', values: Record<string, unknown>, opts: MutateOpts & { patch?: Record<string, unknown> } = {}): Promise<Row> {
  return live().insertRow(t, values, opts);
}
/** change some fields of a row: on screen at once, sent when possible */
export function updateRow(t: TableName, id: string, patch: Record<string, unknown>, opts: MutateOpts & { prev?: Record<string, unknown> } = {}): Promise<void> {
  return live().updateRow(t, id, patch, opts);
}
/** soft delete (the row stays on the server with deleted_at, so other devices learn about it) */
export function deleteRow(t: TableName, id: string, opts: MutateOpts = {}) {
  return updateRow(t, id, { deleted_at: new Date().toISOString() }, opts);
}
/** a server operation (booking, invoice number, payment…). Waits for the answer when online; queued when not. */
export async function callRpc<T = unknown>(name: string, args: Record<string, unknown>, opts: MutateOpts & { queue?: boolean; noOp?: boolean } = {}): Promise<RpcAnswer<T>> {
  return live().callRpc<T>(name, args, opts);
}
/** a change of the person's own account (language, phone, switches): sent now; without signal it is kept and sent later;
    a refusal is listed in the frame. Never throws. */
export async function sendOrKeep(name: string, args: Record<string, unknown>, label?: string): Promise<{ queued: boolean }> {
  const e = live();
  try {
    await e.direct(name, args);
    return { queued: false };
  } catch (err) {
    const c = classify(err);
    if (c.kind === 'network' || c.kind === 'auth') { e.keep(name, args, label); return { queued: true }; }
    e.listRefusal(name, args, c, label);
    return { queued: false };
  }
}
/** runs `fn` once the operation `op` is confirmed by the server */
export function onConfirmed(op: string, fn: (data: unknown) => void) { engine?.onConfirmed(op, fn); }

/** sends what waits now; resolves when the queue is empty or has to wait */
export function flush(): Promise<void> { return engine ? engine.flush() : Promise.resolve(); }
/** the person read the refusal: drop it (or send it once more, after what was done since) */
export async function dismissFailed(seq: number, retry = false) { await engine?.dismiss(seq, retry); }
export async function pendingCount(): Promise<number> { return engine ? engine.outbox.pending().length : net.value.pending; }
/** the changes waiting on this device (and the refused ones), oldest first */
export async function outboxList(): Promise<OutboxEntry[]> { return engine ? engine.outbox.items.map((i) => i.e) : []; }
/** the waiting operations a screen cares about (reactive: a screen reading it redraws when the queue changes) */
export function pendingOps(match: (e: OutboxEntry) => boolean = () => true): OutboxEntry[] { return outbox.value.filter((e) => e.state === 'pending' && match(e)); }
/** this row has changes not confirmed by the server yet (reactive) */
export function pendingFor(t: TableName, id: string): boolean { return outbox.value.some((e) => e.state === 'pending' && e.table === t && e.id === id); }
