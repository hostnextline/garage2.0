/* The changes made on this device and not confirmed by the server yet, in the order they were made.
   The queue lives in memory first (the screen shows a change at once, and the sender works from here) and is kept in
   IndexedDB (local.ts) so it survives a restart and is shared with the other tabs of the account. When IndexedDB
   refuses an entry it is not lost: it stays in memory, is sent while the app is open, and a copy goes to the browser's
   small storage (rescue.ts); later entries stay in memory too until those are gone, so the order is kept
   (core-data-01). Entries written by the previous version of the app are read and sent as they are.
   Rules that keep a change from being lost or doubled:
   - an edit is merged into the last entry only when that entry never left the phone (it is marked before each
     request), so a change made after a lost answer is sent as its own update (core-data-04);
   - an entry another tab already sent is never written back (every write after a send checks it still exists);
   - « Réessayer » puts a refused change at the end of the queue, after what was done since. */
import type { LocalDb, OutboxEntry } from './local';
import { saveRescue } from './rescue';

export interface Item {
  e: OutboxEntry;
  /** nobody waits for its answer any more: the screen shows it as done (overlay.ts) */
  kept: boolean;
  /** not in IndexedDB (memory, and the rescue copy when it fits) */
  mem: boolean;
  /** a memory-only entry that the rescue copy holds too (it survives a reload) */
  rescued?: boolean;
  /** resolves once the entry has its place (seq) */
  ready: Promise<void>;
}

export class Outbox {
  items: Item[] = [];
  private memSeq = 0;
  /** the entry being sent right now by this tab */
  inFlight: Item | null = null;

  constructor(public db: LocalDb | null, private uid: string, private changed: () => void, private storageOk: (ok: boolean) => void) {}

  get memMode(): boolean { return !this.db || this.items.some((i) => i.mem); }
  pending(): Item[] { return this.items.filter((i) => i.e.state === 'pending'); }
  failed(): OutboxEntry[] { return this.items.filter((i) => i.e.state === 'failed').map((i) => i.e); }
  find(seq: number): Item | undefined { return this.items.find((i) => i.e.seq === seq); }

  /** the queue as the device keeps it (start, or another tab changed it); `rescued`: entries IndexedDB could not
      keep last time, put back at the end; resolves once they have their place */
  load(entries: OutboxEntry[], rescued: OutboxEntry[] = []): Promise<void> {
    const known = new Map(this.items.filter((i) => !i.mem).map((i) => [`${i.e.op}:${i.e.seq}`, i]));
    const mem = this.items.filter((i) => i.mem);
    this.items = entries.slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((e) => {
      const it = known.get(`${e.op}:${e.seq}`);
      if (it) { if (it !== this.inFlight) it.e = e; return it; }
      return { e, kept: true, mem: false, ready: Promise.resolve() };
    });
    this.items.push(...mem);
    const have = new Set(this.items.map((i) => i.e.op));
    const back = rescued.filter((e) => !have.has(e.op)).map((e) => this.add({ ...e, seq: undefined }, true));
    return Promise.all(back.map((i) => i.ready)).then(() => undefined);
  }

  /** a new change, at the end of the queue; resolves once it has its place */
  add(e: OutboxEntry, kept: boolean): Item {
    const inMemory = this.memMode;
    const it: Item = { e, kept, mem: inMemory, ready: Promise.resolve() };
    this.items.push(it);
    this.changed();
    if (inMemory) this.toMemory(it);
    else {
      it.ready = this.db!.addEntry(e).then((seq) => { e.seq = seq; this.storageOk(true); }, () => { this.toMemory(it); }).then(() => this.changed());
    }
    return it;
  }
  private toMemory(it: Item) {
    it.mem = true;
    it.e.seq = --this.memSeq;
    this.saveMem();
    this.storageOk(false);
  }
  saveMem() {
    const mem = this.items.filter((i) => i.mem);
    const kept = saveRescue(this.uid, mem.map((i) => i.e));
    for (const i of mem) i.rescued = kept.has(i.e.op);
  }

