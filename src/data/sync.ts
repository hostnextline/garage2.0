/* Keeps this device's copy in step with the server, and sends this device's changes.
   - Start: the screen shows the device copy at once, then each table pulls what changed since its cursor.
   - Live: realtime pushes changes as they happen; without it (or when it drops) the app pulls every 45 s and
     whenever it comes back to the screen. A light "which ids do I still see?" check runs every 30 min.
   - Changes made here apply to the screen at once and wait in the outbox, in order, until the server confirms.
     Every operation has its own id, so a repeat after a lost answer is harmless. A change the server refuses is
     never thrown away in silence: it stays listed with the reason until the person dismisses it or tries again. */
import { signal } from '@preact/signals';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { SYNCED, SCOPED, type TableName } from './schema';
import { readAll, writeRows, replaceAll, getMeta, setMeta, outboxAll, outboxAdd, outboxPut, outboxDelete, storageBroken, type OutboxEntry } from './local';
import { upsertLocal, patchLocal, removeLocal, replaceLocal, getRow, clearAll, type Row } from './store';
import { REALTIME } from '../lib/config';

export interface NetState {
  online: boolean;          // last request reached the server
  realtime: boolean;
  pending: number;          // changes waiting
  failed: OutboxEntry[];    // changes the server refused
  sending: boolean;
  lastPull: string | null;
  ready: boolean;           // the first pull is done (or the device copy is shown offline)
  storageBroken: boolean;
}
export const net = signal<NetState>({ online: true, realtime: false, pending: 0, failed: [], sending: false, lastPull: null, ready: false, storageBroken: false });
const setNet = (p: Partial<NetState>) => { net.value = { ...net.value, ...p }; };

let sb: SupabaseClient | null = null;
let uid = '';
let channel: RealtimeChannel | null = null;
let timers: ReturnType<typeof setInterval>[] = [];
let flushing = false;
let flushAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 0;
const waiters = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; watching?: boolean }>();
const pulling = new Map<string, Promise<void>>();
const listeners = new Set<(t: TableName, rows: Row[]) => void>();

export const REQUEST_TIMEOUT = 15000;
/** realtime can be switched off (the demo has no realtime server) */
export const syncOptions = { realtime: REALTIME };
const PAGE = 1000;

export function onRemoteChange(fn: (t: TableName, rows: Row[]) => void) { listeners.add(fn); return () => listeners.delete(fn); }

export function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function withTimeout<T>(p: PromiseLike<T>, ms = REQUEST_TIMEOUT): Promise<T> {
  return new Promise<T>((res, rej) => {
    const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    Promise.resolve(p).then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); });
  });
}

/** network trouble (try again later) vs. a real refusal (tell the person) */
export function isNetworkError(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string; name?: string } | null;
  if (!err) return false;
  if (err.code === 'timeout') return true;
  // the database asked to try again (two changes at the same instant): not a refusal
  if (err.code === '40P01' || err.code === '40001' || err.code === '55P03') return true;
  if (typeof err.status === 'number' && (err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500)) return true;
  const m = String(err.message || err.name || '');
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|ECONN|ETIMEDOUT|aborted|AbortError/i.test(m) && !/permission|policy|violates/i.test(m);
}
function isAuthError(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string } | null;
  return !!err && (err.status === 401 || err.code === 'PGRST301' || err.code === 'PGRST303' || /JWT expired|invalid JWT|jwt/i.test(String(err.message || '')));
}
export function errorText(e: unknown): string {
  const err = e as { message?: string; details?: string; hint?: string } | null;
  return String(err?.message || err || 'erreur').slice(0, 300);
}

/* ---------- start / stop ---------- */
export async function startSync(client: SupabaseClient, userId: string) {
  // already running for this person (a second sign-in answer, a retry): just bring what is new
  if (sb === client && uid === userId && timers.length) { void pullAll(); void flush(); return; }
  stopSync();
  sb = client; uid = userId;
  setNet({ storageBroken: false, ready: false });
  // 1. the device copy, at once
  await Promise.all(SYNCED.map(async (t) => replaceLocal(t, await readAll<Row>(uid, t))));
  await refreshOutboxState();
  setNet({ storageBroken: storageBroken() });
  // 2. live changes, then what changed while away
  if (syncOptions.realtime) subscribe();
  pullAll().finally(() => setNet({ ready: true }));
  void flush();
  timers.push(setInterval(() => { if (!net.value.realtime || Date.now() % 180000 < 45000) void pullAll(); }, 45000));
  timers.push(setInterval(() => { void checkIds(); }, 30 * 60000));
  timers.push(setInterval(() => { if (net.value.pending) void flush(); }, 20000));
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  setTimeout(() => void checkIds(), 4000);
}
export function stopSync() {
  for (const t of timers) clearInterval(t);
  timers = [];
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (channel && sb) { void sb.removeChannel(channel); }
  channel = null;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
}
/** signing out: forget what is on the screen (the device copy stays for this account) */
export function resetScreen() { clearAll(); setNet({ ready: false, pending: 0, failed: [] }); }

