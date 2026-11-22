/* « exact move », A7 (the owner's correction of 2026-11-21 20:25): with « Vraies routes » on, the trips of the moved
   appointment's address for the day it goes to are measured BEFORE the preview and the move, waited as the suggestions
   wait (WARM_MS), so no measure lands right after the move and plans the day again. Through the real data layer; only
   the function « drive » pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fn = vi.hoisted(() => ({ calls: [] as { name: string; body: Record<string, unknown> }[], ms: 0, restMs: -1, ready: true }));
vi.mock('./auth', async (orig) => {
  const real = await orig<typeof import('./auth')>();
  return {
    ...real,
    callFn: (name: string, body: Record<string, unknown>) => {
      fn.calls.push({ name, body });
      const a = { ok: true, ready: fn.ready, left: 0, left0: 0, stored: 2, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false };
      // the rest of those days (no `only`: other trips, rush times) takes restMs when set
      return new Promise((ok) => setTimeout(() => ok(a), body.only !== 'point' && fn.restMs >= 0 ? fn.restMs : fn.ms));
    }
  };
});
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, syncOptions } from './sync';
import { setNet } from './net';
import { resetRoads, warmJobDay, warmRoads, WARM_MS } from './roads';
import { today, addDays } from '../lib/dates';

let srv: FakeServer; let n = 0;
const uid = () => `00000000-0000-4000-b200-${String(++n).padStart(12, '0')}`;
async function until(ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
}
const warms = () => fn.calls.filter((c) => c.name === 'drive' && c.body.action === 'warm' && c.body.only === 'point');
const DAY = addDays(today(), 3);
beforeEach(() => {
  srv = new FakeServer(); syncOptions.realtime = false; resetRoads(); fn.calls.length = 0; fn.ms = 0; fn.restMs = -1; fn.ready = true;
  setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
  srv.put('customers', { id: 'c1', first_name: 'Julie', lat: 45.51, lng: -73.61 });
  srv.put('jobs', { id: 'j1', customer_id: 'c1', day: today(), block: 'day', status: 'booked', lat: null, lng: null, duration_min: 60 });
});
afterEach(() => stopSync());
async function start(roadsOn: boolean) {
  srv.put('settings', { id: '1', booking: { roads_on: roadsOn } });
  const u = uid(); await startSync(clientFor(srv, u), u); await until(() => net.value.ready);
}

describe('the address measured for the day it is moved to, before the preview (A7)', () => {
  it('switch on: the customer’s place, that day only, and the flow waits for the answer', async () => {
    await start(true);
    fn.ms = 300;
    const t0 = Date.now();
    const r = await warmJobDay('j1', DAY);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(r).toEqual({ ok: true, ready: true });
    expect(warms()).toHaveLength(1);
    expect(warms()[0].body).toEqual({ action: 'warm', point: { lat: 45.51, lng: -73.61 }, from: DAY, days: 1, only: 'point' });
  });
  it('a measure that takes longer than the suggestions wait: given up at WARM_MS, the move goes on (the measure runs on)', async () => {
    await start(true);
    fn.ms = WARM_MS + 2000;
    const t0 = Date.now();
    expect(await warmJobDay('j1', DAY)).toEqual({ ok: true, ready: false });
    expect(Date.now() - t0).toBeLessThan(WARM_MS + 800);
  }, 10000);
  it('the rest of that day (its rush times, the other trips) is waited too, so it does not land during the question or after the move (review F6)', async () => {
    await start(true);
    fn.ms = 100; fn.restMs = 500;
    const t0 = Date.now();
    expect(await warmJobDay('j1', DAY)).toEqual({ ok: true, ready: true });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
    const rest = fn.calls.filter((c) => c.name === 'drive' && c.body.action === 'warm' && c.body.only === undefined);
    expect(rest).toHaveLength(1);
    expect(rest[0].body).toMatchObject({ from: DAY, days: 1 });
    // a rest longer than the suggestions' wait: given up at WARM_MS from the start, it lands later and plans as usual
    resetRoads(); fn.calls.length = 0; fn.restMs = WARM_MS + 2000;
    const t1 = Date.now();
    expect(await warmJobDay('j1', addDays(DAY, 1))).toEqual({ ok: true, ready: true });
    expect(Date.now() - t1).toBeGreaterThanOrEqual(WARM_MS - 100);
    expect(Date.now() - t1).toBeLessThan(WARM_MS + 800);
  }, 10000);
  it('a measure of that place remembered as not ready (a failure, trips missing) is not reused: asked again (review T1 / M25)', async () => {
    await start(true);
    fn.ready = false;
    expect(await warmRoads({ lat: 45.51, lng: -73.61 }, DAY, 1)).toEqual({ ok: true, ready: false });
    expect(warms()).toHaveLength(1);
    fn.ready = true;
    expect(await warmJobDay('j1', DAY)).toEqual({ ok: true, ready: true });
    expect(warms()).toHaveLength(2);
  });
  it('switch off: nothing asked, nothing waited', async () => {
    await start(false);
    expect(await warmJobDay('j1', DAY)).toEqual({ ok: true, ready: true });
    expect(fn.calls).toHaveLength(0);
  });
});