  /** merges an edit into the last entry when it is the same row's and never left the phone; false: add it instead */
  async merge(table: string, id: string, patch: Record<string, unknown>, prev?: Record<string, unknown>): Promise<boolean> {
    const last = this.items[this.items.length - 1];
    if (!last || last === this.inFlight) return false;
    const e = last.e;
    if (e.state !== 'pending' || e.table !== table || e.id !== id || (e.kind !== 'insert' && e.kind !== 'update')) return false;
    if (e.v !== 2 || (e.sent ?? e.tries) > 0 || e.tries > 0) return false;
    await last.ready;
    const merged = (cur: OutboxEntry): OutboxEntry => ({
      ...cur,
      values: { ...(cur.values || {}), ...patch },
      ...(cur.patch ? { patch: { ...cur.patch, ...patch } } : {}),
      ...(prev || cur.prev ? { prev: { ...(prev || {}), ...(cur.prev || {}) } } : {})
    });
    if (last.mem) { last.e = merged(e); this.saveMem(); this.changed(); return true; }
    try {
      const { result } = await this.db!.mutateEntry(e.seq!, (cur) => {
        // checked again inside the transaction: another tab may have started sending it meanwhile
        if (!cur || cur.state !== 'pending' || (cur.sent ?? cur.tries) > 0 || cur.tries > 0) return { result: null };
        const next = merged(cur);
        return { put: next, result: next };
      });
      if (!result) return false;
      last.e = { ...result, seq: e.seq };
      this.changed();
      return true;
    } catch { return false; }
  }

  /** marks the entry as « may have reached the server », before its request leaves. null: nothing to send any more */
  async attempt(it: Item): Promise<OutboxEntry | null> {
    await it.ready;
    const bump = (cur: OutboxEntry): OutboxEntry => ({ ...cur, tries: cur.tries + 1, sent: (cur.sent ?? cur.tries) + 1 });
    if (it.mem) { it.e = bump(it.e); return it.e; }
    try {
      const { result } = await this.db!.mutateEntry(it.e.seq!, (cur) => {
        if (!cur || cur.state !== 'pending') return { result: null };
        const next = bump(cur);
        return { put: next, result: next };
      });
      if (!result) { this.drop(it); return null; }
      it.e = { ...result, seq: it.e.seq };
      return it.e;
    } catch {
      // the mark could not be written: the request still leaves (its op id makes a repeat harmless)
      this.storageOk(false);
      it.e = bump(it.e);
      return it.e;
    }
  }

  /** confirmed by the server (or sent by another tab): gone from the queue */
  async done(it: Item) {
    this.drop(it);
    if (it.mem) { this.saveMem(); return; }
    try { await this.db!.mutateEntry(it.e.seq!, () => ({ del: true, result: null })); }
    catch { this.storageOk(false); }
  }
  /** refused: kept with the reason. false when the entry was already gone (another tab finished it) */
  async refuse(it: Item, error: string, err: OutboxEntry['err']): Promise<boolean> {
    const mark = (cur: OutboxEntry): OutboxEntry => ({ ...cur, state: 'failed', error, err });
    if (it.mem) { it.e = mark(it.e); this.saveMem(); this.changed(); return true; }
    try {
      const { result } = await this.db!.mutateEntry(it.e.seq!, (cur) => (cur ? { put: mark(cur), result: true } : { result: false }));
      if (!result) { this.drop(it); return false; }
    } catch { this.storageOk(false); }
    it.e = mark(it.e);
    this.changed();
    return true;
  }
  /** the person read the refusal: drop it, or send it again at the end of the queue */
  async dismiss(seq: number, retry: boolean) {
    const it = this.find(seq);
    if (!it) return;
    if (!retry) { await this.done(it); return; }
    const again: OutboxEntry = { ...it.e, seq: undefined, state: 'pending', error: undefined, err: undefined, tries: 0 };
    if (!this.memMode) {
      try {
        // taken out and put back at the end in one transaction: never lost, never twice
        const { added } = await this.db!.mutateEntry(seq, (cur) => (cur ? { del: true, add: { ...cur, ...again }, result: null } : { result: null }));
        this.drop(it);
        if (added !== undefined) this.items.push({ e: { ...again, seq: added }, kept: true, mem: false, ready: Promise.resolve() });
        this.changed();
        return;
      } catch { this.storageOk(false); }
    }
    await this.done(it);
    this.add(again, true);
  }
  /** out of the queue in memory (the caller removes it from IndexedDB, or another tab already did) */
  drop(it: Item) {
    const n = this.items.length;
    this.items = this.items.filter((i) => i !== it);
    if (this.items.length !== n) this.changed();
  }
}
