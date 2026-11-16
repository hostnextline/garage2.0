/* The offline engine of one signed-in account on this device. It owns everything that runs in the background for
   that account — the device copy, the outbox and its sender, the pulls, the visibility check, realtime, the timers
   and the listeners — and nothing else does. Signing out (or switching account) stops it: its requests are
   cancelled, and any answer that still comes back is dropped before it touches the screen, the database or a cursor
   (core-data-07). The next account gets a new engine.
   Order at start: the device copy on screen at once, then live changes, the first pull, the queue. */
import { batch } from '@preact/signals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNCED, isSynced, type TableName } from './schema';
import { openLocal, type LocalDb, type OutboxEntry, type Commit } from './local';
import { bindStore, unbindStore, baseRow, baseIds, baseRows, type Row, type StoreWriter } from './store';
import { Outbox } from './outbox';
import { waitingOf } from './overlay';
import { REQUEST_MS } from './send';
import { Sender } from './sender';
import { pullTable } from './pull';
import { scanTable, fetchBy, jobsGone, type ScanIO } from './reconcile';
import { subscribeChanges, readChange, type Change } from './realtime';
import { senderLock, type SenderLock, type LockManagerLike } from './lock';
import { net, setNet, browserOffline, outbox as outboxSignal } from './net';
import { ask, expectAccount, STOP } from './client';
import { readRescue, clearRescue } from './rescue';
import { serverNow, tsMicros } from './clock';
import { classify, type AppError } from '../lib/errors';
import { today, addDays } from '../lib/dates';

export interface EngineOptions {
  realtime: boolean;
  /** every database request must carry this account's session (off for the demo, which has none) */
  requireSession: boolean;
  storage: 'idb' | 'memory';
  /** the browser's Web Locks (tests pass their own; null = none) */
  locks?: LockManagerLike | null;
  /** rows the server changed (the rights follow the person's own row, the settings…) */
  notify(t: TableName, rows: Row[]): void;
  /** a table write reached the server */
  sent(e: OutboxEntry): void;
  /** this person sees only part of the jobs (a mechanic without « Agenda »): their coming jobs are watched */
  narrow(): boolean;
  /** throws when nothing may be changed (« Voir l'app comme… ») */
  guard(): void;
  /** the waits between two tries of the queue's head (tests make them short) */
  retryDelays?: number[];
}


const CYCLE_MS = 45000;
const LIVE_CYCLE_MS = 180000;
const SAFETY_MS = 20000;
/** tables pulled at the same time (all 23 at once was a burst on a weak signal) */
const PULLS_AT_ONCE = 8;
const SCAN_MS = 30 * 60000;
const WATCH_MS = 60000;
const HIDDEN_LONG_MS = 10 * 60000;
/** what to read with a job that appears on this device (it came onto my truck): its lines, texts, trips and money */
const CHILDREN: { t: TableName; by: string }[] = [
  { t: 'job_items', by: 'job_id' }, { t: 'messages', by: 'job_id' }, { t: 'trips', by: 'job_id' }, { t: 'invoices', by: 'job_id' }, { t: 'payments', by: 'job_id' }
];
const LEAVES_WITH_JOB: TableName[] = ['job_items', 'messages', 'trips'];


export class Engine {
  closed = false;
  readonly outbox: Outbox;
  /** the queue's sender (the writing half of this engine) */
  readonly send: Sender;
  private readonly ctl = new AbortController();
  private readonly token = {};
  private readonly writer: StoreWriter;
  private readonly lock: SenderLock;
  private readonly io: ScanIO;
  private db: LocalDb | null;
  private meta: Record<string, unknown> = {};
  private pulling = new Map<TableName, Promise<boolean>>();
  private reconciling: Promise<void> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private timeouts = new Set<ReturnType<typeof setTimeout>>();
  private off: (() => void)[] = [];
  private watchers = new Map<TableName, Set<Set<string>>>();
  private firstPullDone = false;
  private lastPullAt = 0;
  private lastWatch = 0;
  private hiddenAt = 0;
  private storageGood = true;
  private arrivals = new Set<string>();
  private arrivalsTimer: ReturnType<typeof setTimeout> | null = null;
  private rereads = new Map<TableName, Set<string>>();
  private rereadTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDraw = Date.now();
  private lastDay = today();

