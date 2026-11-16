/* The copy of the garage's data kept on this device (IndexedDB), one database per account so two people sharing a
   phone never mix their changes: `his-garage-<uid>`, version 3. Stores: one per synced table (key = id, the
   server's rows), "meta" (sync cursors), "outbox" (changes not yet confirmed by the server, in order).
   The layout never changes (phones in the field hold waiting changes in it, and the previous version of the app must
   still find and send them): new things are new meta keys or new OPTIONAL fields of an outbox entry.
   Every call either works or throws: the engine decides what a failure means (memory queue, warning on screen).
   A failed call drops the connection and tries once more on a fresh one (iOS loses the connection when the app
   sleeps). Rows and their cursor are written in ONE transaction, so a page is never half kept. */
import { openDB, type IDBPDatabase } from 'idb';
import { SYNCED } from './schema';
import type { Row } from './store';
import { withLimit } from './clock';

const VERSION = 3;
const OPEN_LIMIT = 8000;
const CALL_LIMIT = 20000;

export interface OutboxEntry {
  seq?: number;
  op: string;                  // client operation id (uuid): the server ignores a repeat
  kind: 'insert' | 'update' | 'rpc';
  table?: string;
  id?: string;
  values?: Record<string, unknown>;
  rpc?: string;
  args?: Record<string, unknown>;
  label?: string;              // what the person did, in their words ("Réservation de Jean Tremblay")
  at: string;
  tries: number;
  state: 'pending' | 'failed';
  error?: string;
  /* optional, written by this version only (the previous one ignores them and keeps them when it rewrites an entry) */
  v?: 2;
  /** requests ever started for this entry, counted BEFORE each request: > 0 = it may have reached the server */
  sent?: number;
  /** how the server refused it (the words are in `error`; `said` = the server's own sentence, for another language) */
  err?: { kind: string; sub: string; code?: string; hint?: string; status?: number; said?: string };
  /** settings parts: each part as the screen showed it before the edit (merged at send time, see merge3) */
  prev?: Record<string, unknown>;
  /** an insert made for a row this device did not hold: the fields the person set, sent as a change when the row exists */
  patch?: Record<string, unknown>;
}

export interface Commit {
  rows?: { table: string; put: Row[]; del: string[] }[];
  /** meta keys to write; undefined = delete the key */
  meta?: Record<string, unknown>;
}

export interface Loaded { rows: Record<string, Row[]>; outbox: OutboxEntry[]; meta: Record<string, unknown> }
export interface EntryChange<T> { put?: OutboxEntry; del?: boolean; add?: OutboxEntry; result: T }

export interface LocalDb {
  readonly uid: string;
  loadAll(): Promise<Loaded>;
  commit(c: Commit): Promise<void>;
  /** adds at the end of the outbox; the key gives the order */
  addEntry(e: OutboxEntry): Promise<number>;
  /** reads an entry, lets `fn` decide, writes what it says — in one transaction (another tab cannot slip in between);
      `added` is the key of the entry `fn` asked to add */
  mutateEntry<T>(seq: number, fn: (cur: OutboxEntry | undefined) => EntryChange<T>): Promise<{ result: T; added?: number }>;
  listEntries(): Promise<OutboxEntry[]>;
  /** empties the table stores and their cursors; never the outbox */
  wipeRows(): Promise<void>;
  close(): void;
}

const STORES = (): string[] => [...SYNCED, 'meta', 'outbox'];
/** an aborted transaction: its requests and its end reject, which says nothing more than the error already thrown */
const abort = (tx: { abort(): void; done: Promise<void> }) => { tx.done.catch(() => undefined); try { tx.abort(); } catch { /* already finished */ } };
/** one request of a transaction: its failure fails the transaction (`tx.done`), which is what is awaited */
const req = (p: Promise<unknown>) => { p.catch(() => undefined); };

