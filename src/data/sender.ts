/* Sending this device's changes, in the order they were made, for one account's engine (engine.ts owns the rest).
   - A table write shows on screen at once and is sent when possible; it never throws for a refusal.
   - An operation waits a little for its answer (8 s, 1.5 s when the phone knows it has no signal): answered, it
     returns the answer; refused, it throws to the screen that waited; else « kept on the phone ».
   - One entry at a time, oldest first. No signal, the server unwell, a session to renew: the entry waits and is tried
     again (2, 5, 15, 30, 60 s, and at once when the signal or the session comes back); nothing of that is a refusal.
   - A refusal nobody waits for is listed with its reason; the row comes back as the server has it. */
import { batch } from '@preact/signals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSynced, type TableName } from './schema';
import type { OutboxEntry } from './local';
import type { Row } from './store';
import type { Outbox, Item } from './outbox';
import type { SenderLock } from './lock';
import { sendEntry, REQUEST_MS, type Sent } from './send';
import { net, setNet } from './net';
import { ask } from './client';
import { sampleServerTime } from './clock';
import { AppError, classify, keptRefusal } from '../lib/errors';

/** what the sender needs from its engine */
export interface SenderHost {
  client: SupabaseClient;
  signal: AbortSignal;
  outbox: Outbox;
  lock: SenderLock;
  closed(): boolean;
  /** throws when nothing may be changed (« Voir l'app comme… ») */
  guard(): void;
  /** a table write reached the server */
  sent(e: OutboxEntry): void;
  retryDelays?: number[];
  /** the queue changed (the screen and the counts follow) */
  changed(): void;
  sessionOk(): void;
  applyAnswer(data: unknown): void;
  keepRows(t: TableName, rows: Row[]): void;
  refetch(t: TableName, id: string): Promise<unknown>;
  pull(t: TableName): Promise<unknown>;
}

interface Waiter { resolve(v: unknown): void; reject(e: unknown): void; watching: boolean }
/** `op`: the operation's id (optional so that callers typing the old answer still compile) */
export interface RpcAnswer<T> { queued: boolean; data?: T; op?: string }

const DELAYS = [2000, 5000, 15000, 30000, 60000];
const STUCK_AFTER_MS = 120000;
/** an operation unknown to the server is tried this many times before it is listed as refused (a deploy may be under way) */
const UPDATE_TRIES = 5;
/** refusals that say « this job is not (or no longer) yours » */
const NOT_MINE = /^(not_allowed|not_found|no_job)$/;

