/* The copy of the garage's data kept on this device (IndexedDB), one database per account so two people sharing a
   phone never mix their changes. Stores: one per synced table (key = id), "meta" (sync cursors, cached profile),
   "outbox" (changes not yet confirmed by the server, in order). */
import { openDB, type IDBPDatabase } from 'idb';
import { SYNCED } from './schema';

const VERSION = 3;
let dbp: Promise<IDBPDatabase> | null = null;
let current = '';
let broken = false;

export function storageBroken(): boolean { return broken; }

export function openLocal(uid: string): Promise<IDBPDatabase> {
  if (dbp && current === uid) return dbp;
  current = uid;
  dbp = openDB(`his-garage-${uid}`, VERSION, {
    upgrade(db) {
      for (const t of SYNCED) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    },
    blocked() { /* another tab holds an older version: it will reload */ },
    terminated() { dbp = null; }
  }).catch((e) => { broken = true; throw e; });
  return dbp;
}

export async function closeLocal() {
  if (dbp) { try { (await dbp).close(); } catch { /* ignore */ } }
  dbp = null; current = '';
}

export async function readAll<T>(uid: string, table: string): Promise<T[]> {
  try { return (await (await openLocal(uid)).getAll(table)) as T[]; } catch { broken = true; return []; }
}
export async function writeRows(uid: string, table: string, rows: Record<string, unknown>[], removeIds: string[] = []) {
  if (!rows.length && !removeIds.length) return;
  try {
    const db = await openLocal(uid);
    const tx = db.transaction(table, 'readwrite');
    for (const r of rows) tx.store.put(r);
    for (const id of removeIds) tx.store.delete(id);
    await tx.done;
  } catch { broken = true; }
}
export async function replaceAll(uid: string, table: string, rows: Record<string, unknown>[]) {
  try {
    const db = await openLocal(uid);
    const tx = db.transaction(table, 'readwrite');
    await tx.store.clear();
    for (const r of rows) tx.store.put(r);
    await tx.done;
  } catch { broken = true; }
}
export async function getMeta<T>(uid: string, key: string): Promise<T | undefined> {
  try { return (await (await openLocal(uid)).get('meta', key)) as T | undefined; } catch { broken = true; return undefined; }
}
export async function setMeta(uid: string, key: string, value: unknown) {
  try { await (await openLocal(uid)).put('meta', value, key); } catch { broken = true; }
}

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
}
export async function outboxAll(uid: string): Promise<OutboxEntry[]> {
  try { return (await (await openLocal(uid)).getAll('outbox')) as OutboxEntry[]; } catch { broken = true; return []; }
}
export async function outboxAdd(uid: string, e: OutboxEntry): Promise<number> {
  const db = await openLocal(uid);
  return (await db.add('outbox', e)) as number;
}
export async function outboxPut(uid: string, e: OutboxEntry) {
  try { await (await openLocal(uid)).put('outbox', e); } catch { broken = true; }
}
export async function outboxDelete(uid: string, seq: number) {
  try { await (await openLocal(uid)).delete('outbox', seq); } catch { broken = true; }
}
