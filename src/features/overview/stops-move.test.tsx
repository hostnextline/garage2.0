/* « Déplacer » from the trucks' stops on « Vue d'ensemble » (Hassan, 2026-11-21): every row of the day's appointments has
   the agenda's shortcut menu (right-click on a computer, long press on a phone); « Déplacer » opens the move sheet ON the
   screen; once moved to another day the row leaves the list by itself (the phone's copy), the map does not keep the stop,
   and a short message says where it went. A plain tap still opens the appointment. Only for who may move it.
   The server (team_map, move_job), the map and the moment picker are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const srv = vi.hoisted(() => ({ answer: null as unknown, moves: [] as unknown[][], next: '' }));
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    rpcNow: async () => srv.answer,
    moveJob: async (...a: unknown[]) => {
      srv.moves.push(a);
      const store = await import('../../data/store');
      const j = store.getRow<{ id: string } & Record<string, unknown>>('jobs', String(a[0]))!;
      store.replaceLocal('jobs', [{ ...j, day: a[1], block: a[2] }] as never);
      return { queued: false, data: { ok: true, changed: true, tell: false } };
    }
  };
});
vi.mock('../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../shared/map/useRoads', () => ({ useRoads: () => 0, roadOf: () => [], roadState: () => 'known' }));
vi.mock('../../shared/moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void }) => h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick({ day: srv.next, block: 'am' }) }, 'pick') };
});

import OverviewScreen from './OverviewScreen';
import { mergeTeamMap } from './teamMap';
import { ContextMenuHost } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { today, addDays } from '../../lib/dates';
import { movesWaiting, setWaiting } from '../../shared/jobs/moving';
import type { Access } from '../../data/types';
import type { TeamMapAnswer } from '../../shared/map/assemble';

const TODAY = today();
srv.next = addDays(TODAY, 1);
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const office = { id: 'nadia', owner: false, roles: ['office'], rights: { book: true, agenda: true, map: true }, trucks: [] } as unknown as Access;
const mechanic = { id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true }, trucks: ['t1'] } as unknown as Access;
const sJob = (id: string, status = 'booked') => ({ id, number: 7, truck_id: 't1', order: 1, eta_min: 600, status, block: 'am', name: 'Julie Tremblay', address: '1250 rue Graham', lat: 45.52, lng: -73.64 });
const answer = (jobs: ReturnType<typeof sJob>[]): TeamMapAnswer => ({ home: null, trucks: [{ id: 't1', name: 'Camion Complet', color: '#D3000E', driver_id: null }], jobs, people: [], trips: [] });
function garage(status = 'booked') {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: false, min_block_min: 45, unknown_min: 20 }, messages: { on: { moved: false } } }] as never);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion Complet', active: true, sort: 1, driver_id: null, color: '#D3000E' }] as never);
  replaceLocal('jobs', [{ id: 'j1', number: 7, customer_id: null, truck_id: 't1', day: TODAY, block: 'am', status, stop_order: 1, duration_min: 60, eta_min: 600, lat: 45.52, lng: -73.64 }] as never);
  srv.answer = answer([sJob('j1', status)]);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const rightClick = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })); }); };
async function show(who: Access) {
  access.value = who;
  await act(async () => { render(<><OverviewScreen params={{}} query={new URLSearchParams()} /><ContextMenuHost /></>, box); });
  await settle();
}

beforeEach(() => { lang.value = 'fr'; srv.moves = []; toasts.value = []; location.hash = '#/overview'; });
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; movesWaiting.value = new Set(); });

describe('« Vue d’ensemble »: the shortcut menu on each row', () => {
  it('the owner: right-click, « Déplacer », the sheet on this screen; moved: the row leaves the day, the message says where', async () => {
    garage();
    await show(owner);
    const row = q('overview-job-j1')!;
    await rightClick(row);
    expect(q('agenda-menu')).not.toBeNull();
    expect(q('menu-open')).not.toBeNull();
    await click('menu-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(q('overview-screen')).not.toBeNull();
    expect(location.hash).toBe('#/overview');
    await click('fake-pick');
    await click('move-ok');
    expect(srv.moves).toEqual([['j1', srv.next, 'am', null, null]]);
    expect(q('move-sheet')).toBeNull();
    expect(q('overview-job-j1')).toBeNull();
    expect(toasts.value.map((x) => x.text).join(' | ')).toMatch(/^Rendez-vous déplacé : .*matin\.$/);
  });
  it('the office with « Réserver » has it; a mechanic without it, an appointment under way or done, a move waiting: never', async () => {
    garage();
    await show(office);
    await rightClick(q('overview-job-j1')!);
    expect(q('menu-move')).not.toBeNull();
    act(() => render(null, box));
    garage();
    await show(mechanic);
    await rightClick(q('overview-job-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
    act(() => render(null, box));
    for (const status of ['en_route', 'on_site', 'done']) {
      garage(status);
      await show(owner);
      await rightClick(q('overview-job-j1')!);
      expect(q('menu-open')).not.toBeNull();
      expect(q('menu-move')).toBeNull();
      act(() => render(null, box));
    }
    garage();
    setWaiting('j1', true);
    await show(owner);
    await rightClick(q('overview-job-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
  it('a plain tap still opens the appointment (the row is its link)', async () => {
    garage();
    await show(owner);
    expect(q('overview-job-j1')!.closest('a')?.getAttribute('href') ?? q('overview-job-j1')!.getAttribute('href')).toBe('#/job/j1');
  });
});

describe('the map of « Vue d’ensemble » follows a move at once', () => {
  it('a stop the phone now holds on another day is not taken from an older answer of the server', () => {
    const device = answer([]);
    const server = answer([sJob('j1'), sJob('other')]);
    // the phone holds j1 on another day (moved a moment ago); « other » is a stop this phone does not hold at all
    const merged = mergeTeamMap(server, device, (id) => id === 'j1');
    expect(merged.jobs.map((j) => j.id)).toEqual(['other']);
    // without the question (as before): the server's stop stays
    expect(mergeTeamMap(server, device).jobs.map((j) => j.id)).toEqual(['j1', 'other']);
  });
});