let hiddenAt = 0;
function onVisible() {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  void pullAll();
  void flush();
  if (hiddenAt && Date.now() - hiddenAt > 10 * 60000) void checkIds();
}
function onOnline() { void flush(); void pullAll(); }

/* ---------- pulling ---------- */
export function pullAll(): Promise<void> {
  return Promise.all(SYNCED.map((t) => pull(t))).then(() => undefined);
}
export function pull(t: TableName): Promise<void> {
  const running = pulling.get(t);
  if (running) return running;
  const p = doPull(t).finally(() => pulling.delete(t));
  pulling.set(t, p);
  return p;
}
async function doPull(t: TableName) {
  if (!sb) return;
  const curKey = `cursor:${t}`;
  let cursor = (await getMeta<string>(uid, curKey)) || '';
  try {
    for (;;) {
      let q = sb.from(t).select('*').order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
      // a little overlap: two changes in the same instant are never missed
      if (cursor) q = q.gte('updated_at', new Date(Date.parse(cursor) - 2000).toISOString());
      const { data, error } = await withTimeout(q);
      if (error) throw error;
      const rows = (data || []) as Row[];
      applyServerRows(t, rows);
      setNet({ online: true, lastPull: new Date().toISOString() });
      const last = rows[rows.length - 1];
      if (last?.updated_at) cursor = String(last.updated_at);
      await setMeta(uid, curKey, cursor);
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    if (isNetworkError(e)) setNet({ online: false });
  }
}
function applyServerRows(t: TableName, rows: Row[], force = false) {
  if (!rows.length) return;
  const { put, removed } = upsertLocal(t, rows, { force });
  void writeRows(uid, t, put, removed);
  for (const fn of listeners) fn(t, rows);
}
/** rows this account can no longer see (a job moved to another truck…) leave the device */
export async function checkIds() {
  if (!sb) return;
  for (const t of SCOPED) {
    try {
      // a change sent while the list is being read must not be taken for a row that left: what is waiting before
      // AND after the listing is kept, and so is any row changed since the check started
      const started = Date.now();
      const pendingBefore = new Set((await outboxAll(uid)).filter((e) => e.table === t).map((e) => e.id));
      const ids = new Set<string>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await withTimeout(sb.from(t).select('id').is('deleted_at', null).range(from, from + PAGE - 1));
        if (error) throw error;
        for (const r of data || []) ids.add((r as { id: string }).id);
        if (!data || data.length < PAGE) break;
      }
      const local = await readAll<Row>(uid, t);
      const pendingAfter = new Set((await outboxAll(uid)).filter((e) => e.table === t).map((e) => e.id));
      const recent = (r: Row) => { const u = Date.parse(String(r.updated_at || r.created_at || '')); return Number.isFinite(u) && u > started - 120000; };
      const gone = local.filter((r) => !ids.has(r.id) && !pendingBefore.has(r.id) && !pendingAfter.has(r.id) && !recent(r)).map((r) => r.id);
      if (gone.length) { removeLocal(t, gone); await writeRows(uid, t, [], gone); }
    } catch (e) { if (isNetworkError(e)) { setNet({ online: false }); return; } }
  }
}

/* ---------- realtime ---------- */
function subscribe() {
  if (!sb) return;
  let ch = sb.channel(`db-${uid.slice(0, 8)}`);
  for (const t of SYNCED) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => {
      const row = (p.new && Object.keys(p.new).length ? p.new : null) as Row | null;
      if (row) applyServerRows(t, [row]);
    });
  }
  channel = ch.subscribe((status) => {
    const live = status === 'SUBSCRIBED';
    setNet({ realtime: live });
    if (live) void pullAll();
  });
}

/* ---------- writing ---------- */
async function refreshOutboxState() {
  const all = (await outboxAll(uid));
  setNet({ pending: all.filter((e) => e.state === 'pending').length, failed: all.filter((e) => e.state === 'failed') });
}

export interface MutateOpts { label?: string }