  constructor(readonly client: SupabaseClient, readonly uid: string, private readonly o: EngineOptions) {
    this.writer = bindStore(this.token);
    this.db = o.storage === 'idb' && typeof indexedDB !== 'undefined' ? openLocal(uid) : null;
    this.outbox = new Outbox(this.db, uid, () => this.outboxChanged(), (ok) => this.storageOk(ok));
    this.lock = senderLock(uid, { locks: o.locks });
    this.send = new Sender({
      client, signal: this.ctl.signal, outbox: this.outbox, lock: this.lock, retryDelays: o.retryDelays,
      closed: () => this.closed, guard: () => o.guard(), sent: (x) => o.sent(x), changed: () => this.outboxChanged(),
      sessionOk: () => this.sessionOk(), applyAnswer: (d) => this.applyAnswer(d), keepRows: (t, rows) => this.keepRows(t, rows),
      refetch: (t, id) => this.refetch(t, id), pull: (t) => this.pull(t)
    });
    const self = this;
    this.io = {
      client, signal: this.ctl.signal,
      closed: () => this.closed,
      get meta() { return self.meta; },
      apply: (t, rows, force) => this.apply(t, rows, force),
      remove: (t, ids) => { if (!this.closed) this.writer.remove(t, ids); },
      save: (c) => this.save(c),
      baseIds: (t) => baseIds(t),
      baseStamp: (t, id) => { const r = baseRow(t, id); return r ? r.updated_at ?? null : undefined; },
      watch: (t) => { const s = new Set<string>(); let w = this.watchers.get(t); if (!w) this.watchers.set(t, (w = new Set())); w.add(s); return s; },
      unwatch: (t, s) => { this.watchers.get(t)?.delete(s); },
      older: new Set<string>()
    };
  }

