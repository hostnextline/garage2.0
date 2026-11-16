import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { openLocal, type OutboxEntry } from './local';
import { SYNCED } from './schema';

let n = 0;
const uid = () => `local-${++n}-${Math.random().toString(36).slice(2)}`;
const entry = (p: Partial<OutboxEntry> = {}): OutboxEntry => ({ op: `op-${Math.random()}`, kind: 'rpc', rpc: 'job_step', args: {}, at: new Date().toISOString(), tries: 0, state: 'pending', ...p });

describe('the device copy (IndexedDB his-garage-<uid>, version 3)', () => {
  it('opens a database written by the previous version without changing its layout, and reads its outbox', async () => {
    const u = uid();
    // the layout as the previous version made it
    const old = await openDB(`his-garage-${u}`, 3, { upgrade(db) {
      for (const t of SYNCED) db.createObjectStore(t, { keyPath: 'id' });
      db.createObjectStore('meta');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    } });
    await old.add('outbox', { op: 'legacy', kind: 'insert', table: 'customers', id: 'c', values: { id: 'c' }, at: 'x', tries: 1, state: 'pending' });
    await old.put('meta', '2026-11-15T10:00:00Z', 'cursor:jobs');
    old.close();
    const db = openLocal(u);
    const l = await db.loadAll();
    expect(l.outbox.map((e) => e.op)).toEqual(['legacy']);
    expect(l.meta['cursor:jobs']).toBe('2026-11-15T10:00:00Z');
    db.close();
    const again = await openDB(`his-garage-${u}`, 3);
    expect([...again.objectStoreNames].sort()).toEqual([...SYNCED, 'meta', 'outbox'].sort());
    again.close();
  });

  it('rows and cursor in ONE transaction: a page that fails leaves the cursor where it was (core-data-22)', async () => {
    const db = openLocal(uid());
    await db.commit({ rows: [{ table: 'jobs', put: [{ id: 'a' }], del: [] }], meta: { 'cursor:jobs': 'T1' } });
    // a row without its key makes the whole transaction fail
    await expect(db.commit({ rows: [{ table: 'jobs', put: [{ id: 'b' }, { nope: 1 } as never], del: [] }], meta: { 'cursor:jobs': 'T2' } })).rejects.toBeTruthy();
    const l = await db.loadAll();
    expect(l.rows.jobs.map((r) => r.id)).toEqual(['a']);
    expect(l.meta['cursor:jobs']).toBe('T1');
    db.close();
  });

  it('entries keep the order of the calls, even without waiting between them', async () => {
    const db = openLocal(uid());
    const ops = ['1', '2', '3', '4'];
    await Promise.all(ops.map((op) => db.addEntry(entry({ op }))));
    expect((await db.listEntries()).map((e) => e.op)).toEqual(ops);
    db.close();
  });

  it('a change of an entry is checked and written in one transaction: an entry already gone is never written back', async () => {
    const db = openLocal(uid());
    const seq = await db.addEntry(entry({ op: 'x' }));
    await db.mutateEntry(seq, () => ({ del: true, result: null }));
    const r = await db.mutateEntry(seq, (cur) => (cur ? { put: { ...cur, state: 'failed' }, result: true } : { result: false }));
    expect(r.result).toBe(false);
    expect(await db.listEntries()).toEqual([]);
    db.close();
  });

  it('taken out and put back at the end in one transaction (« Réessayer »)', async () => {
    const db = openLocal(uid());
    const a = await db.addEntry(entry({ op: 'a', state: 'failed' }));
    await db.addEntry(entry({ op: 'b' }));
    const { added } = await db.mutateEntry(a, (cur) => ({ del: true, add: { ...cur!, state: 'pending' }, result: null }));
    expect(added).toBeGreaterThan(a);
    expect((await db.listEntries()).map((e) => e.op)).toEqual(['b', 'a']);
    db.close();
  });

  it('wiping the copy never touches the waiting changes', async () => {
    const db = openLocal(uid());
    await db.commit({ rows: [{ table: 'customers', put: [{ id: 'c' }], del: [] }], meta: { 'cursor:customers': 'T' } });
    await db.addEntry(entry({ op: 'keep' }));
    await db.wipeRows();
    const l = await db.loadAll();
    expect(l.rows.customers).toEqual([]);
    expect(l.meta).toEqual({});
    expect(l.outbox.map((e) => e.op)).toEqual(['keep']);
    db.close();
  });

  it('a dropped connection is reopened once (iOS loses it when the app sleeps)', async () => {
    const db = openLocal(uid());
    await db.listEntries();
    // close the connection behind the driver's back
    const raw = await openDB(`his-garage-${'x'}`, 3, { upgrade(d) { d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); } });
    raw.close();
    const proto = IDBDatabase.prototype as unknown as { transaction: (...a: unknown[]) => unknown };
    const real = proto.transaction;
    let fail = 1;
    proto.transaction = function (this: IDBDatabase, ...a: unknown[]) {
      if (fail-- > 0) throw new DOMException('The database connection is closing.', 'InvalidStateError');
      return real.apply(this, a);
    };
    try {
      expect(await db.addEntry(entry({ op: 'after' }))).toBeGreaterThan(0);
    } finally { proto.transaction = real; }
    db.close();
  });
});
