/* A real phone that updates: it holds yesterday's IndexedDB (`his-garage-<uid>`, version 3), written by the previous
   version of the app (/Users/hassan/garage2.0-refonte/src/data: local.ts, sync.ts), with operations still waiting in the
   OLD outbox format. The database below is written exactly as that code writes it (raw `idb`, its upgrade, its entries,
   its habit of writing its own unsent changes into the table stores, its `cursor:<table>` strings). Then the new
   engine starts on it: nothing is lost, nothing is sent twice, everything leaves in the order it was made, a change
   the old app had already listed as refused stays listed, and what is left is still readable by the old app. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB } from 'idb';
import { Engine } from './engine';
import { FakeServer, clientFor, stamp } from './testkit';
import { getRow } from './store';
import { net, setNet } from './net';
import { SYNCED } from './schema';

let srv: FakeServer;
const engines: Engine[] = [];
let n = 0;
const nextUid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
async function boot(uid: string): Promise<Engine> {
  const e = new Engine(clientFor(srv, uid), uid, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined, retryDelays: [20, 40] });
  engines.push(e);
  await e.start();
  return e;
}

/** the previous version's openLocal: same name, same version, same upgrade */
const openOld = (uid: string) => openDB(`his-garage-${uid}`, 3, {
  upgrade(db) {
    for (const t of SYNCED) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
  }
});
/** the previous version's OutboxEntry (no v, no sent, no err: those are this version's optional fields) */
interface OldEntry { op: string; kind: 'insert' | 'update' | 'rpc'; table?: string; id?: string; values?: Record<string, unknown>; rpc?: string; args?: Record<string, unknown>; label?: string; at: string; tries: number; state: 'pending' | 'failed'; error?: string }

