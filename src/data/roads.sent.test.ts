/* « Vraies routes » (CONTRACT §4) through the REAL engine, outbox and sender against the pretend server (testkit.ts),
   only the function « drive » pretended: a booking or a move that reached the server (now, or replayed from the outbox
   later) has its place measured for its day; the switch (owner, live, a new op each tap); the two previews (nothing
   written, the action's refusals, the new keys of 2026-11-20 read when the server sends them). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fn = vi.hoisted(() => ({
  calls: [] as { name: string; body: Record<string, unknown> }[],
  answer: null as null | ((body: Record<string, unknown>) => unknown)
}));
vi.mock('./auth', async (orig) => {
  const real = await orig<typeof import('./auth')>();
  return {
    ...real,
    callFn: async (name: string, body: Record<string, unknown>) => {
      fn.calls.push({ name, body });
      return fn.answer ? fn.answer(body) : { ok: true, ready: true, left: 0, left0: 0, stored: 1, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false };
    }
  };
});
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, flush, syncOptions } from './sync';
import { setNet } from './net';
import { bookJob, moveJob, updateJob, changeJobCustomer, setTruckStart, saveSettings } from './api';
import { resetRoads, roadsSwitch, movePreview, warmRoads, type MovePreview } from './roads';
import { today, addDays } from '../lib/dates';

let srv: FakeServer; let n = 0;
const uid = () => `00000000-0000-4000-b000-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
}
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const warms = () => fn.calls.filter((c) => c.name === 'drive' && c.body.action === 'warm' && c.body.only === 'point');
const rpcCalls = (name: string) => srv.calls.filter((c) => c.table === `rpc/${name}`);
beforeEach(() => {
  srv = new FakeServer(); syncOptions.realtime = false; resetRoads(); fn.calls.length = 0; fn.answer = null;
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
  srv.rpc('book_job', (a) => ({ ok: true, job_id: (a.p_job as { id: string }).id, truck_id: null }));
  srv.rpc('move_job', () => ({ ok: true, changed: true }));
  srv.rpc('job_customer', () => ({ ok: true, vehicle_id: null }));
});
afterEach(() => stopSync());
async function start(roadsOn: boolean) {
  srv.put('settings', { id: '1', booking: { roads_on: roadsOn } });
  const u = uid(); await startSync(clientFor(srv, u), u); await until(() => net.value.ready);
}

describe('a booking or a move that reached the server: its place is measured for its day (in the background)', () => {
  it('a booking kept offline and replayed later: warmed once it reached the server, not before', async () => {
    await start(true);
    srv.offline = true; setNet({ online: false });
    const d = addDays(today(), 3);
    await bookJob({ customer_id: 'c1', day: d, block: 'am', lat: 45.55, lng: -73.6 }, [{ description: 'Vidange' }]);
    expect(warms()).toHaveLength(0);
    srv.offline = false; setNet({ online: true });
    await flush(); await until(() => net.value.pending === 0);
    await until(() => warms().length > 0);
    expect(warms()[0].body).toEqual({ action: 'warm', point: { lat: 45.55, lng: -73.6 }, from: d, days: 1, only: 'point' });
  }, 20000);
  it('a booking with no position of its own takes its customer\'s', async () => {
    srv.put('customers', { id: 'c2', first_name: 'A', last_name: 'B', lat: 45.48, lng: -73.58 });
    await start(true);
    const d = addDays(today(), 2);
    await bookJob({ customer_id: 'c2', day: d, block: 'pm' }, [{ description: 'Freins' }]);
    await until(() => warms().length > 0);
    expect(warms()[0].body).toMatchObject({ point: { lat: 45.48, lng: -73.58 }, from: d, days: 1 });
  });
  it('switch off: a booking, a move, a change of customer and of address send nothing to « drive »', async () => {
    srv.put('jobs', { id: 'j9', customer_id: 'c1', day: addDays(today(), 3), block: 'am', lat: 45.5, lng: -73.6, status: 'booked' });
    srv.put('customers', { id: 'c3', first_name: 'C', last_name: 'D', lat: 45.47, lng: -73.57 });
    await start(false);
    await bookJob({ customer_id: 'c1', day: addDays(today(), 3), block: 'am', lat: 45.55, lng: -73.6 }, [{ description: 'Vidange' }]);
    await moveJob('j9', addDays(today(), 4), 'pm', null, null, { queue: false });
    await moveJob('j9', addDays(today(), 5), 'pm');
    await changeJobCustomer('j9', 'c3');
    await updateJob('j9', { lat: 45.52, lng: -73.62 });
    await flush(); await until(() => net.value.pending === 0);
    await settle();
    expect(fn.calls).toEqual([]);
  });
  it('a move sent straight (queue: false): warmed for the NEW day', async () => {
    srv.put('jobs', { id: 'j9', customer_id: 'c1', day: addDays(today(), 3), block: 'am', lat: 45.51, lng: -73.61, status: 'booked' });
    await start(true);
    await moveJob('j9', addDays(today(), 5), 'pm', null, null, { queue: false });
    await until(() => warms().length > 0);
    expect(warms()[0].body).toMatchObject({ point: { lat: 45.51, lng: -73.61 }, from: addDays(today(), 5), days: 1 });
  });
  it('a move through the outbox: warmed for the new day once sent', async () => {
    srv.put('jobs', { id: 'j8', customer_id: 'c1', day: addDays(today(), 3), block: 'am', lat: 45.53, lng: -73.63, status: 'booked' });
    await start(true);
    await moveJob('j8', addDays(today(), 6), 'am');
    await flush(); await until(() => net.value.pending === 0);
    await until(() => warms().length > 0);
    expect(warms()[0].body).toMatchObject({ point: { lat: 45.53, lng: -73.63 }, from: addDays(today(), 6), days: 1 });
  });
  it('a move refused by the server warms nothing', async () => {
    srv.put('jobs', { id: 'j7', customer_id: 'c1', day: addDays(today(), 3), block: 'am', lat: 45.53, lng: -73.63, status: 'booked' });
    srv.rpc('move_job', () => { throw Object.assign(new Error('Plein.'), { code: 'truck_full' }); });
    await start(true);
    await expect(moveJob('j7', addDays(today(), 6), 'am', 't1', null, { queue: false })).rejects.toMatchObject({ kind: 'refusal', hint: 'truck_full' });
    await settle();
    expect(warms()).toHaveLength(0);
  });
  it('M3: a booking within the minute after a failed warm of that address IS warmed (the failure is not reused)', async () => {
    await start(true);
    fn.answer = () => ({ ok: false, code: 'busy', at: 'drive' });
    expect(await warmRoads({ lat: 45.55, lng: -73.6 }, today(), 14)).toEqual({ ok: false, ready: false });
    expect(warms()).toHaveLength(1);
    fn.answer = null;
    const d = addDays(today(), 2);
    await bookJob({ customer_id: 'c1', day: d, block: 'am', lat: 45.55, lng: -73.6 }, [{ description: 'Vidange' }]);
    await flush(); await until(() => net.value.pending === 0);
    await until(() => warms().length > 1);
    expect(warms()[1].body).toMatchObject({ from: d, days: 1 });
  });
  it('a booking at an address measured a moment ago (ready) is not asked again', async () => {
    await start(true);
    expect(await warmRoads({ lat: 45.55, lng: -73.6 }, today(), 14)).toEqual({ ok: true, ready: true });
    await bookJob({ customer_id: 'c1', day: addDays(today(), 2), block: 'am', lat: 45.55, lng: -73.6 }, [{ description: 'Vidange' }]);
    await flush(); await until(() => net.value.pending === 0);
    await settle();
    expect(warms()).toHaveLength(1);
  });
  it('L4: « Changer de client »: the appointment takes the new customer\'s address, which is measured', async () => {
    srv.put('jobs', { id: 'j6', customer_id: 'c1', day: addDays(today(), 4), block: 'am', lat: 45.51, lng: -73.61, status: 'booked' });
    srv.put('customers', { id: 'c4', first_name: 'E', last_name: 'F', lat: 45.44, lng: -73.66 });
    await start(true);
    await changeJobCustomer('j6', 'c4');
    await until(() => warms().length > 0);
    expect(warms()[0].body).toMatchObject({ point: { lat: 45.44, lng: -73.66 }, from: addDays(today(), 4), days: 1 });
  });
  it('L4: the address of an appointment changed (a new position) is measured once sent; another change is not', async () => {
    srv.put('jobs', { id: 'j5', customer_id: 'c1', day: addDays(today(), 4), block: 'am', lat: 45.51, lng: -73.61, status: 'booked' });
    await start(true);
    await updateJob('j5', { notes: 'Sonner deux fois' });
    await flush(); await until(() => net.value.pending === 0);
    await settle();
    expect(warms()).toHaveLength(0);
    await updateJob('j5', { address: '1 rue Neuve', lat: 45.49, lng: -73.59 });
    await flush(); await until(() => net.value.pending === 0);
    await until(() => warms().length > 0);
    expect(warms()[0].body).toMatchObject({ point: { lat: 45.49, lng: -73.59 }, from: addDays(today(), 4), days: 1 });
  });
  it('a past appointment\'s change is not measured', async () => {
    srv.put('jobs', { id: 'j4', customer_id: 'c1', day: addDays(today(), -2), block: 'am', lat: 45.51, lng: -73.61, status: 'done' });
    await start(true);
    await updateJob('j4', { lat: 45.49, lng: -73.59 });
    await flush(); await until(() => net.value.pending === 0);
    await settle();
    expect(warms()).toHaveLength(0);
  });
});

describe('roadsSwitch (owner): live, never kept for later, a new op each tap', () => {
  it('sends roads_switch { p_on, p_op } now; two taps = two ops; its answer read', async () => {
    srv.rpc('roads_switch', (a) => ({ ok: true, on: a.p_on, planned: 3, kept: [{ day: '2026-12-01', block: 'pm' }], late: ['j1'] }));
    await start(false);
    expect(await roadsSwitch(true)).toEqual({ ok: true, on: true, planned: 3, kept: [{ day: '2026-12-01', block: 'pm' }], late: ['j1'], unchanged: false });
    await roadsSwitch(true);
    const ops = rpcCalls('roads_switch').map((c) => (c.body as { p_op: string }).p_op);
    expect(ops).toHaveLength(2);
    expect(ops[0]).not.toBe(ops[1]);
    expect(rpcCalls('roads_switch').map((c) => (c.body as { p_on: boolean }).p_on)).toEqual([true, true]);
  });
  it('the SAME operation asked again (its first answer was lost): the op given is sent, so the server answers the first one again (fix-settings R6)', async () => {
    const seen = new Map<string, unknown>();
    // the server keeps an op's answer (op_begin / op_save): the same op asked again gets the first answer, list included
    srv.rpc('roads_switch', (a) => {
      const op = String(a.p_op);
      if (!seen.has(op)) seen.set(op, { ok: true, on: a.p_on, planned: 2, kept: [], late: [`late-${seen.size + 1}`] });
      return seen.get(op);
    });
    await start(false);
    const first = await roadsSwitch(true, '00000000-0000-4000-a000-0000000000aa');
    const again = await roadsSwitch(true, '00000000-0000-4000-a000-0000000000aa');
    expect(rpcCalls('roads_switch').map((c) => (c.body as { p_op: string }).p_op)).toEqual(['00000000-0000-4000-a000-0000000000aa', '00000000-0000-4000-a000-0000000000aa']);
    expect(again).toEqual(first);
    expect(again.late).toEqual(['late-1']);
    expect(net.value.pending).toBe(0);
  });
  it('a refusal (roads_cold) is thrown with its code', async () => {
    srv.rpc('roads_switch', () => { throw Object.assign(new Error('Il reste 4 trajets à mesurer.'), { code: 'roads_cold' }); });
    await start(false);
    await expect(roadsSwitch(true)).rejects.toMatchObject({ kind: 'refusal', hint: 'roads_cold' });
  });
  it('no signal: throws, nothing kept in the outbox', async () => {
    srv.rpc('roads_switch', () => ({ ok: true, on: true }));
    await start(false);
    srv.offline = true;
    await expect(roadsSwitch(true)).rejects.toBeTruthy();
    expect(net.value.pending).toBe(0);
  });
});

describe('the previews: nothing written, the action\'s right and refusals', () => {
  it('movePreview: move_preview { p_truck, p_day, p_block, p_jobs } with no op; the answer read', async () => {
    srv.rpc('move_preview', () => ({ order: ['a', 'b'], eta: { a: 540, b: 'x' }, refused: ['c'], day_min: 80, day_km: null, unmeasured: 2 }));
    await start(true);
    const p = await movePreview('t1', '2026-12-01', 'am', ['b', 'c']);
    expect(p).toEqual({ order: ['a', 'b'], eta: { a: 540, b: null }, refused: ['c'], day_min: 80, day_km: null, unmeasured: 2 });
    expect(rpcCalls('move_preview')[0].body).toEqual({ p_truck: 't1', p_day: '2026-12-01', p_block: 'am', p_jobs: ['b', 'c'] });
    expect(net.value.pending).toBe(0);
  });
  it('movePreview asTold: the move « Changer de camion » taps (p_as_told: true); never sent otherwise', async () => {
    srv.rpc('move_preview', () => ({ order: ['b'], eta: { b: 600 }, refused: [], day_min: 20, day_km: 9, unmeasured: 0 }));
    await start(true);
    await movePreview('t2', '2026-12-01', 'pm', ['b'], { asTold: true });
    await movePreview('t2', '2026-12-01', 'pm', ['b'], { asTold: false });
    expect(rpcCalls('move_preview').map((c) => c.body)).toEqual([
      { p_truck: 't2', p_day: '2026-12-01', p_block: 'pm', p_jobs: ['b'], p_as_told: true },
      { p_truck: 't2', p_day: '2026-12-01', p_block: 'pm', p_jobs: ['b'] }
    ]);
  });
  it('movePreview: why each refused move is refused (the key added on 2026-11-20), when the server says it', async () => {
    srv.rpc('move_preview', () => ({ order: ['a'], eta: { a: 540 }, refused: ['c', 'd'], refused_why: { c: 'truck_full', d: 'needs_truck', e: 3 }, day_min: 30, day_km: 12.5, unmeasured: 0 }));
    await start(true);
    const p = await movePreview('t1', '2026-12-01', null, ['c', 'd']) as MovePreview;
    expect(p.refused_why).toEqual({ c: 'truck_full', d: 'needs_truck' });
  });
  it('movePreview: the reasons read from the other shape proposed, refused: [{ id, code }]', async () => {
    srv.rpc('move_preview', () => ({ order: ['a'], eta: { a: 540 }, refused: [{ id: 'c', code: 'block_started' }, 'd', { id: 'e' }, { code: 'x' }], day_min: 30, day_km: null, unmeasured: 1 }));
    await start(true);
    const p = await movePreview('t1', '2026-12-01', null, ['c', 'd', 'e']) as MovePreview;
    expect(p.refused).toEqual(['c', 'd', 'e']);
    expect(p.refused_why).toEqual({ c: 'block_started' });
  });
  it('movePreview: no reason sent (switch off, or the server of before): no refused_why at all', async () => {
    srv.rpc('move_preview', () => ({ order: ['a'], eta: { a: 540 }, refused: ['c'], day_min: 30, day_km: null, unmeasured: null }));
    await start(false);
    const p = await movePreview('t1', '2026-12-01', 'am', ['c']) as MovePreview;
    expect(p.refused).toEqual(['c']);
    expect('refused_why' in p).toBe(false);
  });
  it('movePreview: an older server (no preview: null, or not a preview) → null; a refusal is thrown', async () => {
    srv.rpc('move_preview', () => null);
    await start(true);
    expect(await movePreview('t1', '2026-12-01', 'am', ['a'])).toBeNull();
    srv.rpc('move_preview', () => { throw Object.assign(new Error('Non.'), { code: 'not_allowed' }); });
    await expect(movePreview('t1', '2026-12-01', 'am', ['a'])).rejects.toMatchObject({ kind: 'refusal', hint: 'not_allowed' });
  });
});

describe('a new start reached the server: its trips are measured at once (decision 7, final-guess G1-start)', () => {
  const home = { label: 'Centrale', address: '1401 rue Legendre O.', lat: 45.5313, lng: -73.6545 };
  it('« Départ de ce camion »: the new start, for the two coming weeks; null (back to the common start): « Départ des camions »', async () => {
    srv.rpc('set_truck_start', () => ({ ok: true }));
    srv.put('settings', { id: '1', booking: { roads_on: true, home } });
    const u = uid(); await startSync(clientFor(srv, u), u); await until(() => net.value.ready);
    await setTruckStart('t1', { label: 'Laval', address: '1 boul. X', lat: 45.6, lng: -73.75 });
    await until(() => warms().length > 0);
    expect(warms()[0].body).toEqual({ action: 'warm', point: { lat: 45.6, lng: -73.75 }, from: today(), days: 14, only: 'point' });
    await setTruckStart('t1', null);
    await until(() => warms().some((c) => (c.body.point as { lat: number }).lat === home.lat));
  });
  it('« Départ des camions » saved: the new place measured once; a booking save that keeps it does not ask again', async () => {
    srv.put('settings', { id: '1', booking: { roads_on: true, home } });
    const u = uid(); await startSync(clientFor(srv, u), u); await until(() => net.value.ready);
    const moved = { label: 'Brossard', address: '2 rue Y', lat: 45.45, lng: -73.47 };
    await saveSettings('booking', { roads_on: true, home: moved });
    await until(() => warms().length > 0);
    expect(warms()[0].body).toMatchObject({ point: { lat: 45.45, lng: -73.47 }, from: today(), only: 'point' });
    await saveSettings('booking', { roads_on: true, home: moved, stop_min: 6 });
    await flush(); await settle(80);
    expect(warms()).toHaveLength(1);
  });
  it('switch off: nothing is sent to « drive »', async () => {
    srv.rpc('set_truck_start', () => ({ ok: true }));
    await start(false);
    await setTruckStart('t1', { label: 'Laval', address: '1 boul. X', lat: 45.6, lng: -73.75 });
    await flush(); await settle(80);
    expect(fn.calls.filter((c) => c.name === 'drive')).toHaveLength(0);
  });
});
