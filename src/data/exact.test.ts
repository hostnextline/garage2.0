/* « exact move » (STATE.md S2 to S5, A4): what the app sends and how it reads the answers, through the real façade and
   engine against the pretend server. The server's names live in exact.ts only. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, syncOptions } from './sync';
import { setNet } from './net';
import { moveJob } from './api';
import { exactPreview, exactAnswer, exactRefusal } from './exact';
import { getRow } from './store';

let srv: FakeServer;
let n = 0;
const nextUid = () => `00000000-0000-4000-b100-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
async function start() {
  const uid = nextUid();
  await startSync(clientFor(srv, uid), uid);
  await until(() => net.value.ready);
}
beforeEach(() => {
  srv = new FakeServer();
  syncOptions.realtime = false;
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
});
afterEach(() => stopSync());

const STOP = { id: 'j2', day: '2026-11-26', truck_id: 't1', order_before: 2, order_after: 3, eta_before: 600, eta_after: 640, win_start: 540, win_end: 600, delay_min: 40, late: true, late_min: 40, measured: true };

describe('the move to a minute pointed (S2, A4)', () => {
  it('sends move_job’s 8th argument p_exact = { at, late_ok } with the window of that minute, never kept on the phone', async () => {
    const got: Record<string, unknown>[] = [];
    srv.rpc('move_job', (a) => { got.push(a); return { ok: true, exact: true, stops: [] }; });
    await start();
    await moveJob('j1', '2026-11-26', 'day', 't1', { start: 720, flex: false, at: 780, lateOk: ['j2'] });
    expect(got[0]).toMatchObject({ p_job: 'j1', p_day: '2026-11-26', p_block: 'day', p_truck: 't1', p_win_start: 720, p_win_flex: false, p_exact: { at: 780, late_ok: ['j2'] } });
    expect(typeof got[0].p_op).toBe('string');
    // no signal: said at once, nothing kept for later (a pointed minute is never queued)
    srv.offline = true;
    setNet({ online: false });
    await expect(moveJob('j1', '2026-11-26', 'day', null, { start: 720, at: 780 })).rejects.toMatchObject({ kind: 'network' });
    expect(net.value.pending).toBe(0);
    // a move that points no time is kept as today
    expect((await moveJob('j1', '2026-11-26', 'day', null, { start: 720 })).queued).toBe(true);
    expect(net.value.pending).toBe(1);
  });
  it('a move without a minute sends the 7 arguments of before, no p_exact (the old call unchanged)', async () => {
    const got: Record<string, unknown>[] = [];
    srv.rpc('move_job', (a) => { got.push(a); return { ok: true }; });
    await start();
    await moveJob('j1', '2026-11-26', 'day', null, { start: 720 });
    await moveJob('j1', '2026-11-26', 'am', null);
    expect('p_exact' in got[0]).toBe(false);
    expect(Object.keys(got[1]).sort()).toEqual(['p_block', 'p_day', 'p_job', 'p_op', 'p_truck']);
  });
});

describe('the preview of that move (S3, S5)', () => {
  it('asks move_preview(p_job, p_day, p_truck, p_at) and reads every key of the answer', async () => {
    const got: Record<string, unknown>[] = [];
    srv.rpc('move_preview', (a) => { got.push(a); return { exact: true, stops: [STOP, { id: 'j1', eta_before: 900, eta_after: 780, delay_min: 0, late: false, measured: null }], over_hours: 0, earliest: 700, earliest_keep: 760 }; });
    await start();
    const a = await exactPreview('j1', '2026-11-26', null, 780);
    expect(got[0]).toEqual({ p_job: 'j1', p_day: '2026-11-26', p_truck: null, p_at: 780 });
    expect(a).toEqual({
      exact: true, overHours: 0, earliest: 700, earliestKeep: 760, refused: null,
      stops: [
        { id: 'j2', day: '2026-11-26', truckId: 't1', orderBefore: 2, orderAfter: 3, etaBefore: 600, etaAfter: 640, winStart: 540, winEnd: 600, delay: 40, late: true, lateMin: 40, measured: true },
        { id: 'j1', day: null, truckId: null, orderBefore: null, orderAfter: null, etaBefore: 900, etaAfter: 780, winStart: null, winEnd: null, delay: 0, late: false, lateMin: 0, measured: null }
      ]
    });
  });
  it('the trial’s rows a preview answers (made inside a block the server undoes) never land on the phone (review F0)', async () => {
    const was = { id: 'j1', customer_id: 'c1', day: '2030-01-10', block: 'day', status: 'booked', truck_id: 't1', eta_min: 600, win_start: 540, win_end: 780, stop_order: 1 };
    srv.put('jobs', was, '2026-11-20T10:00:00.000Z');
    srv.put('jobs', { id: 'j2', customer_id: 'c2', day: '2030-01-10', block: 'day', status: 'booked', truck_id: 't2', eta_min: 800, win_start: 720, win_end: 960, stop_order: 1 }, '2026-11-20T10:00:00.000Z');
    // exact_place's answer, word for word: the job at 13 h 15 on the truck tried, another stop pushed, newer updated_at
    const later = '2026-11-21T20:30:00.000Z';
    srv.rpc('move_preview', () => ({ ok: true, job_id: 'j1', changed: true, tell: true, exact: true, at: 795, stops: [{ ...STOP, id: 'j2' }], over_hours: 0, earliest: null, earliest_keep: null,
      rows: { jobs: [{ ...was, truck_id: 't2', eta_min: 795, win_start: 720, win_end: 960, arrive_at: 795, updated_at: later },
        { id: 'j2', customer_id: 'c2', day: '2030-01-10', block: 'day', status: 'booked', truck_id: 't2', eta_min: 860, win_start: 720, win_end: 960, stop_order: 2, updated_at: later }] } }));
    await start();
    expect(getRow('jobs', 'j1')).toMatchObject({ truck_id: 't1', eta_min: 600 });
    const a = await exactPreview('j1', '2030-01-10', 't2', 795);
    expect(a?.exact).toBe(true);
    expect(a?.stops.map((s) => s.id)).toEqual(['j2']);
    // the phone still holds what the server holds: nothing moved, nothing pushed
    expect(getRow('jobs', 'j1')).toMatchObject({ truck_id: 't1', eta_min: 600, win_start: 540 });
    expect((getRow('jobs', 'j1') as { arrive_at?: unknown }).arrive_at ?? null).toBe(null);
    expect(getRow('jobs', 'j2')).toMatchObject({ eta_min: 800, stop_order: 1 });
  });
  it('a refusal answered or thrown: its code, and the earliest minute when the server gives it', async () => {
    expect(exactAnswer({ ok: false, code: 'arrive_late', earliest: 622, earliest_keep: 700 })).toMatchObject({ refused: 'arrive_late', earliest: 622, earliestKeep: 700, stops: [] });
    expect(exactAnswer({ refused: 'pick_truck' })?.refused).toBe('pick_truck');
    expect(exactRefusal({ code: 'P0001', hint: 'arrive_late', message: 'Le camion…', details: '{"earliest": 622, "earliest_keep": 700}' })).toEqual({ code: 'arrive_late', earliest: 622, earliestKeep: 700 });
    expect(exactRefusal({ code: 'P0001', hint: 'late_changed', message: '…', details: null })).toEqual({ code: 'late_changed', earliest: null, earliestKeep: null });
    expect(exactRefusal({ code: 'timeout' })).toBe(null);
    srv.rpc('move_preview', () => { throw { code: 'arrive_late', message: 'Le camion ne peut pas être là.' }; });
    await start();
    const e = await exactPreview('j1', '2026-11-26', null, 780).catch((x: unknown) => x);
    expect(exactRefusal(e)?.code).toBe('arrive_late');
  });
  it('an older server’s answer (the preview of before, an empty one) is no exact answer', () => {
    expect(exactAnswer({ order: ['j1'], eta: { j1: 600 }, refused: [], day_min: 30, day_km: null, unmeasured: null })).toBe(null);
    expect(exactAnswer(null)).toBe(null);
    expect(exactAnswer([])).toBe(null);
    // a stop without its delay: worked out from its two arrivals (never negative)
    expect(exactAnswer({ exact: true, stops: [{ id: 'x', eta_before: 600, eta_after: 590, win_end: 580 }] })?.stops[0]).toMatchObject({ delay: 0, lateMin: 10 });
  });
});