  /* ---------- start and stop ---------- */
  async start() {
    expectAccount(this.uid, this.o.requireSession);
    setNet({ ready: false, firstPull: 'no', stuck: null, session: 'ok', sending: false, realtime: false });
    let loaded: Awaited<ReturnType<LocalDb['loadAll']>> | null = null;
    if (this.db) {
      try { loaded = await this.db.loadAll(); }
      catch {
        // the device copy cannot be read: this session runs in memory, the database is left as it is for next time
        this.db.close(); this.db = null; this.outbox.db = null; this.storageGood = false;
      }
    }
    if (this.closed) return;
    this.meta = loaded?.meta ?? {};
    const rescued = readRescue(this.uid);
    const back = this.outbox.load(loaded?.outbox ?? [], rescued);
    if (rescued.length) void back.then(() => { if (!this.outbox.memMode) clearRescue(this.uid); });
    this.writer.loadAll((loaded?.rows ?? {}) as Partial<Record<TableName, Row[]>>, this.waiting());
    this.counts();
    this.listen();
    if (this.o.realtime) this.subscribe();
    void this.pullAll().then(() => { if (this.closed) return; this.firstPullDone = true; setNet({ ready: true }); });
    void this.send.flush();
    this.timers.push(
      setInterval(() => this.cycle(), CYCLE_MS),
      setInterval(() => { void this.reconcile(); }, SCAN_MS),
      setInterval(() => { if (this.outbox.pending().length) void this.send.flush(); }, SAFETY_MS)
    );
    this.later(() => { void this.reconcile(); }, 4000);
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    this.ctl.abort(STOP);
    for (const t of this.timers) clearInterval(t);
    for (const t of this.timeouts) clearTimeout(t);
    for (const t of [this.arrivalsTimer, this.rereadTimer]) if (t) clearTimeout(t);
    this.send.stop();
    this.timers = []; this.timeouts.clear();
    for (const f of this.off) f();
    this.off = [];
    this.lock.close();
    unbindStore(this.token);
    this.db?.close();
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => { this.timeouts.delete(t); if (!this.closed) fn(); }, ms);
    this.timeouts.add(t);
  }

  private listen() {
    if (typeof document !== 'undefined') {
      const h = () => this.onVisible();
      document.addEventListener('visibilitychange', h);
      this.off.push(() => document.removeEventListener('visibilitychange', h));
    }
    if (typeof window !== 'undefined') {
      const on = () => { void this.send.flush(); void this.pullAll(); };
      const offline = () => browserOffline();
      window.addEventListener('online', on);
      window.addEventListener('offline', offline);
      this.off.push(() => { window.removeEventListener('online', on); window.removeEventListener('offline', offline); });
    }
    this.off.push(this.lock.listen((m) => { if (m === 'kick') void this.send.flush(); else void this.reloadOutbox(); }));
  }
  private onVisible() {
    if (document.visibilityState === 'hidden') { this.hiddenAt = Date.now(); return; }
    this.timeMoved(true);
    void this.pullAll();
    void this.send.flush();
    void this.watchMyJobs(true);
    if (this.hiddenAt && Date.now() - this.hiddenAt > HIDDEN_LONG_MS) void this.reconcile();
  }
  private cycle() {
    if (!net.value.realtime || Date.now() - this.lastPullAt >= LIVE_CYCLE_MS) void this.pullAll();
    void this.watchMyJobs();
    this.timeMoved(false);
  }
  /** a pull that brings nothing new no longer redraws the screens; what depends on the time of day (« aujourd'hui », a
      block that started, a promotion that ended) still follows it: one draw when the day changes, when the app comes
      back to the screen, and every 3 minutes while it is on screen (the old pulls did it 23 draws at a time) */
  private timeMoved(back: boolean) {
    const day = today();
    const shown = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (day === this.lastDay && !back && !(shown && Date.now() - this.lastDraw >= LIVE_CYCLE_MS)) return;
    this.lastDay = day;
    this.lastDraw = Date.now();
    this.writer.redraw();
  }

  /* ---------- the store and the device copy ---------- */
  private waiting() { return waitingOf(this.outbox.items.map((i) => ({ e: i.e, kept: i.kept }))); }
  private outboxChanged() {
    if (this.closed) return;
    this.writer.setWaiting(this.waiting());
    this.counts();
  }
  private counts() {
    if (this.closed) return;
    setNet({ pending: this.outbox.pending().length, failed: this.outbox.failed(), storage: this.storageGood && !this.outbox.memMode ? 'ok' : 'memory' });
    const list = this.outbox.items.map((i) => i.e);
    const cur = outboxSignal.value;
    if (list.length !== cur.length || list.some((e, i) => e !== cur[i])) outboxSignal.value = list;
  }
  private storageOk(ok: boolean) { this.storageGood = ok; this.counts(); }

  /** rows from the server: into the store (not-older rule), told to who listens, and the jobs new on this device noted */
  private apply(t: TableName, rows: Row[], force = false): { put: Row[]; removed: string[] } {
    if (this.closed || !rows.length) return { put: [], removed: [] };
    for (const s of this.watchers.get(t) || []) for (const r of rows) if (r?.id != null) s.add(String(r.id));
    const before = t === 'jobs' && this.firstPullDone ? new Map(rows.map((r) => [String(r?.id), baseRow(t, String(r?.id))])) : null;
    const res = this.writer.apply(t, rows, { force });
    if (res.put.length) {
      this.o.notify(t, res.put);
      if (before) this.noteArrivals(res.put, before);
    }
    return res;
  }
  /** applies and keeps them on the device */
  private keepRows(t: TableName, rows: Row[]) {
    const { put, removed } = this.apply(t, rows);
    if (put.length || removed.length) void this.save({ rows: [{ table: t, put, del: removed }] });
  }
  private removeRows(t: TableName, ids: string[]) {
    if (this.closed || !ids.length) return;
    this.writer.remove(t, ids);
    void this.save({ rows: [{ table: t, put: [], del: ids }] });
  }
  private async save(c: Commit) {
    if (!this.db || this.closed) return;
    try { await this.db.commit(c); if (!this.storageGood) this.storageOk(true); }
    catch { this.storageOk(false); }
  }
  /** operations and server functions answer the rows they changed as { rows: { table: [...] } } */
  applyAnswer(data: unknown) {
    const d = data as { rows?: Record<string, Row[]> } | null;
    if (!d || typeof d !== 'object' || !d.rows || typeof d.rows !== 'object' || Array.isArray(d.rows)) return;
    batch(() => { for (const [t, rows] of Object.entries(d.rows!)) if (isSynced(t) && Array.isArray(rows)) this.keepRows(t, rows); });
  }

  /* ---------- pulling ---------- */
  pull(t: TableName): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    const running = this.pulling.get(t);
    if (running) return running;
    const p = pullTable(this.io, t)
      .then(() => { this.sessionOk(); return true; }, (e) => { this.noteReadFailure(classify(e)); return false; })
      .finally(() => this.pulling.delete(t));
    this.pulling.set(t, p);
    return p;
  }
  async pullAll(): Promise<void> {
    if (this.closed) return;
    this.lastPullAt = Date.now();
    const todo = [...SYNCED];
    let ok = 0;
    const worker = async () => { while (todo.length && !this.closed) { if (await this.pull(todo.shift()!)) ok++; } };
    await Promise.all(Array.from({ length: PULLS_AT_ONCE }, worker));
    if (this.closed) return;
    const all = ok === SYNCED.length;
    setNet({ ...(ok ? { lastPull: new Date().toISOString() } : {}), firstPull: all ? 'ok' : net.value.firstPull === 'ok' ? 'ok' : 'failed' });
  }
  private noteReadFailure(e: AppError) {
    if (this.closed) return;
    if (e.kind === 'auth' && net.value.session === 'ok') setNet({ session: 'expired' });
  }
  private sessionOk() { if (!this.closed && net.value.session === 'expired') setNet({ session: 'ok' }); }

  /** reads one row now. 'gone' only on a clean « no such row for you » answer: a failed read changes nothing (core-data-02) */
  async refetch(t: TableName, id: string): Promise<'updated' | 'gone' | 'failed'> {
    if (this.closed || !id || id === 'undefined' || id === 'null') return 'failed';
    try {
      const row = await ask<Row | null>((s) => this.client.from(t).select('*').eq('id', id).retry(false).abortSignal(s).maybeSingle(), REQUEST_MS, this.ctl.signal);
      if (this.closed) return 'failed';
      if (row) { this.keepRows(t, [row]); return 'updated'; }
      this.removeRows(t, [id]);
      return 'gone';
    } catch { return 'failed'; }
  }
  /** rows the server deleted for good: gone from the screen and from the device copy */
  forget(t: TableName, ids: string[]) { this.removeRows(t, ids); }

  /* ---------- « what do I still see? » ---------- */
  reconcile(tables: readonly TableName[] = SYNCED): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      for (const t of tables) {
        if (this.closed) return;
        try { await scanTable(this.io, t); }
        catch (e) { const c = classify(e); if (c.kind === 'network' || c.kind === 'auth') return; }
      }
    })().finally(() => { this.reconciling = null; });
    return this.reconciling;
  }
  /** a job new on this device, or moved onto another truck: its lines and texts did not « change », they are read now */
  private noteArrivals(put: Row[], before: Map<string, Row | undefined>) {
    const fresh = serverNow() - 120000;
    for (const r of put) {
      const was = before.get(r.id);
      const created = tsMicros(r.created_at as string | undefined) / 1000;
      const arrived = was ? was.truck_id !== r.truck_id : !(created > fresh);
      if (arrived) this.arrivals.add(r.id);
    }
    if (!this.arrivals.size || this.arrivalsTimer) return;
    this.arrivalsTimer = setTimeout(() => { this.arrivalsTimer = null; void this.readArrivals(); }, 400);
  }
  private async readArrivals() {
    const ids = [...this.arrivals];
    this.arrivals.clear();
    if (this.closed || !ids.length) return;
    try {
      for (const c of CHILDREN) await fetchBy(this.io, c.t, ids, c.by);
      const jobs = ids.map((id) => baseRow(('jobs'), id)).filter((j): j is Row => !!j);
      const want = (t: TableName, key: string) => [...new Set(jobs.map((j) => j[key]).filter((v): v is string => typeof v === 'string' && !baseRow(t, v)))];
      await fetchBy(this.io, 'customers', want('customers', 'customer_id'));
      await fetchBy(this.io, 'vehicles', want('vehicles', 'vehicle_id'));
    } catch { /* the next visibility check reads them */ }
  }
  /** a mechanic's coming jobs that are no longer his leave his phone at once (core-data-15), with their lines and texts */
  async watchMyJobs(now = false) {
    if (this.closed || !this.o.narrow()) return;
    if (!now && Date.now() - this.lastWatch < WATCH_MS) return;
    this.lastWatch = Date.now();
    const from = addDays(today(), -1);
    const ids = baseRows<Row & { status?: string; day?: string }>('jobs').filter((j) => ['booked', 'en_route', 'on_site'].includes(String(j.status)) && String(j.day) >= from).map((j) => j.id);
    if (!ids.length) return;
    const seen = this.io.watch('jobs');
    try {
      const gone = (await jobsGone(this.io, ids)).filter((id) => !seen.has(id));
      if (this.closed || !gone.length) return;
      const set = new Set(gone);
      batch(() => {
        this.removeRows('jobs', gone);
        for (const t of LEAVES_WITH_JOB) this.removeRows(t, baseRows<Row & { job_id?: string }>(t).filter((r) => r.job_id && set.has(r.job_id)).map((r) => r.id));
      });
    } catch { /* next time */ } finally { this.io.unwatch('jobs', seen); }
  }

  /* ---------- realtime ---------- */
  private subscribe() {
    this.off.push(subscribeChanges(this.client, this.uid, SYNCED, (c) => this.onChange(c), (live) => {
      if (this.closed) return;
      setNet({ realtime: live });
      if (live) void this.pullAll();
    }));
  }
  private onChange(c: Change) {
    if (this.closed) return;
    const id = String(c.row?.id ?? c.oldId ?? '');
    const r = readChange(c, id ? baseRow(c.t, id) : undefined);
    if (r.remove) this.removeRows(c.t, [r.remove]);
    else if (r.apply) this.keepRows(c.t, [r.apply]);
    else if (r.refetch) this.rereadSoon(c.t, r.refetch);
    if (c.t === 'jobs' && this.o.narrow()) this.later(() => { void this.watchMyJobs(); }, 2000);
  }
  private rereadSoon(t: TableName, id: string) {
    let s = this.rereads.get(t);
    if (!s) this.rereads.set(t, (s = new Set()));
    s.add(id);
    if (this.rereadTimer) return;
    this.rereadTimer = setTimeout(() => {
      this.rereadTimer = null;
      const all = [...this.rereads];
      this.rereads.clear();
      for (const [table, ids] of all) void fetchBy(this.io, table, [...ids]).catch(() => undefined);
    }, 150);
  }

  private async reloadOutbox() {
    if (this.closed || !this.db) return;
    try {
      const list = await this.db.listEntries();
      if (this.closed) return;
      await this.outbox.load(list);
      this.outboxChanged();
    } catch { /* this tab's own view stays until its next send */ }
  }
}
