/* Reading the server: the pull, the visibility check, realtime events, reading one row. Real supabase-js client,
   pretend server (testkit.ts), device copy in fake-indexeddb. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engine, type EngineOptions } from './engine';
import { FakeServer, clientFor, stamp } from './testkit';
import { getRow, baseIds } from './store';
import { net, setNet } from './net';
import { openLocal } from './local';
import { startOf, LAG_MS, LEGACY_LAG_MS } from './pull';
import { readChange } from './realtime';
import { tsMicros } from './clock';
import { today } from '../lib/dates';

let srv: FakeServer;
const engines: Engine[] = [];
let n = 0;
const nextUid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
async function boot(uid: string, o: Partial<EngineOptions> = {}): Promise<Engine> {
  const e = new Engine(clientFor(srv, uid), uid, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined, retryDelays: [20], ...o });
  engines.push(e);
  await e.start();
  await until(() => net.value.ready);
  return e;
}
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
const gets = (t: string) => srv.count((c) => c.method === 'GET' && c.table === t);

beforeEach(() => {
  srv = new FakeServer();
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

describe('the pull', () => {
  it('3 500 rows written in the same instant all arrive, and the pull ends (core-data-12)', async () => {
    const at = stamp();
    for (let i = 0; i < 3500; i++) srv.put('job_items', { id: `i${String(i).padStart(5, '0')}`, job_id: 'j1' }, at);
    await boot(nextUid());
    expect(baseIds('job_items').length).toBe(3500);
    // 1 000 a page: 4 pages of the instant and the empty ends, not an endless loop
    expect(gets('job_items')).toBeLessThan(10);
    expect(net.value.firstPull).toBe('ok');
  });

  it('an idle table costs one request, and nothing is redrawn', async () => {
    srv.put('customers', { id: 'c1', first_name: 'A' });
    const e = await boot(nextUid());
    const before = gets('customers');
    const sig = getRow('customers', 'c1');
    await e.pull('customers');
    expect(gets('customers')).toBe(before + 1);
    expect(getRow('customers', 'c1')).toBe(sig);
  });

  it('a row stamped before the cursor and committed after the pull still arrives (late commit)', async () => {
    const e = await boot(nextUid());
    const early = stamp();
    srv.put('jobs', { id: 'j-after', status: 'booked' });
    await e.pull('jobs');
    // committed now, but stamped before the row we already have
    srv.put('jobs', { id: 'j-late', status: 'booked' }, early);
    await e.pull('jobs');
    expect(getRow('jobs', 'j-late')).toBeTruthy();
  });

  it('the rows and the cursor are kept together: the device copy holds what the cursor says (core-data-22)', async () => {
    const uid = nextUid();
    for (let i = 0; i < 5; i++) srv.put('customers', { id: `c${i}` });
    const e = await boot(uid);
    e.stop();
    const db = openLocal(uid);
    const l = await db.loadAll();
    db.close();
    expect(l.rows.customers.length).toBe(5);
    const cur = l.meta['cur2:customers'] as { at: string; id: string };
    expect(cur.id).toBe('c4');
    expect(l.meta['cursor:customers']).toBe(cur.at);
  });

  it('starts 15 s before the previous pull began; a cursor of the previous version 17 s before itself', () => {
    const at = '2026-11-15T10:00:00.123456+00:00';
    const ms = tsMicros(at) / 1000;
    expect(startOf({}, 'jobs')).toBe('');
    expect(startOf({ 'cursor:jobs': at }, 'jobs')).toBe(new Date(ms - LEGACY_LAG_MS).toISOString());
    expect(startOf({ 'cur2:jobs': { at, id: 'x' } }, 'jobs')).toBe(new Date(ms - LAG_MS).toISOString());
    // long after: from the cursor itself (nothing read twice)
    expect(startOf({ 'cur2:jobs': { at, id: 'x' }, 'pullAt:jobs': ms + 600000 }, 'jobs')).toBe(new Date(ms).toISOString());
  });

  it('a first download that failed says so (core-data-48)', async () => {
    // (supabase-js itself retries a GET answered 503; a 500 is not retried)
    srv.failNext((c) => c.table === 'jobs', 500, { message: 'down' }, 10);
    await boot(nextUid());
    expect(net.value.ready).toBe(true);
    expect(net.value.firstPull).toBe('failed');
  });
});

describe('reading one row (core-data-02)', () => {
  it('a failed read never removes the row: no signal, 503, 401', async () => {
    const uid = nextUid();
    srv.put('jobs', { id: 'j1', status: 'booked' });
    const e = await boot(uid);
    srv.failNext((c) => c.table === 'jobs', 502, { message: 'An invalid response was received from the upstream server' });
    expect(await e.refetch('jobs', 'j1')).toBe('failed');
    srv.failNext((c) => c.table === 'jobs', 500, { code: '57014', message: 'canceling statement due to statement timeout' });
    expect(await e.refetch('jobs', 'j1')).toBe('failed');
    srv.failNext((c) => c.table === 'jobs', 401, { code: 'PGRST301', message: 'JWT expired' });
    expect(await e.refetch('jobs', 'j1')).toBe('failed');
    srv.offline = true;
    expect(await e.refetch('jobs', 'j1')).toBe('failed');
    srv.offline = false;
    expect(getRow('jobs', 'j1')).toBeTruthy();
    e.stop();
    const db = openLocal(uid);
    expect((await db.loadAll()).rows.jobs.length).toBe(1);
    db.close();
  }, 20000);   // supabase-js itself retries a read that got no answer for 7 s
  it('a clean « no such row for you » removes it', async () => {
    srv.put('jobs', { id: 'j2', status: 'booked' });
    const e = await boot(nextUid());
    srv.visible = (_t, r) => r.id !== 'j2';
    expect(await e.refetch('jobs', 'j2')).toBe('gone');
    expect(getRow('jobs', 'j2')).toBeUndefined();
  });
});

describe('what this person still sees', () => {
  it('a job moved onto my truck arrives with its old work lines and texts (core-data-03, x-rights-01)', async () => {
    const me = nextUid();
    srv.put('jobs', { id: 'j1', truck_id: 'truck-A', status: 'booked' });
    srv.put('job_items', { id: 'i1', job_id: 'j1', description: 'Freins' });
    srv.put('messages', { id: 'm1', job_id: 'j1' });
    // the mechanic sees the jobs of truck B and their children
    const mine = (t: string, r: Record<string, unknown>) => {
      const job = srv.table('jobs').find((j) => j.id === (t === 'jobs' ? r.id : r.job_id));
      return !job || job.truck_id === 'truck-B';
    };
    srv.visible = (t, r) => (['jobs', 'job_items', 'messages', 'trips', 'invoices', 'payments'].includes(t) ? mine(t, r) : true);
    const e = await boot(me);
    expect(getRow('jobs', 'j1')).toBeUndefined();
    // the office moves it: only the job row changes
    srv.put('jobs', { id: 'j1', truck_id: 'truck-B' });
    await e.pull('jobs');
    expect(getRow('jobs', 'j1')).toBeTruthy();
    await until(() => !!getRow('job_items', 'i1') && !!getRow('messages', 'm1'));
  });

  it('a right given: rows that never changed are fetched by the visibility check', async () => {
    let agenda = false;
    srv.put('expenses', { id: 'x1', total_cents: 100 });
    srv.visible = (t) => t !== 'expenses' || agenda;
    const e = await boot(nextUid());
    expect(getRow('expenses', 'x1')).toBeUndefined();
    agenda = true;
    await e.reconcile();
    expect(getRow('expenses', 'x1')).toBeTruthy();
  });

  it('an item deleted for good on the server leaves this phone (core-data-14)', async () => {
    srv.put('inventory_items', { id: 'it1', name: 'Filtre X' });
    srv.put('service_parts', { id: 'sp1', item_id: 'it1' });
    const e = await boot(nextUid());
    expect(getRow('inventory_items', 'it1')).toBeTruthy();
    srv.tables.inventory_items = [];
    srv.tables.service_parts = [];
    await e.reconcile();
    expect(getRow('inventory_items', 'it1')).toBeUndefined();
    expect(getRow('service_parts', 'sp1')).toBeUndefined();
  });

  it('past 1 000 visible rows, the check walks the ids in order and drops nothing alive (core-data-13)', async () => {
    srv.cap = 1000;
    for (let i = 0; i < 2300; i++) srv.put('job_items', { id: `i${String(i).padStart(5, '0')}`, job_id: 'j' });
    const e = await boot(nextUid());
    expect(baseIds('job_items').length).toBe(2300);
    // rows rewritten between two pages of the listing (a re-plan): nothing may be skipped
    srv.put('job_items', { id: 'i00010', job_id: 'j' });
    await e.reconcile();
    expect(baseIds('job_items').length).toBe(2300);
  });

  it('a mechanic\'s job moved to another truck leaves his phone at once, with its lines (core-data-15, x-rights-02)', async () => {
    const day = today();
    srv.put('jobs', { id: 'j1', truck_id: 'A', status: 'booked', day });
    srv.put('job_items', { id: 'i1', job_id: 'j1' });
    // the mechanic drives truck A
    srv.visible = (t, r) => (t === 'jobs' ? r.truck_id === 'A' : true);
    const e = await boot(nextUid(), { narrow: () => true });
    expect(getRow('jobs', 'j1')).toBeTruthy();
    srv.put('jobs', { id: 'j1', truck_id: 'B' });
    await e.watchMyJobs(true);
    expect(getRow('jobs', 'j1')).toBeUndefined();
    expect(getRow('job_items', 'i1')).toBeUndefined();
  });

  it('a step refused « pas à toi » brings the job back as the server has it (x-rights-02)', async () => {
    srv.put('jobs', { id: 'j1', truck_id: 'A', status: 'booked' });
    const e = await boot(nextUid());
    srv.visible = (t, r) => !(t === 'jobs' && r.id === 'j1');
    srv.rpc('job_step', () => { throw Object.assign(new Error('Cette job n’est pas à toi.'), { code: 'not_allowed' }); });
    await expect(e.callRpc('job_step', { p_job: 'j1', p_action: 'leave' })).rejects.toBeTruthy();
    await until(() => !getRow('jobs', 'j1'));
  });
});

describe('realtime events are hints', () => {
  it('a DELETE removes the row (core-data-14)', () => {
    expect(readChange({ t: 'inventory_items', type: 'DELETE', row: null, oldId: 'it1' }, undefined)).toEqual({ remove: 'it1' });
  });
  it('an update without a big column it did not change is read again instead (x-contract-04)', () => {
    const held = { id: '1', booking: {}, messages: { fr: {} }, updated_at: 'a' };
    expect(readChange({ t: 'settings', type: 'UPDATE', row: { id: '1', booking: { x: 1 }, updated_at: 'b' }, oldId: null }, held)).toEqual({ refetch: '1' });
    expect(readChange({ t: 'settings', type: 'UPDATE', row: { ...held, updated_at: 'b' }, oldId: null }, held).apply).toBeTruthy();
    expect(readChange({ t: 'jobs', type: 'INSERT', row: { id: 'j' }, oldId: null }, undefined)).toEqual({ apply: { id: 'j' } });
  });
});

describe('operation answers never put an older row back (core-data-21)', () => {
  it('a replayed answer with yesterday\'s copy of a job is ignored', async () => {
    srv.put('jobs', { id: 'j1', status: 'booked' });
    const old = { ...srv.table('jobs')[0] };
    srv.put('jobs', { id: 'j1', status: 'on_site' });
    const e = await boot(nextUid());
    expect(getRow('jobs', 'j1')?.status).toBe('on_site');
    e.applyAnswer({ ok: true, rows: { jobs: [old] } });
    expect(getRow('jobs', 'j1')?.status).toBe('on_site');
  });
});
