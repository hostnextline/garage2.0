/* Part 30 « Réserver à l'heure choisie »: what the app sends (book_job's arrive_at / late_ok; book_preview) and how it reads
   the answers, through the real façade and engine against the pretend server. The server's names live in bookAt.ts. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, syncOptions } from './sync';
import { setNet } from './net';
import { bookJob } from './api';
import { bookAtAnswer, bookAtJob, bookPreview } from './bookAt';
import { getRow } from './store';

let srv: FakeServer;
let n = 0;
const nextUid = () => `00000000-0000-4000-b300-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
async function start() { const uid = nextUid(); await startSync(clientFor(srv, uid), uid); await until(() => net.value.ready); }
beforeEach(() => {
  srv = new FakeServer();
  syncOptions.realtime = false;
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => stopSync());

const JOB = { id: 'N', customer_id: 'c1', day: '2026-11-26', block: 'day' as const, duration_min: 60, win_start: 780, force: true, win_flex: false };

describe('the booking at a minute (the names of 20261122000300)', () => {
  it('bookAtJob: the minute, the vehicle and the ones accepted; never « force » nor « flexible »', () => {
    const j = bookAtJob(JOB, 840, 'T1', ['D']);
    expect(j).toMatchObject({ arrive_at: 840, truck_id: 'T1', late_ok: ['D'], day: '2026-11-26', block: 'day', win_start: 780 });
    expect('force' in j).toBe(false);
    expect('win_flex' in j).toBe(false);
  });
  it('the answer: every key with its type; blocks mode (« not exact ») and garbage are no answer', () => {
    const a = bookAtAnswer({ ok: true, exact: true, at: 840, truck_id: 'T1', forced: true, may_force: false, win_start: 780, win_end: 1020, over_hours: 5,
      stops: [{ id: 'D', eta_before: 700, eta_after: 830, win_start: 540, win_end: 780, late: true, late_min: 50, delay_min: 130 }], earliest: 840, earliest_keep: null });
    expect(a).toMatchObject({ exact: true, truckId: 'T1', forced: true, mayForce: false, winStart: 780, winEnd: 1020, at: 840, overHours: 5 });
    expect(a!.stops[0]).toMatchObject({ id: 'D', late: true, lateMin: 50, delay: 130 });
    expect(bookAtAnswer({ ok: true, exact: false, stops: [] })).toBeNull();
    expect(bookAtAnswer(null)).toBeNull();
    expect(bookAtAnswer({ ok: false, code: 'arrive_late', exact: true, earliest: 860, stops: [] })).toMatchObject({ refused: 'arrive_late', earliest: 860 });
  });
  it('book_preview: sent now with the job and its lines, never kept, its answer read', async () => {
    const got: Record<string, unknown>[] = [];
    srv.rpc('book_preview', (a) => { got.push(a); return { ok: true, preview: true, exact: true, at: 840, truck_id: 'T1', forced: false, may_force: true, stops: [], over_hours: 0 }; });
    await start();
    const a = await bookPreview(bookAtJob(JOB, 840, null), [{ description: 'Diagnostic' }]);
    expect(got[0]).toMatchObject({ p_job: { arrive_at: 840, truck_id: null, late_ok: [] }, p_items: [{ description: 'Diagnostic' }] });
    expect(got[0].p_op).toBeUndefined();
    expect(a).toMatchObject({ exact: true, truckId: 'T1', mayForce: true });
  });
  it('book_job with a minute is sent straight (never kept on the phone): no signal → it throws, nothing waits', async () => {
    const got: Record<string, unknown>[] = [];
    srv.rpc('book_job', (a) => { got.push(a); return { ok: true, job_id: 'N', exact: true, at: 840, rows: { jobs: [{ id: 'N', customer_id: 'c1', day: '2026-11-26', block: 'day', eta_min: 840, arrive_at: 840, status: 'booked', updated_at: new Date().toISOString() }] } }; });
    await start();
    const r = await bookJob(bookAtJob(JOB, 840, 'T1'), []);
    expect(r.queued).toBe(false);
    expect(got[0]).toMatchObject({ p_job: { id: 'N', arrive_at: 840, truck_id: 'T1' } });
    expect(getRow<{ id: string; eta_min: number }>('jobs', 'N')?.eta_min).toBe(840);
    srv.offline = true;
    await expect(bookJob(bookAtJob({ ...JOB, id: 'M' }, 840, 'T1'), [])).rejects.toBeTruthy();
    expect(net.value.pending).toBe(0);
  });
});
