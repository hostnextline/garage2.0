/* « Garde-route » on the agenda's drag and drop with « Vraies routes » (request-flows risk 2, review-moments H4): the
   REAL move.ts on the REAL data layer (api.ts suggestBlocks → roads.ts warmRoads); the function « drive », the planner
   and move_job pretended. The address is measured before the planner answers (up to 3.5 s): the question must not
   vanish meanwhile, and a planner that never answers must not hold the move. Switch OFF: as before. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fn = vi.hoisted(() => ({ ms: 3300, calls: [] as string[] }));
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<Record<string, unknown>>()),
  callFn: (name: string) => { fn.calls.push(name); return new Promise((ok) => setTimeout(() => ok({ ok: true, ready: true, left: 0, left0: 0, stored: 4, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false }), fn.ms)); } }));
// the planner: once measured, that day is far (52 min between two customers)
const plan = vi.hoisted(() => ({ hang: false }));
vi.mock('../../data/client', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const r = { day: '2026-11-21', drive_min: 40, near: 0, truck: 't1', left: 100, far: 'hop', hop_min: 52, add_min: 40, add_km: 30, day_min: 150, stops: 2, unmeasured: 0 };
  return { ...real, ask: () => (plan.hang ? new Promise(() => undefined) : Promise.resolve([{ ...r, block: 'pm' }, { ...r, block: 'day' }])) };
});
const mv = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), moveJob: async () => { mv.calls++; return { queued: false, data: { ok: true } }; } }));
const ui = vi.hoisted(() => ({ asked: [] as string[], readMs: 2000, far: false }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<Record<string, unknown>>()),
  // the move's question: « yes » after reading `readMs`; « Beaucoup de route ce jour-là »: `far` (false: do not move)
  ask: (o: { title: string }) => { ui.asked.push(o.title); const first = ui.asked.length === 1; return new Promise((ok) => setTimeout(() => ok(first ? true : ui.far), first ? ui.readMs : 0)); },
  toast: () => {} }));
vi.mock('../../shared/moment/notify', async (orig) => ({ ...(await orig<Record<string, unknown>>()), wantsText: () => false, notifyCustomer: () => {} }));

import { upsertLocal, clearAll } from '../../data/store';
import { resetRoads } from '../../data/roads';
import { lang } from '../../lib/i18n';
import type { Job } from '../../data/types';
import { moveFlow, moveToTime, moveToWindow, farCheckDay } from './move';

const julie = { id: 'j1', number: 7, day: '2026-11-20', block: 'am', status: 'booked', truck_id: 't1', duration_min: 60, lat: 45.5, lng: -73.6, customer_id: null, needs_machine: false, vehicle_kind: null } as unknown as Job;
const roads = (on: boolean) => upsertLocal('settings', [{ id: '1', booking: { roads_on: on } } as never], { force: true });
const FAR = 'Beaucoup de route ce jour-là';

beforeEach(() => { resetRoads(); clearAll(); fn.calls.length = 0; ui.asked.length = 0; ui.readMs = 2000; ui.far = false; mv.calls = 0; fn.ms = 3300; plan.hang = false; lang.value = 'fr'; });

describe('« Garde-route » on a drag and drop, switch ON', () => {
  it('the address measured in 3.3 s, the person read the question 2 s: « Beaucoup de route ce jour-là » is still asked, « non » keeps the job', async () => {
    roads(true);
    expect(await moveFlow(julie, { day: '2026-11-21', block: 'pm' })).toBe(false);
    expect(fn.calls).toContain('drive');
    expect(ui.asked).toEqual([expect.any(String), FAR]);
    expect(mv.calls).toBe(0);
  }, 15000);
  it('the person answered at once (0.1 s): the planner still gets its few seconds after the measure’s 3.5 s', async () => {
    roads(true);
    ui.readMs = 100;
    expect(await moveFlow(julie, { day: '2026-11-21', block: 'pm' })).toBe(false);
    expect(ui.asked).toEqual([expect.any(String), FAR]);
  }, 15000);
  it('the time grid (a day of windows): the same', async () => {
    roads(true);
    const moved = await moveToTime({ ...julie, block: 'day', win_start: 540, win_end: 780 } as Job, '2026-11-21', null, 900);
    expect(ui.asked.length).toBe(2);
    expect(ui.asked[1]).toBe(FAR);
    expect(moved).toBe(false);
  }, 15000);
  it('the sheet of windows: the question asked when the sheet opened, a time picked 0.1 s later: still asked', async () => {
    roads(true);
    const asked = farCheckDay({ ...julie, block: 'day' } as Job, '2026-11-21');
    await new Promise((r) => setTimeout(r, 100));
    // (the pretended person says « oui » to the first question met: here the far one itself, so the move goes on)
    expect(await moveToWindow({ ...julie, block: 'day' } as Job, '2026-11-21', { start: 780 }, asked)).toBe(true);
    expect(ui.asked).toEqual([FAR]);
    expect(mv.calls).toBe(1);
  }, 15000);
  it('a planner that never answers does not hold the move: it goes on after the wait, as before (the server refuses nothing on that ground)', async () => {
    roads(true);
    plan.hang = true;
    ui.readMs = 100;
    const t0 = performance.now();
    expect(await moveFlow(julie, { day: '2026-11-21', block: 'pm' })).toBe(true);
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(ui.asked.length).toBe(1);
    expect(mv.calls).toBe(1);
  }, 15000);
});

describe('switch OFF (control): as before', () => {
  it('the move is confirmed, then « Beaucoup de route ce jour-là » is asked; « oui » moves it; nothing goes to « drive »', async () => {
    roads(false);
    ui.far = true;
    expect(await moveFlow(julie, { day: '2026-11-21', block: 'pm' })).toBe(true);
    expect(ui.asked).toEqual([expect.any(String), FAR]);
    expect(fn.calls).toEqual([]);
    expect(mv.calls).toBe(1);
  }, 15000);
  it('a planner that never answers: the move goes on 3 s after the answer (not 6.5)', async () => {
    roads(false);
    plan.hang = true;
    ui.readMs = 100;
    const t0 = performance.now();
    expect(await moveFlow(julie, { day: '2026-11-21', block: 'pm' })).toBe(true);
    expect(performance.now() - t0).toBeLessThan(4500);
  }, 15000);
});
