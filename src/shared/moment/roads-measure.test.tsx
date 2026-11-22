/* « Vraies routes » ON: the blocks picker on the REAL data layer (api.ts suggestBlocks → roads.ts warmRoads); the
   function « drive » and the planner's RPC pretended. While the address is measured the person is told so, a measure
   that could not be made says so with « Réessayer », a measure landing after the picker gave up makes it ask the planner
   again (roadsTick), and « Réserver »'s own check does not wait the measure's seconds again (review-moments M3, task
   point 4). Switch OFF: nothing of it (no request to « drive », no banner). */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const fn = vi.hoisted(() => ({ ms: 5000 as number | null, answer: null as Record<string, unknown> | null, bodies: [] as Record<string, unknown>[] }));
const done = { ok: true, ready: true, left: 0, left0: 0, stored: 4, planned: 0, kept: [], late: [], no_road: 0, tomtom: 'ok', osrm: 'unused', spent: null, more: false };
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<Record<string, unknown>>()), isOwner: () => false, hasRole: () => false,
  callFn: (_name: string, body: Record<string, unknown>) => {
    fn.bodies.push(body);
    if (fn.ms == null) return new Promise(() => undefined);
    return new Promise((ok) => setTimeout(() => ok(fn.answer ?? done), fn.ms!));
  } }));
const rpc = vi.hoisted(() => ({ calls: 0, at: [] as number[], rows: [] as unknown[] }));
vi.mock('../../data/client', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ask: async () => { rpc.calls++; rpc.at.push(performance.now()); return rpc.rows; } }));
vi.mock('./RoutePreview', async () => {
  const { h } = await import('preact');
  return { RoutePreview: () => null, RouteHover: () => h('i', {}), MapHover: () => null, floatStyle: () => ({}) };
});
vi.mock('../map/MapView', async () => {
  const { h } = await import('preact');
  return { MapView: () => h('div', {}) };
});

import { upsertLocal, clearAll } from '../../data/store';
import { resetRoads, warmRoads } from '../../data/roads';
import { suggestBlocks } from '../../data/api';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import { BlockPicker, type BlockChoice } from './BlockPicker';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T17:00:00Z'));
afterAll(() => { vi.useRealTimers(); });
globalThis.fetch = (() => new Promise(() => undefined)) as typeof fetch;
const tomorrow = addDays(today(), 1);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const P = { lat: 45.56, lng: -73.54 };
function Host() {
  const [v, setV] = useState<BlockChoice | null>(null);
  return <BlockPicker lat={P.lat} lng={P.lng} duration={60} value={v} onPick={(c) => setV(c)} onClear={() => setV(null)} layout="grid" />;
}
const roads = (on: boolean) => upsertLocal('settings', [{ id: '1', booking: { windows_on: false, roads_on: on, unknown_min: 20, home: { label: 'Centrale', address: 'x', lat: 45.5, lng: -73.6 } } } as never], { force: true });
const warmCalls = () => fn.bodies.filter((b) => b.action === 'warm' && b.only === 'point').length;

beforeEach(() => {
  resetRoads(); fn.ms = 5000; fn.answer = null; fn.bodies = []; rpc.calls = 0; rpc.at = []; lang.value = 'fr';
  roads(true);
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  rpc.rows = [{ day: tomorrow, block: 'am', drive_min: 20, near: 0, truck: 'T1', left: 160, add_min: 20, add_km: 6, day_min: 40, hop_min: 20, stops: 0, far: null, unmeasured: 0, day_km: 12, rank: null, route: null }];
});
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('the picker while the address is measured (switch ON)', () => {
  // first: no measure of an earlier test is still under way (a late one raises roadsTick)
  it('switch OFF: nothing is measured, nothing is said, the planner is asked once', async () => {
    roads(false);
    act(() => render(<Host />, box));
    await wait(1000);
    expect(fn.bodies.length).toBe(0);
    expect(q('roads-measuring')).toBeNull();
    expect(rpc.calls).toBe(1);
  });
  it('the person is told the roads are being measured (and that the suggestions update by themselves)', async () => {
    act(() => render(<Host />, box));
    await wait(1500);
    expect(q('roads-measuring')?.textContent).toContain('Mesure des routes vers cette adresse');
    expect(q('roads-failed')).toBeNull();
  });
  it('the measure lands after the picker gave up (5 s): the planner is asked again, by itself, and the banner goes', async () => {
    const t0 = performance.now();
    act(() => render(<Host />, box));
    await wait(3000);
    await wait(2000);
    await wait(1500);
    // asked again AFTER the measure landed (5 s): not only the first ask (an earlier test's late ask is not counted)
    expect(rpc.at.filter((x) => x - t0 > 5000).length).toBeGreaterThanOrEqual(1);
    expect(q('roads-measuring')).toBeNull();
    }, 15000);
  it('the measure could not be made: said plainly, with « Réessayer », which measures again and asks the planner again', async () => {
    fn.ms = 50; fn.answer = { ok: false, code: 'server' };
    act(() => render(<Host />, box));
    await wait(800);
    expect(q('roads-failed')?.textContent).toContain('Tu peux réserver quand même');
    const before = { warm: warmCalls(), rpc: rpc.calls };
    fn.answer = null;
    await act(async () => { q('roads-retry')!.click(); });
    await wait(800);
    expect(warmCalls()).toBeGreaterThan(before.warm);
    expect(rpc.calls).toBeGreaterThan(before.rpc);
    expect(q('roads-failed')).toBeNull();
  });
});

describe('« Réserver » right after the picker (task point 4)', () => {
  it('its own check (one day, the same address) shares the measure under way: it waits only what is left of the 3.5 s', async () => {
    fn.ms = 3300;
    void warmRoads(P, today(), 14);           // the picker, 2 s before the tap
    await new Promise((r) => setTimeout(r, 2000));
    const t0 = performance.now();
    await suggestBlocks(P.lat, P.lng, 60, tomorrow, 1);
    const took = performance.now() - t0;
    expect(took).toBeLessThan(2000);
    expect(warmCalls()).toBe(1);
    }, 15000);
});