export function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class Sender {
  private waiters = new Map<string, Waiter>();
  private confirmed = new Map<string, ((data: unknown) => void)[]>();
  private refusals = new Map<string, ((err: unknown) => void)[]>();
  private draining: Promise<void> | null = null;
  private again = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private refreshes = 0;
  private head: { op: string; since: number } | null = null;

  constructor(private readonly h: SenderHost) {}

  /** the engine stops: no retry left planned; a screen still waiting gets « kept » when its wait ends */
  stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.waiters.clear();
    this.confirmed.clear();
    this.refusals.clear();
  }

  private entry(p: Partial<OutboxEntry> & Pick<OutboxEntry, 'kind'>): OutboxEntry {
    return { op: uuid(), at: new Date().toISOString(), tries: 0, state: 'pending', v: 2, sent: 0, ...p };
  }
  private queued() { this.h.lock.poke('outbox'); void this.flush(); }

  async insertRow(t: string, values: Record<string, unknown>, o: { label?: string; patch?: Record<string, unknown> } = {}): Promise<Row> {
    this.h.guard();
    const id = String(values.id || uuid());
    const row = { ...values, id } as Row;
    const it = this.h.outbox.add(this.entry({ kind: 'insert', table: t, id, values: row, label: o.label, ...(o.patch ? { patch: o.patch } : {}) }), true);
    await it.ready;
    this.queued();
    return row;
  }
  async updateRow(t: string, id: string, patch: Record<string, unknown>, o: { label?: string; prev?: Record<string, unknown> } = {}): Promise<void> {
    this.h.guard();
    const separately = () => this.h.outbox.add(this.entry({ kind: 'update', table: t, id, values: patch, label: o.label, ...(o.prev ? { prev: o.prev } : {}) }), true);
    const merged = this.h.outbox.merge(t, id, patch, o.prev, () => { separately(); this.queued(); });
    await (merged ? this.h.outbox.items[this.h.outbox.items.length - 1]?.ready : separately().ready);
    this.queued();
  }

  /** an operation that needs the network now (never kept for later) */
  async direct<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const data = await ask<T>((s) => this.h.client.rpc(name, args).abortSignal(s), REQUEST_MS, this.h.signal);
    if (!this.h.closed()) { this.h.sessionOk(); this.h.applyAnswer(data); }
    return data;
  }
  /** an operation kept in the outbox: waits a little for the answer, else « kept on the phone » */
  async callRpc<T>(name: string, args: Record<string, unknown>, o: { label?: string; queue?: boolean; noOp?: boolean } = {}): Promise<RpcAnswer<T>> {
    if (!o.noOp) this.h.guard();
    const op = String(args.p_op || uuid());
    const full = o.noOp ? { ...args } : { ...args, p_op: op };
    if (o.queue === false || o.noOp) return { queued: false, data: await this.direct<T>(name, full), op };
    let resolve!: (v: unknown) => void, reject!: (e: unknown) => void;
    const answer = new Promise<unknown>((a, b) => { resolve = a; reject = b; });
    const w: Waiter = { resolve, reject, watching: true };
    this.waiters.set(op, w);
    const it = this.h.outbox.add(this.entry({ op, kind: 'rpc', rpc: name, args: full, label: o.label }), false);
    await it.ready;
    this.queued();
    // not long when the phone already knows there is no signal; past that the frame lists a later refusal
    const wait = net.value.online ? 8000 : 1500;
    const quick = await Promise.race([
      answer.then((d) => ({ done: true as const, d }), (e: unknown) => ({ done: true as const, e })),
      new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), wait))
    ]);
    if (quick.done) {
      if ('e' in quick) throw quick.e;
      return { queued: false, data: quick.d as T, op };
    }
    w.watching = false;
    // neither IndexedDB nor the rescue copy could keep it and no request is on its way: « kept on the phone » would be
    // a lie (core-data-01). It is taken back and the person is told it was not done.
    if (it.mem && !it.rescued && this.h.outbox.inFlight !== it && it.e.state === 'pending') {
      this.waiters.delete(op);
      this.h.outbox.drop(it);
      this.h.outbox.saveMem();
      throw new AppError('network', 'offline', 'not kept: no storage and no signal', { code: 'not_kept' });
    }
    it.kept = true;
    this.h.changed();
    return { queued: true, op };
  }
  /** an operation kept without an op id (the server's change is a plain patch: sending it twice is harmless) */
  keep(name: string, args: Record<string, unknown>, label?: string) {
    this.h.outbox.add(this.entry({ kind: 'rpc', rpc: name, args, label }), true);
    this.queued();
  }
  /** a refusal the person must see in the frame's « refusé » list although no screen waited for it */
  listRefusal(name: string, args: Record<string, unknown>, err: AppError, label?: string) {
    this.h.outbox.add(this.entry({ kind: 'rpc', rpc: name, args, label, state: 'failed', ...keptRefusal(err) }), true);
    this.h.lock.poke('outbox');
  }
  /** runs `fn` with the answer once the operation `op` is confirmed */
  onConfirmed(op: string, fn: (data: unknown) => void) {
    const l = this.confirmed.get(op);
    if (l) l.push(fn); else this.confirmed.set(op, [fn]);
  }
  /** runs `fn` with the reason when the operation `op` is refused (a refusal is never sent again by itself) */
  onRefused(op: string, fn: (err: unknown) => void) {
    const l = this.refusals.get(op);
    if (l) l.push(fn); else this.refusals.set(op, [fn]);
  }
  async dismiss(seq: number, retry: boolean) {
    await this.h.outbox.dismiss(seq, retry);
    this.h.lock.poke('outbox');
    if (retry) void this.flush();
  }

  /* ---------- sending ---------- */
  /** sends what waits, in order; resolves when the queue is empty or has to wait (no signal, session to renew) */
  flush(): Promise<void> {
    if (this.h.closed()) return Promise.resolve();
    if (this.draining) { this.again = true; return this.draining; }
    const run = async () => {
      do {
        this.again = false;
        const mine = await this.h.lock.run(() => this.drain());
        if (!mine) { this.h.lock.poke('kick'); break; }
      } while (this.again && !this.h.closed());
    };
    this.draining = run().finally(() => {
      this.draining = null;
      // a change queued in the instant the round was ending must not wait for the safety timer
      if (this.again && !this.h.closed() && this.h.outbox.pending().length) { this.again = false; void this.flush(); }
    });
    return this.draining;
  }
  private async drain() {
    if (this.h.closed()) return;
    setNet({ sending: true });
    try {
      for (;;) {
        if (this.h.closed()) return;
        const it = this.h.outbox.pending()[0];
        if (!it) { this.head = null; setNet({ stuck: null }); return; }
        const out = await this.sendOne(it);
        if (out === 'wait') { this.scheduleRetry(); return; }
      }
    } finally {
      if (!this.h.closed()) setNet({ sending: false });
    }
  }
  private scheduleRetry() {
    if (this.retryTimer || this.h.closed()) return;
    const delays = this.h.retryDelays ?? DELAYS;
    const d = delays[Math.min(this.backoff, delays.length - 1)] * (0.8 + Math.random() * 0.4);
    this.backoff++;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, d);
  }
  private async sendOne(it: Item): Promise<'ok' | 'failed' | 'again' | 'wait'> {
    const e = await this.h.outbox.attempt(it);
    if (this.h.closed()) return 'wait';
    if (!e) return 'ok';
    this.h.outbox.inFlight = it;
    const t0 = Date.now();
    try {
      const sent = await sendEntry(this.h.client, e, this.h.signal);
      if (this.h.closed()) return 'wait';
      await this.settle(it, e, sent, t0);
      return 'ok';
    } catch (err) {
      if (this.h.closed()) return 'wait';
      return await this.outcome(it, e, classify(err));
    } finally {
      this.h.outbox.inFlight = null;
    }
  }
  private async settle(it: Item, e: OutboxEntry, sent: Sent, t0: number) {
    if (sent.row?.updated_at && e.kind !== 'rpc') sampleServerTime(String(sent.row.updated_at), t0, Date.now());
    let gone: Promise<void> = Promise.resolve();
    // the server's row replaces this device's change in one draw
    batch(() => {
      if (sent.row && isSynced(e.table)) this.h.keepRows(e.table, [sent.row]);
      if (e.kind === 'rpc') this.h.applyAnswer(sent.data);
      gone = this.h.outbox.done(it);
    });
    await gone;
    this.h.lock.poke('outbox');
    this.backoff = 0; this.refreshes = 0; this.head = null;
    setNet({ stuck: null });
    this.h.sessionOk();
    const w = this.waiters.get(e.op);
    if (w) { this.waiters.delete(e.op); w.resolve(sent.data); }
    for (const fn of this.confirmed.get(e.op) || []) fn(sent.data);
    this.confirmed.delete(e.op);
    this.refusals.delete(e.op);
    this.h.sent(e);
    // what the server changes by itself after these writes is brought at once
    if (e.table === 'job_items' && e.kind === 'update') void this.h.pull('invoices');
    if (e.table === 'jobs' && e.values && 'odometer_km' in e.values) void this.h.pull('vehicles');
  }
  private noteHead(it: Item, why: 'network' | 'server' | 'update') {
    if (!this.head || this.head.op !== it.e.op) this.head = { op: it.e.op, since: Date.now() };
    if (Date.now() - this.head.since >= STUCK_AFTER_MS) setNet({ stuck: { label: it.e.label, since: new Date(this.head.since).toISOString(), tries: it.e.tries, why } });
  }
  private async outcome(it: Item, e: OutboxEntry, err: AppError): Promise<'failed' | 'again' | 'wait'> {
    if (err.kind === 'network') { this.noteHead(it, err.sub === 'server' || err.sub === 'busy' ? 'server' : 'network'); return 'wait'; }
    if (err.kind === 'auth') {
      // the session ran out: renew it once or twice and send the same entry again; else wait, nothing is refused
      if (err.sub === 'expired' && this.refreshes < 2) {
        this.refreshes++;
        const r = await this.h.client.auth.refreshSession().catch(() => ({ error: true }));
        if (this.h.closed()) return 'wait';
        if (!r.error) return 'again';
      }
      if (net.value.session === 'ok') setNet({ session: 'expired' });
      this.noteHead(it, 'network');
      return 'wait';
    }
    if (err.kind === 'bug' && err.sub === 'update' && e.tries < UPDATE_TRIES) { this.noteHead(it, 'update'); return 'wait'; }
    // a refusal (or a case nobody planned): never sent again by itself, never dropped in silence
    const w = this.waiters.get(e.op);
    this.waiters.delete(e.op);
    this.confirmed.delete(e.op);
    const told = this.refusals.get(e.op) || [];
    this.refusals.delete(e.op);
    if (w?.watching) await this.h.outbox.done(it);
    else { const k = keptRefusal(err); await this.h.outbox.refuse(it, k.error, k.err); }
    this.h.lock.poke('outbox');
    this.head = null;
    w?.reject(err);
    for (const fn of told) fn(err);
    // the server's version of what was refused comes back on screen (a failed read changes nothing)
    if (e.table && e.id && isSynced(e.table)) await this.h.refetch(e.table, e.id);
    const job = e.kind === 'rpc' ? e.args?.p_job : null;
    if (typeof job === 'string' && NOT_MINE.test(String(err.hint || err.code || ''))) await this.h.refetch('jobs', job);
    return 'failed';
  }
}