/** new row: on screen at once, sent when possible. Returns the row as shown. */
const isSynced = (t: string): t is TableName => (SYNCED as readonly string[]).includes(t);
export async function insertRow(t: TableName | 'attachments', values: Record<string, unknown>, opts: MutateOpts = {}): Promise<Row> {
  const id = String(values.id || uuid());
  const row = { ...values, id } as Row;
  if (isSynced(t)) { upsertLocal(t, [row], { force: true }); await writeRows(uid, t, [row]); }
  await queue({ op: uuid(), kind: 'insert', table: t, id, values: row, label: opts.label, at: new Date().toISOString(), tries: 0, state: 'pending' });
  return row;
}
/** change some fields of a row: on screen at once, sent when possible */
export async function updateRow(t: TableName, id: string, patch: Record<string, unknown>, opts: MutateOpts = {}): Promise<void> {
  const row = patchLocal(t, id, patch);
  if (row) await writeRows(uid, t, row.deleted_at ? [] : [row], row.deleted_at ? [id] : []);
  // a change to a row still waiting to be created (or changed) is merged into that pending entry
  const all = await outboxAll(uid);
  const last = all[all.length - 1];
  if (last && last.state === 'pending' && last.table === t && last.id === id && (last.kind === 'insert' || last.kind === 'update') && !flushing) {
    last.values = { ...(last.values || {}), ...patch };
    await outboxPut(uid, last);
    void flush();
    return;
  }
  await queue({ op: uuid(), kind: 'update', table: t, id, values: patch, label: opts.label, at: new Date().toISOString(), tries: 0, state: 'pending' });
}
/** soft delete (the row stays on the server with deleted_at, so other devices learn about it) */
export function deleteRow(t: TableName, id: string, opts: MutateOpts = {}) {
  return updateRow(t, id, { deleted_at: new Date().toISOString() }, opts);
}
/** a server operation (booking, invoice number, payment…). Waits for the answer when online; queued when not. */
export async function callRpc<T = unknown>(name: string, args: Record<string, unknown>, opts: MutateOpts & { queue?: boolean; noOp?: boolean } = {}): Promise<{ queued: boolean; data?: T }> {
  const op = String(args.p_op || uuid());
  const fullArgs = opts.noOp ? { ...args } : { ...args, p_op: op };
  if (opts.queue === false || opts.noOp) {
    if (!sb) throw new Error('not started');
    const { data, error } = await withTimeout(sb.rpc(name, fullArgs));
    if (error) { if (isNetworkError(error)) setNet({ online: false }); throw error; }
    setNet({ online: true });
    applyRpcResult(data);
    return { queued: false, data: data as T };
  }
  const entry: OutboxEntry = { op, kind: 'rpc', rpc: name, args: fullArgs, label: opts.label, at: new Date().toISOString(), tries: 0, state: 'pending' };
  // « watching »: the screen is still waiting for the answer and will show a refusal itself
  const result = new Promise<unknown>((resolve, reject) => waiters.set(op, { resolve, reject, watching: true }));
  await queue(entry);
  // wait a little for the answer (not long when the phone already knows there is no signal); past that, the
  // caller treats it as « will be sent », and a later refusal goes to the « refusé » banner of the frame
  const wait = net.value.online ? 8000 : 1500;
  const quick = await Promise.race([result.then((d) => ({ done: true, d }), (e) => ({ done: true, e })), new Promise((r) => setTimeout(() => r({ done: false }), wait))]) as { done: boolean; d?: unknown; e?: unknown };
  if (quick.done && 'e' in quick && quick.e) throw quick.e;
  if (quick.done) return { queued: false, data: quick.d as T };
  const w = waiters.get(op);
  if (w) w.watching = false;
  return { queued: true };
}
/** resolves when a queued operation is confirmed (or refused) */
export function whenDone(op: string): Promise<unknown> {
  return new Promise((resolve, reject) => waiters.set(op, { resolve, reject }));
}

async function queue(e: OutboxEntry) {
  try { await outboxAdd(uid, e); } catch { setNet({ storageBroken: true }); }
  await refreshOutboxState();
  void flush();
}

export async function flush(): Promise<void> {
  if (!sb || !uid) return;
  if (flushing) { flushAgain = true; return; }
  flushing = true;
  setNet({ sending: true });
  try {
    for (;;) {
      const next = (await outboxAll(uid)).find((e) => e.state === 'pending');
      if (!next) break;
      const res = await send(next);
      if (res === 'wait') { scheduleRetry(); break; }
    }
  } finally {
    flushing = false;
    setNet({ sending: false });
    await refreshOutboxState();
    if (flushAgain) { flushAgain = false; void flush(); }
  }
}
function scheduleRetry() {
  if (retryTimer) return;
  const delays = [2000, 5000, 15000, 30000, 60000];
  const d = delays[Math.min(backoff, delays.length - 1)];
  backoff++;
  retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, d);
}