export function openLocal(uid: string): LocalDb {
  let handle: Promise<IDBPDatabase> | null = null;
  let closed = false;

  const open = (): Promise<IDBPDatabase> => {
    if (handle) return handle;
    const p = new Promise<IDBPDatabase>((resolve, reject) => {
      // a version change held by another tab must not keep the app on its splash for ever
      const limit = setTimeout(() => reject(Object.assign(new Error('IndexedDB open timed out'), { name: 'TimeoutError' })), OPEN_LIMIT);
      openDB(`his-garage-${uid}`, VERSION, {
        upgrade(db) {
          for (const t of SYNCED) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        },
        // a newer version of the app wants to upgrade the database: let it, and load that version
        blocking() {
          void p.then((db) => db.close(), () => undefined);
          handle = null;
          if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload();
        },
        terminated() { handle = null; }
      }).then((db) => { clearTimeout(limit); resolve(db); }, (e) => { clearTimeout(limit); reject(e); });
    });
    handle = p;
    p.catch(() => { if (handle === p) handle = null; });
    return p;
  };

  /** runs `fn` on the database; on failure drops the connection and tries once more on a new one. A call that never
      settles (a transaction lost when an iPhone puts the app to sleep) fails after a while instead of holding the
      queue for ever (x-errors-35). */
  async function use<T>(fn: (db: IDBPDatabase) => Promise<T>): Promise<T> {
    if (closed) throw new Error('local database closed');
    try {
      return await withLimit(fn(await open()), CALL_LIMIT);
    } catch (first) {
      if (closed) throw first;
      const stale = handle;
      handle = null;
      if (stale) void stale.then((db) => db.close(), () => undefined);
      return await withLimit(fn(await open()), CALL_LIMIT);
    }
  }

  return {
    uid,
    loadAll: () => use(async (db) => {
      const tx = db.transaction(STORES(), 'readonly');
      const rows: Record<string, Row[]> = {};
      await Promise.all(SYNCED.map(async (t) => { rows[t] = (await tx.objectStore(t).getAll()) as Row[]; }));
      const outbox = (await tx.objectStore('outbox').getAll()) as OutboxEntry[];
      const meta: Record<string, unknown> = {};
      let cur = await tx.objectStore('meta').openCursor();
      while (cur) { meta[String(cur.key)] = cur.value; cur = await cur.continue(); }
      await tx.done;
      return { rows, outbox, meta };
    }),
    commit: (c) => use(async (db) => {
      const names = new Set<string>();
      for (const r of c.rows || []) if (r.put.length || r.del.length) names.add(r.table);
      if (c.meta && Object.keys(c.meta).length) names.add('meta');
      if (!names.size) return;
      const tx = db.transaction([...names], 'readwrite');
      // an error while the requests are made does not abort a transaction by itself: all or nothing, by hand
      try {
        for (const r of c.rows || []) {
          if (!r.put.length && !r.del.length) continue;
          const s = tx.objectStore(r.table);
          for (const row of r.put) req(s.put(row));
          for (const id of r.del) req(s.delete(id));
        }
        if (c.meta) {
          const m = tx.objectStore('meta');
          for (const [k, v] of Object.entries(c.meta)) req(v === undefined ? m.delete(k) : m.put(v, k));
        }
      } catch (e) { abort(tx); throw e; }
      await tx.done;
    }),
    addEntry: (e) => use(async (db) => {
      const { seq: _drop, ...rest } = e;
      void _drop;
      return (await db.add('outbox', rest)) as number;
    }),
    mutateEntry: <T,>(seq: number, fn: (cur: OutboxEntry | undefined) => EntryChange<T>) => use(async (db) => {
      const tx = db.transaction('outbox', 'readwrite');
      let out: EntryChange<T>;
      let added: number | undefined;
      try {
        const cur = (await tx.store.get(seq)) as OutboxEntry | undefined;
        out = fn(cur);
        if (out.del) req(tx.store.delete(seq));
        else if (out.put) req(tx.store.put({ ...out.put, seq }));
        if (out.add) { const { seq: _s, ...rest } = out.add; void _s; added = (await tx.store.add(rest)) as number; }
      } catch (e) { abort(tx); throw e; }
      await tx.done;
      return { result: out.result, added };
    }),
    listEntries: () => use(async (db) => (await db.getAll('outbox')) as OutboxEntry[]),
    wipeRows: () => use(async (db) => {
      const tx = db.transaction([...SYNCED, 'meta'], 'readwrite');
      for (const t of SYNCED) req(tx.objectStore(t).clear());
      req(tx.objectStore('meta').clear());
      await tx.done;
    }),
    close() {
      closed = true;
      const h = handle;
      handle = null;
      if (h) void h.then((db) => db.close(), () => undefined);
    }
  };
}