beforeEach(() => {
  srv = new FakeServer();
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

describe('a phone updated from yesterday\'s app, with changes still waiting', () => {
  it('sends every waiting change once, in order, keeps the refused one listed, and loses nothing', async () => {
    const uid = nextUid();
    const T = stamp();
    // the server as it is this morning
    srv.put('customers', { id: 'c-old', first_name: 'Marie', last_name: 'Roy' }, T);
    srv.put('jobs', { id: 'j1', customer_id: 'c-old', status: 'booked', day: '2026-11-16', notes: null, duration_min: 60 }, T);
    // the operations the server runs: each op id is done once (op_begin), a repeat answers what was done the first time
    const done = new Map<string, unknown>();
    const runs: string[] = [];
    const once = (name: string, fn: (a: Record<string, unknown>) => unknown) => srv.rpc(name, (a) => {
      const op = String(a.p_op);
      if (done.has(op)) return done.get(op);
      runs.push(`${name}:${String(a.p_action ?? '')}`);
      const out = fn(a);
      done.set(op, out);
      return out;
    });
    const STATUS: Record<string, string> = { leave: 'en_route', arrive: 'on_site' };
    once('job_step', (a) => ({ ok: true, rows: { jobs: [srv.put('jobs', { id: String(a.p_job), status: STATUS[String(a.p_action)] })] } }));
    once('payment_add', () => ({ ok: true }));
    // « Je pars » reached the server yesterday, but its answer was lost (the old app counted one more try and kept it)
    done.set('op-leave', { ok: true, rows: { jobs: [srv.put('jobs', { id: 'j1', status: 'en_route' })] } });
    runs.push('job_step:leave');

    // yesterday's phone, as the previous version left it
    const old = await openOld(uid);
    await old.put('customers', { id: 'c-old', first_name: 'Marie', last_name: 'Roy', updated_at: T, created_at: T, deleted_at: null });
    // the old app wrote its own changes into the table stores before they were sent: a new customer (no stamp)…
    await old.put('customers', { id: 'c-new', first_name: 'Paul', last_name: 'Gagnon', lang: 'fr', created_at: '2026-11-15T21:00:00.000Z' });
    // …and the job with the note typed offline (the server's stamp, the phone's note)
    await old.put('jobs', { id: 'j1', customer_id: 'c-old', status: 'booked', day: '2026-11-16', notes: 'Code 4521', duration_min: 60, updated_at: T, created_at: T, deleted_at: null });
    await old.put('meta', T, 'cursor:customers');
    await old.put('meta', T, 'cursor:jobs');
    const at = '2026-11-15T21:00:00.000Z';
    const entries: OldEntry[] = [
      { op: 'op-cust', kind: 'insert', table: 'customers', id: 'c-new', values: { id: 'c-new', first_name: 'Paul', last_name: 'Gagnon', lang: 'fr', created_at: at }, label: 'Fiche client', at, tries: 0, state: 'pending' },
      { op: 'op-note', kind: 'update', table: 'jobs', id: 'j1', values: { notes: 'Code 4521' }, label: 'Changement sur une job', at, tries: 1, state: 'pending' },
      { op: 'op-leave', kind: 'rpc', rpc: 'job_step', args: { p_job: 'j1', p_action: 'leave', p_data: {}, p_op: 'op-leave' }, label: 'Je pars', at, tries: 2, state: 'pending' },
      { op: 'op-pay', kind: 'rpc', rpc: 'payment_add', args: { p_invoice: 'v9', p_amount_cents: 5000, p_method: 'cash', p_op: 'op-pay' }, label: 'Paiement', at, tries: 0, state: 'failed', error: 'Ce paiement dépasse ce qui reste à payer.' },
      { op: 'op-arrive', kind: 'rpc', rpc: 'job_step', args: { p_job: 'j1', p_action: 'arrive', p_data: {}, p_op: 'op-arrive' }, label: 'Je suis arrivé', at, tries: 0, state: 'pending' }
    ];
    // the old outboxAdd: db.add('outbox', e), the key (seq) given by the store
    for (const e of entries) await old.add('outbox', e);
    old.close();

    // the new app starts on it
    const e = await boot(uid);
    // at once, before any answer: the waiting changes are on screen (the note, the new customer)
    expect(getRow('jobs', 'j1')?.notes).toBe('Code 4521');
    expect(getRow('customers', 'c-new')?.first_name).toBe('Paul');
    expect(net.value.pending).toBe(4);
    expect(net.value.failed.map((x) => x.op)).toEqual(['op-pay']);
    await until(() => net.value.pending === 0);

    // in the order they were made, each sent once
    const sent = srv.calls.filter((c) => c.method !== 'GET').map((c) => (c.table.startsWith('rpc/') ? `${c.table}:${String((c.body as { p_action?: string }).p_action ?? '')}` : `${c.method} ${c.table}`));
    expect(sent).toEqual(['POST customers', 'PATCH jobs', 'rpc/job_step:leave', 'rpc/job_step:arrive']);
    // « Je pars » was already done yesterday: the server did it once in all; the refused payment never left
    expect(runs).toEqual(['job_step:leave', 'job_step:arrive']);
    expect(srv.count((c) => c.table === 'rpc/payment_add')).toBe(0);
    // nothing lost: the server has every change
    expect(srv.table('customers').find((r) => r.id === 'c-new')).toMatchObject({ first_name: 'Paul', last_name: 'Gagnon' });
    expect(srv.table('jobs')[0]).toMatchObject({ notes: 'Code 4521', status: 'on_site' });
    // and the screen shows the server's rows
    expect(getRow('jobs', 'j1')).toMatchObject({ notes: 'Code 4521', status: 'on_site' });
    expect(getRow('customers', 'c-new')?.updated_at).toBeTruthy();
    // the refusal the old app listed is still listed, with its words
    expect(net.value.failed.map((x) => [x.op, x.error])).toEqual([['op-pay', 'Ce paiement dépasse ce qui reste à payer.']]);
    e.stop();

    // what is left is still the previous version's database: same version, same stores, an entry it can read
    const back = await openOld(uid);
    expect(back.version).toBe(3);
    expect([...back.objectStoreNames].sort()).toEqual([...SYNCED, 'meta', 'outbox'].sort());
    const left = (await back.getAll('outbox')) as OldEntry[];
    expect(left.map((x) => [x.op, x.kind, x.state, x.error])).toEqual([['op-pay', 'rpc', 'failed', 'Ce paiement dépasse ce qui reste à payer.']]);
    // the old app's cursor is kept in step (it still pulls from it after a rollback)
    expect(typeof (await back.get('meta', 'cursor:jobs'))).toBe('string');
    back.close();

    // a second start (the phone reloads): nothing is sent again
    const before = srv.calls.filter((c) => c.method !== 'GET').length;
    await boot(uid);
    await until(() => net.value.ready);
    expect(srv.calls.filter((c) => c.method !== 'GET').length).toBe(before);
    expect(net.value.failed.length).toBe(1);
  });

  it('a new customer whose insert reached the server yesterday (answer lost) is not made twice, and an edit merged into it arrives', async () => {
    const uid = nextUid();
    // yesterday the insert reached the server, the answer was lost; then the old app merged an edit into that same entry
    srv.put('customers', { id: 'c-lost', first_name: 'Luc', phone: null });
    const old = await openOld(uid);
    await old.put('customers', { id: 'c-lost', first_name: 'Luc', phone: '5145550000' });
    const at = new Date().toISOString();
    await old.add('outbox', { op: 'op-lost', kind: 'insert', table: 'customers', id: 'c-lost', values: { id: 'c-lost', first_name: 'Luc', phone: '5145550000' }, at, tries: 1, state: 'pending' } satisfies OldEntry);
    old.close();
    await boot(uid);
    await until(() => net.value.pending === 0);
    expect(srv.table('customers').length).toBe(1);
    expect(srv.table('customers')[0].phone).toBe('5145550000');
    expect(getRow('customers', 'c-lost')?.phone).toBe('5145550000');
  });

  it('yesterday\'s phone with no signal this morning: the waiting changes stay, on screen and on the phone, until it comes back', async () => {
    const uid = nextUid();
    srv.put('jobs', { id: 'j2', status: 'booked', day: '2026-11-16' });
    srv.rpc('job_step', (a, s) => ({ ok: true, rows: { jobs: [s.put('jobs', { id: String(a.p_job), status: 'en_route' })] } }));
    const old = await openOld(uid);
    await old.put('jobs', { id: 'j2', status: 'booked', day: '2026-11-16', updated_at: stamp() });
    await old.add('outbox', { op: 'op-j2', kind: 'rpc', rpc: 'job_step', args: { p_job: 'j2', p_action: 'leave', p_data: {}, p_op: 'op-j2' }, label: 'Je pars', at: new Date().toISOString(), tries: 3, state: 'pending' } satisfies OldEntry);
    old.close();
    srv.offline = true;
    const e = await boot(uid);
    await until(() => net.value.ready);
    // a kept step of the previous version shows ahead like one of this version
    expect(getRow('jobs', 'j2')?.status).toBe('en_route');
    expect(net.value.pending).toBe(1);
    expect(net.value.failed.length).toBe(0);
    srv.offline = false;
    await e.send.flush();
    await until(() => net.value.pending === 0);
    expect(srv.count((c) => c.table === 'rpc/job_step')).toBe(1);
    expect(srv.table('jobs')[0].status).toBe('en_route');
  });
});