async function send(e: OutboxEntry): Promise<'ok' | 'failed' | 'wait'> {
  const client = sb!;
  try {
    let data: unknown;
    if (e.kind === 'insert') {
      const r = await withTimeout(client.from(e.table!).upsert(e.values!, { onConflict: 'id', ignoreDuplicates: true }).select(isSynced(e.table!) ? '*' : 'id'));
      if (r.error) throw r.error;
      let row = (r.data as Row[] | null)?.[0];
      if (!row) {
        // it was already there (an answer got lost): take the server's copy
        const g = await withTimeout(client.from(e.table!).select(isSynced(e.table!) ? '*' : 'id').eq('id', e.id!).maybeSingle());
        if (g.error) throw g.error;
        row = g.data as Row | undefined;
        if (!row) throw Object.assign(new Error('Ligne refusée par le serveur'), { code: '42501' });
      }
      if (isSynced(e.table!)) applyServerRows(e.table as TableName, [row], true);
      data = row;
    } else if (e.kind === 'update') {
      const r = await withTimeout(client.from(e.table!).update(e.values!).eq('id', e.id!).select('*'));
      if (r.error) throw r.error;
      const row = (r.data as Row[] | null)?.[0];
      if (!row) throw Object.assign(new Error('Changement refusé : tu n’as pas (ou plus) accès à cette fiche'), { code: '42501' });
      applyServerRows(e.table as TableName, [row], true);
      // the server makes the job's draft invoice follow its work (a line taken off, a new price): bring it at once
      if (e.table === 'job_items') void pull('invoices');
      data = row;
    } else {
      const r = await withTimeout(client.rpc(e.rpc!, e.args!), 40000);
      if (r.error) throw r.error;
      data = r.data;
      applyRpcResult(r.data);
    }
    await outboxDelete(uid, e.seq!);
    backoff = 0;
    setNet({ online: true });
    waiters.get(e.op)?.resolve(data);
    waiters.delete(e.op);
    return 'ok';
  } catch (err) {
    if (isAuthError(err)) {
      const { error } = await client.auth.refreshSession();
      if (!error) return 'wait';
    }
    if (isNetworkError(err) || isAuthError(err)) {
      setNet({ online: false });
      e.tries++;
      await outboxPut(uid, e);
      return 'wait';
    }
    // refused: keep it, with the reason, and bring back the server's version of that row — unless the screen that
    // asked is still waiting: it shows the reason itself, so the refusal isn't listed twice
    const w = waiters.get(e.op);
    if (w?.watching) await outboxDelete(uid, e.seq!);
    else { e.state = 'failed'; e.error = errorText(err); await outboxPut(uid, e); }
    w?.reject(err);
    waiters.delete(e.op);
    if (e.table && e.id && isSynced(e.table)) await refetch(e.table, e.id);
    return 'failed';
  }
}
/** RPCs (and server functions) return the rows they changed as { rows: { table: [...] } }: put them on screen */
export function applyRows(data: unknown) { applyRpcResult(data); }
function applyRpcResult(data: unknown) {
  const d = data as { rows?: Record<string, Row[]> } | null;
  if (!d || typeof d !== 'object' || !d.rows) return;
  for (const [t, rows] of Object.entries(d.rows)) if ((SYNCED as readonly string[]).includes(t) && Array.isArray(rows)) applyServerRows(t as TableName, rows, true);
}
export async function refetch(t: TableName, id: string) {
  if (!sb || !id || id === 'undefined' || id === 'null') return;
  try {
    const { data } = await withTimeout(sb.from(t).select('*').eq('id', id).maybeSingle());
    if (data) applyServerRows(t, [data as Row], true);
    else { removeLocal(t, [id]); await writeRows(uid, t, [], [id]); }
  } catch { /* stays as is */ }
}
/** rows the server deleted for good (an inventory item removed): gone from the screen and from the phone's copy */
export async function forgetLocal(t: TableName, ids: string[]) {
  if (!ids.length) return;
  removeLocal(t, ids);
  await writeRows(uid, t, [], ids);
}
/** the person read the refusal: drop it (or send it once more) */
export async function dismissFailed(seq: number, retry = false) {
  const e = (await outboxAll(uid)).find((x) => x.seq === seq);
  if (!e) return;
  if (retry) { e.state = 'pending'; e.error = undefined; e.tries = 0; await outboxPut(uid, e); void flush(); }
  else await outboxDelete(uid, seq);
  await refreshOutboxState();
}
export async function pendingCount(): Promise<number> {
  return (await outboxAll(uid)).filter((e) => e.state === 'pending').length;
}
/** read one row from the server now (used before a decision that needs fresh data) */
export async function fresh<T extends Row>(t: TableName, id: string): Promise<T | undefined> {
  await refetch(t, id);
  return getRow<T>(t, id);
}
export { replaceAll };
/** the changes waiting on this device (and the refused ones), oldest first */
export async function outboxList(): Promise<OutboxEntry[]> { return uid ? outboxAll(uid) : []; }
/** who this device's copy belongs to (empty before sign-in) */
export function currentUid(): string { return uid; }
