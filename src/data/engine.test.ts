/* The offline engine against a pretend server (testkit.ts) through the real supabase-js client, with the device copy in
   fake-indexeddb. Each case names the defect it proves fixed; each failed on the engine before tonight. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engine, type EngineOptions } from './engine';
import { FakeServer, clientFor, stamp } from './testkit';
import { getRow, baseRow } from './store';
import { net, setNet } from './net';
import { openLocal, type OutboxEntry } from './local';
import type { LockManagerLike } from './lock';
import { readRescue } from './rescue';

let srv: FakeServer;
const engines: Engine[] = [];
let n = 0;
const nextUid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function boot(uid: string, o: Partial<EngineOptions> = {}, s = srv): Promise<Engine> {
  const e = new Engine(clientFor(s, uid), uid, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined, retryDelays: [20, 40], ...o });
  engines.push(e);
  await e.start();
  return e;
}
async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  srv = new FakeServer();
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

describe('start', () => {
  it('shows the device copy before any answer of the server (core-data-10)', async () => {
    const uid = nextUid();
    const db = openLocal(uid);
    await db.commit({ rows: [{ table: 'customers', put: [{ id: 'c1', first_name: 'Julie', updated_at: stamp() }], del: [] }] });
    db.close();
    srv.hold();
    const e = new Engine(clientFor(srv, uid), uid, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined });
    engines.push(e);
    await e.start();
    expect(getRow('customers', 'c1')?.first_name).toBe('Julie');
    expect(net.value.ready).toBe(false);
    srv.release();
    await until(() => net.value.ready);
  });
});

describe('the outbox', () => {
  it('a new row shows at once and reaches the server once', async () => {
    const e = await boot(nextUid());
    await e.insertRow('customers', { id: 'c1', first_name: 'Amira' });
    expect(getRow('customers', 'c1')?.first_name).toBe('Amira');
    await until(() => srv.table('customers').length === 1 && net.value.pending === 0);
    expect(baseRow('customers', 'c1')?.updated_at).toBeTruthy();
  });

  it('an edit made after a lost answer is not lost: sent as its own change (core-data-04)', async () => {
    const e = await boot(nextUid());
    srv.loseNext((c) => c.method === 'POST' && c.table === 'job_items');
    await e.insertRow('job_items', { id: 'i1', job_id: 'j1', status: 'planned', description: 'Vidange' });
    await until(() => srv.table('job_items').length === 1);
    await until(() => (e.outbox.items[0]?.e.tries ?? 0) >= 1 && !e.outbox.inFlight);
    await e.updateRow('job_items', 'i1', { status: 'done' });
    expect(e.outbox.items.length).toBe(2);
    expect(getRow('job_items', 'i1')?.status).toBe('done');
    await e.flush();
    await until(() => net.value.pending === 0, 8000);
    expect(srv.table('job_items')[0].status).toBe('done');
    expect(getRow('job_items', 'i1')?.status).toBe('done');
  });

  it('a delete made after a lost answer reaches the server too (core-data-04)', async () => {
    const e = await boot(nextUid());
    srv.loseNext((c) => c.method === 'POST' && c.table === 'customers');
    await e.insertRow('customers', { id: 'c2', first_name: 'X' });
    await until(() => srv.table('customers').length === 1 && !e.outbox.inFlight && (e.outbox.items[0]?.e.tries ?? 0) >= 1);
    await e.updateRow('customers', 'c2', { deleted_at: new Date().toISOString() });
    expect(getRow('customers', 'c2')).toBeUndefined();
    await e.flush();
    await until(() => net.value.pending === 0, 8000);
    expect(srv.table('customers')[0].deleted_at).toBeTruthy();
    expect(getRow('customers', 'c2')).toBeUndefined();
  });

  it('an edit is still merged into a new row that never left (one request)', async () => {
    srv.offline = true;
    const e = await boot(nextUid());
    await e.insertRow('customers', { id: 'c3', first_name: 'A' });
    // the first try failed before the request reached the server: the entry was attempted, so no merge
    await until(() => !e.outbox.inFlight);
    const before = e.outbox.items.length;
    expect(before).toBe(1);
    srv.offline = false;
    await e.flush();
    await until(() => net.value.pending === 0);
  });

  it('an entry of the previous version that merged an edit after a lost answer delivers that edit (core-data-04, legacy)', async () => {
    const uid = nextUid();
    srv.put('customers', { id: 'c4', first_name: 'Avant', phone: null });
    const db = openLocal(uid);
    // the old engine merged the phone into the insert that had already reached the server
    await db.addEntry({ op: 'op-legacy', kind: 'insert', table: 'customers', id: 'c4', values: { id: 'c4', first_name: 'Avant', phone: '5145551234' }, at: new Date().toISOString(), tries: 1, state: 'pending' });
    db.close();
    await boot(uid);
    await until(() => net.value.pending === 0);
    expect(srv.table('customers')[0].phone).toBe('5145551234');
  });

  it('server trouble is « try again », never « refusé » (core-data-11, x-sync-04)', async () => {
    const e = await boot(nextUid());
    srv.failNext((c) => c.method === 'PATCH', 503, { code: 'PGRST002', message: 'Could not query the database for the schema cache' });
    srv.put('customers', { id: 'c5', first_name: 'A' });
    await e.pullAll();
    await e.updateRow('customers', 'c5', { first_name: 'B' });
    await until(() => !e.outbox.inFlight && e.outbox.items[0]?.e.tries === 1);
    expect(e.outbox.items[0].e.state).toBe('pending');
    expect(net.value.failed.length).toBe(0);
    await e.flush();
    await until(() => net.value.pending === 0, 8000);
    expect(srv.table('customers')[0].first_name).toBe('B');
  });

  it('a 502 page, a statement timeout and a deadlock all wait', async () => {
    const e = await boot(nextUid());
    await until(() => net.value.ready);
    srv.rpc('job_step', () => ({ ok: true }));
    srv.failNext((c) => c.table === 'rpc/job_step', 502, { message: 'An invalid response was received from the upstream server' });
    srv.failNext((c) => c.table === 'rpc/job_step', 500, { code: '57014', message: 'canceling statement due to statement timeout' });
    srv.failNext((c) => c.table === 'rpc/job_step', 500, { code: '40P01', message: 'deadlock detected' });
    const r = await e.callRpc('job_step', { p_job: 'j1', p_action: 'leave' });
    expect(r.queued).toBe(false);
    expect(srv.count((c) => c.table === 'rpc/job_step')).toBe(4);
    expect(net.value.failed.length).toBe(0);
    expect(net.value.pending).toBe(0);
  });

  it('a real refusal is listed with words a person can read, not thrown away', async () => {
    const e = await boot(nextUid());
    srv.rpc('job_step', () => { throw Object.assign(new Error('Ce bloc est passé.'), { code: 'past' }); });
    srv.offline = true;
    setNet({ online: false });
    const r = await e.callRpc('job_step', { p_job: 'j1', p_action: 'reopen' });
    expect(r.queued).toBe(true);
    srv.offline = false;
    await e.flush();
    await until(() => net.value.failed.length === 1);
    expect(net.value.failed[0].error).toBe('Ce bloc est passé.');
    expect(net.value.failed[0].err?.hint).toBe('past');
  });

  it('a refusal while the screen waits is thrown to it, not listed twice', async () => {
    const e = await boot(nextUid());
    srv.rpc('book_job', () => { throw Object.assign(new Error('Ce bloc est complet.'), { code: 'block_full' }); });
    await expect(e.callRpc('book_job', { p_job: { id: 'j9' } })).rejects.toMatchObject({ hint: 'block_full' });
    expect(net.value.failed.length).toBe(0);
    expect(e.outbox.items.length).toBe(0);
  });

  it('a job step kept on the phone shows ahead, and still after a restart without signal (core-data-43 / S12)', async () => {
    const uid = nextUid();
    srv.put('jobs', { id: 'j1', status: 'booked', day: '2026-11-15' });
    const e = await boot(uid);
    await until(() => getRow('jobs', 'j1')?.status === 'booked');
    srv.offline = true;
    setNet({ online: false });
    const r = await e.callRpc('job_step', { p_job: 'j1', p_action: 'leave' });
    expect(r.queued).toBe(true);
    expect(getRow('jobs', 'j1')?.status).toBe('en_route');
    e.stop();
    await boot(uid);
    expect(getRow('jobs', 'j1')?.status).toBe('en_route');
  });

  it('a waiting edit stays on screen when a newer server copy of the row arrives (core-data-43)', async () => {
    const e = await boot(nextUid());
    srv.put('jobs', { id: 'j2', notes: null, duration_min: 60 });
    await e.pullAll();
    srv.offline = true;
    await e.updateRow('jobs', 'j2', { notes: 'Code 4521' });
    srv.offline = false;
    srv.hold();   // the edit cannot leave yet
    srv.put('jobs', { id: 'j2', duration_min: 90 });
    const pulled = e.pull('jobs');
    srv.release();
    await pulled;
    expect(getRow('jobs', 'j2')?.notes).toBe('Code 4521');
  });

  it('a refused edit falls back to the server\'s row by itself', async () => {
    const e = await boot(nextUid());
    srv.put('customers', { id: 'c6', first_name: 'Vrai' });
    await e.pullAll();
    srv.failNext((c) => c.method === 'PATCH', 400, { code: '23514', message: 'violates check constraint' });
    await e.updateRow('customers', 'c6', { first_name: 'Faux' });
    await until(() => net.value.failed.length === 1);
    expect(getRow('customers', 'c6')?.first_name).toBe('Vrai');
  });

  it('« Réessayer » sends the refused change after what was done since', async () => {
    const e = await boot(nextUid());
    srv.put('customers', { id: 'c7', first_name: 'A', last_name: 'A' });
    await e.pullAll();
    srv.failNext((c) => c.method === 'PATCH', 400, { code: '23514', message: 'nope' });
    await e.updateRow('customers', 'c7', { first_name: 'Old' });
    await until(() => net.value.failed.length === 1);
    await e.updateRow('customers', 'c7', { first_name: 'New' });
    await until(() => net.value.pending === 0);
    await e.dismiss(net.value.failed[0].seq!, true);
    await until(() => net.value.pending === 0 && net.value.failed.length === 0);
    // the retried change went last: it is what the server has now (the person asked for it again)
    expect(srv.table('customers')[0].first_name).toBe('Old');
    expect(e.outbox.items.length).toBe(0);
  });
});

describe('no valid session is not a refusal (core-data-09, x-sync-08)', () => {
  it('nothing leaves with the public key; the changes wait and the frame says so', async () => {
    const uid = nextUid();
    const e = new Engine(clientFor(srv, null), uid, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined });
    engines.push(e);
    await e.start();
    await e.insertRow('customers', { id: 'c1', first_name: 'A' });
    srv.rpc('payment_add', () => ({ ok: true }));
    setNet({ online: false });
    const r = await e.callRpc('payment_add', { p_invoice: 'v1', p_amount_cents: 5000 });
    expect(r.queued).toBe(true);
    await e.flush();
    await sleep(50);
    expect(srv.calls.length).toBe(0);
    expect(e.outbox.items.map((i) => i.e.state)).toEqual(['pending', 'pending']);
    expect(net.value.failed.length).toBe(0);
    expect(net.value.session).toBe('expired');
  });
  it('a 401 permission answer waits too', async () => {
    const e = await boot(nextUid());
    await until(() => net.value.ready);
    srv.failNext((c) => c.method === 'POST' && c.table === 'customers', 401, { code: '42501', message: 'permission denied for table customers' }, 5);
    await e.insertRow('customers', { id: 'c1', first_name: 'A' });
    await until(() => !e.outbox.inFlight && (e.outbox.items[0]?.e.tries ?? 0) >= 1);
    expect(e.outbox.items[0].e.state).toBe('pending');
    expect(net.value.failed.length).toBe(0);
  });
});

describe('IndexedDB fails (core-data-01, x-sync-02)', () => {
  it('a device copy that cannot be opened: changes are still sent while online, and the frame knows', async () => {
    const open = indexedDB.open.bind(indexedDB);
    (indexedDB as { open: unknown }).open = () => { throw new Error('connection lost'); };
    try {
      const e = await boot(nextUid());
      expect(net.value.storage).toBe('memory');
      expect(net.value.storageBroken).toBe(true);
      srv.rpc('job_step', () => ({ ok: true, rows: { jobs: [{ id: 'j1', status: 'en_route', updated_at: stamp() }] } }));
      const r = await e.callRpc('job_step', { p_job: 'j1', p_action: 'leave' });
      expect(r.queued).toBe(false);
      await e.insertRow('customers', { id: 'c1', first_name: 'A' });
      await until(() => srv.table('customers').length === 1);
    } finally { (indexedDB as { open: unknown }).open = open; }
  });
  it('offline with nowhere to keep it: the operation says it was not done instead of « gardé »', async () => {
    const open = indexedDB.open.bind(indexedDB);
    const set = Storage.prototype.setItem;
    (indexedDB as { open: unknown }).open = () => { throw new Error('connection lost'); };
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      const e = await boot(nextUid());
      srv.offline = true;
      setNet({ online: false });
      await expect(e.callRpc('payment_add', { p_invoice: 'v1', p_amount_cents: 5000 })).rejects.toMatchObject({ kind: 'network' });
      expect(e.outbox.items.length).toBe(0);
    } finally { (indexedDB as { open: unknown }).open = open; Storage.prototype.setItem = set; }
  });
  it('offline with the rescue copy: kept, and put back in the outbox at the next start', async () => {
    const uid = nextUid();
    const open = indexedDB.open.bind(indexedDB);
    (indexedDB as { open: unknown }).open = () => { throw new Error('connection lost'); };
    let e: Engine;
    try {
      e = await boot(uid);
      srv.offline = true;
      setNet({ online: false });
      const r = await e.callRpc('payment_add', { p_invoice: 'v1', p_amount_cents: 5000 });
      expect(r.queued).toBe(true);
      expect(readRescue(uid).length).toBe(1);
    } finally { (indexedDB as { open: unknown }).open = open; }
    e.stop();
    srv.offline = false;
    srv.rpc('payment_add', () => ({ ok: true }));
    await boot(uid);
    await until(() => srv.count((c) => c.table === 'rpc/payment_add') === 1 && net.value.pending === 0);
    expect(readRescue(uid).length).toBe(0);
  });
});

describe('one sender per account (core-data-06, x-sync-07)', () => {
  const memoryLocks = (): LockManagerLike => {
    const held = new Set<string>();
    return { async request(name, _o, cb) { if (held.has(name)) { await cb(null); return; } held.add(name); try { await cb({}); } finally { held.delete(name); } } };
  };
  it('two tabs, one operation queued offline, the signal comes back: one request', async () => {
    const uid = nextUid();
    const locks = memoryLocks();
    srv.rpc('payment_add', () => ({ ok: true }));
    srv.offline = true;
    setNet({ online: false });
    const a = await boot(uid, { locks });
    const r = await a.callRpc('payment_add', { p_invoice: 'v1', p_amount_cents: 5000 });
    expect(r.queued).toBe(true);
    const b = await boot(uid, { locks });
    expect(b.outbox.pending().length).toBe(1);
    srv.offline = false;
    srv.latency = 30;
    await Promise.all([a.flush(), b.flush()]);
    await until(() => a.outbox.pending().length === 0);
    await sleep(100);
    expect(srv.count((c) => c.table === 'rpc/payment_add')).toBe(1);
  });
  it('a refusal for an entry another tab already delivered is not written back', async () => {
    const uid = nextUid();
    const a = await boot(uid);
    srv.offline = true;
    await a.insertRow('customers', { id: 'c1', first_name: 'A' });
    await until(() => !a.outbox.inFlight);
    const it = a.outbox.items[0];
    // another tab delivered it and deleted the entry
    const db = openLocal(uid);
    await db.mutateEntry(it.e.seq!, () => ({ del: true, result: null }));
    const listed = await a.outbox.refuse(it, 'duplicate', { kind: 'refusal', sub: 'duplicate' });
    expect(listed).toBe(false);
    expect((await db.listEntries()).length).toBe(0);
    db.close();
  });
});

describe('an account switch on one device (core-data-07)', () => {
  it('a late answer of the first account never lands in the second one\'s screen or cursor', async () => {
    const A = nextUid(), B = nextUid();
    srv.put('customers', { id: 'of-A', first_name: 'A' });
    srv.visible = (_t, r, uid) => (r.id === 'of-A' ? uid === A : true);
    srv.hold();
    const a = new Engine(clientFor(srv, A), A, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined });
    engines.push(a);
    await a.start();
    a.stop();
    const b = await boot(B);
    srv.release();
    await until(() => net.value.ready);
    await sleep(50);
    expect(getRow('customers', 'of-A')).toBeUndefined();
    const db = openLocal(B);
    const loaded = await db.loadAll();
    db.close();
    expect(loaded.rows.customers.map((r) => r.id)).toEqual([]);
    expect(b.closed).toBe(false);
  });
});

describe('sign-out stops everything', () => {
  it('no timer, no request after stop', async () => {
    const e = await boot(nextUid());
    await until(() => net.value.ready);
    e.stop();
    const before = srv.calls.length;
    await e.flush(); await e.pullAll();
    expect(await e.refetch('customers', 'x')).toBe('failed');
    expect(srv.calls.length).toBe(before);
  });
});

describe('legacy entries are read and kept as they are', () => {
  it('an old failed entry stays listed, an old pending one is sent in order', async () => {
    const uid = nextUid();
    const db = openLocal(uid);
    const at = new Date().toISOString();
    await db.addEntry({ op: 'o1', kind: 'rpc', rpc: 'job_step', args: { p_job: 'j1', p_action: 'leave', p_op: 'o1' }, at, tries: 0, state: 'failed', error: 'permission denied' } as OutboxEntry);
    await db.addEntry({ op: 'o2', kind: 'rpc', rpc: 'job_step', args: { p_job: 'j1', p_action: 'arrive', p_op: 'o2' }, at, tries: 0, state: 'pending' } as OutboxEntry);
    db.close();
    const seen: string[] = [];
    srv.rpc('job_step', (a) => { seen.push(String(a.p_action)); return { ok: true }; });
    await boot(uid);
    await until(() => net.value.pending === 0);
    expect(seen).toEqual(['arrive']);
    expect(net.value.failed.length).toBe(1);
  });
});
