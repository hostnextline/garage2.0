/* A screen that waits for an operation kept on the phone (the customer's text after a move made with no signal):
   onConfirmed / onRefused of the sender, which `whenDone` of sync.ts wraps in one promise. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Engine, type EngineOptions } from './engine';
import { FakeServer, clientFor } from './testkit';
import { setNet } from './net';

let srv: FakeServer;
const engines: Engine[] = [];
let n = 0;
const nextUid = () => `00000000-0000-4000-8000-${String(900000 + ++n).padStart(12, '0')}`;

async function boot(uid: string, o: Partial<EngineOptions> = {}): Promise<Engine> {
  const e = new Engine(clientFor(srv, uid), uid, { realtime: false, requireSession: true, storage: 'idb', locks: null, notify: () => undefined, sent: () => undefined, narrow: () => false, guard: () => undefined, retryDelays: [20, 40], ...o });
  engines.push(e);
  await e.start();
  return e;
}
/** queues one move with no signal and returns the promise a waiting screen holds, as whenDone builds it (inside an
    object: an async function that returned the promise itself would wait for it) */
async function queuedMove(e: Engine): Promise<{ done: Promise<unknown> }> {
  srv.offline = true;
  setNet({ online: false });
  const r = await e.send.callRpc('move_job', { p_job: 'j1', p_day: '2026-11-20', p_block: 'am', p_truck: null });
  expect(r.queued).toBe(true);
  const op = e.outbox.items.map((i) => i.e).find((x) => x.rpc === 'move_job')!.op;
  return { done: new Promise((resolve, reject) => { e.send.onConfirmed(op, resolve); e.send.onRefused(op, reject); }) };
}

beforeEach(() => {
  srv = new FakeServer();
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

describe('waiting for an operation kept on the phone', () => {
  it('is answered with the server\'s answer once the operation is confirmed', async () => {
    const e = await boot(nextUid());
    srv.rpc('move_job', () => ({ ok: true, changed: true }));
    const { done } = await queuedMove(e);
    srv.offline = false;
    await e.send.flush();
    await expect(done).resolves.toMatchObject({ ok: true, changed: true });
  });

  it('is rejected with the reason when the operation is refused', async () => {
    const e = await boot(nextUid());
    srv.rpc('move_job', () => { throw Object.assign(new Error('Ce bloc est complet.'), { code: 'block_full' }); });
    const { done } = await queuedMove(e);
    srv.offline = false;
    await e.send.flush();
    await expect(done).rejects.toMatchObject({ kind: 'refusal' });
  });
});
