/* « Déplacer » from the trucks' stops on the Carte (Hassan, 2026-11-21): a « Déplacer » button on the card of the stop
   chosen, and the agenda's shortcut menu on every row of « Arrêts de … » (right-click on a computer, long press on a
   phone); the move sheet opens ON the map; once moved, the map asks the server again (its list is the server's answer)
   and the stop leaves the day; a short message says where it went. Only for who may move it (the agenda's rule).
   The server (team_map, move_job), the map itself and the moment picker are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const srv = vi.hoisted(() => ({ answer: null as unknown, asked: 0, moves: [] as unknown[][], next: '', queued: false }));
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    rpcNow: async (name: string) => { if (name !== 'team_map') throw new Error('not pretended'); srv.asked++; return srv.answer; },
    moveJob: async (...a: unknown[]) => {
      srv.moves.push(a);
      if (srv.queued) return { queued: true };
      const store = await import('../../data/store');
      const j = store.getRow<{ id: string } & Record<string, unknown>>('jobs', String(a[0]))!;
      store.replaceLocal('jobs', [{ ...j, day: a[1], block: a[2] }] as never);
      return { queued: false, data: { ok: true, changed: true, tell: false } };
    }
  };
});
// a move kept on the phone sits in the outbox until the signal is back (pretended: it never leaves during the test)
vi.mock('../../data/sync', async (orig) => ({
  ...(await orig<typeof import('../../data/sync')>()),
  outboxList: async () => (srv.queued ? [{ op: 'o1', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1' } }] : []),
  whenDone: () => new Promise(() => undefined)
}));
vi.mock('../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../shared/map/useRoads', () => ({ useRoads: () => 0, roadOf: () => [], roadTotal: () => null, roadState: () => 'known' }));
vi.mock('../../shared/moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void }) => h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick({ day: srv.next, block: 'am' }) }, 'pick') };
});

import MapScreen from './MapScreen';
import { ContextMenuHost, PRESS_MS } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { wide } from '../../platform/media';
import { lang } from '../../lib/i18n';
import { today, addDays } from '../../lib/dates';
import { forgetTeamMaps } from '../../shared/map/useTeamMap';
import { movesWaiting, setWaiting } from '../../shared/jobs/moving';
import type { Access } from '../../data/types';

const TODAY = today();
srv.next = addDays(TODAY, 1);
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true }, trucks: ['t1'] } as unknown as Access;
const truck = { id: 't1', name: 'Camion Complet', active: true, sort: 1, color: '#D3000E', driver_id: null };
const answerWith = (status: string, jobs = true) => ({
  home: { lat: 45.53, lng: -73.65, label: 'Centrale', address: '1401 rue Legendre' },
  trucks: [{ id: 't1', name: 'Camion Complet', color: '#D3000E', driver_id: null }],
  jobs: jobs ? [{ id: 'j1', number: 7, truck_id: 't1', order: 1, eta_min: 600, status, block: 'am', name: 'Julie Tremblay', address: '1250 rue Graham', lat: 45.52, lng: -73.64 }] : [],
  people: [], trips: []
});
function garage(status = 'booked') {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: false, min_block_min: 45, unknown_min: 20 }, messages: { on: { moved: false } } }] as never);
  replaceLocal('trucks', [truck] as never);
  replaceLocal('jobs', [{ id: 'j1', number: 7, customer_id: null, truck_id: 't1', day: TODAY, block: 'am', status, stop_order: 1, duration_min: 60, eta_min: 600, lat: 45.52, lng: -73.64, address: '1250 rue Graham' }] as never);
  srv.answer = answerWith(status);
}

const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const rightClick = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })); }); };
const touchEv = (type: string, at: [number, number] | null) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'touches', { value: at ? [{ clientX: at[0], clientY: at[1] }] : [] }); return e; };
async function show(who: Access) {
  access.value = who;
  await act(async () => { render(<><MapScreen params={{}} query={new URLSearchParams()} /><ContextMenuHost /></>, box); });
  await settle();
}

beforeEach(() => { lang.value = 'fr'; wide.value = true; srv.asked = 0; srv.moves = []; srv.queued = false; forgetTeamMaps(); toasts.value = []; location.hash = '#/map'; });
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; movesWaiting.value = new Set(); vi.useRealTimers(); });

describe('the card of the stop chosen: « Déplacer »', () => {
  it('the owner: the sheet opens on the map, the move goes, the map asks again, the stop leaves the day, the message says where', async () => {
    garage();
    await show(owner);
    await click('stop-j1');
    expect(q('map-card')).not.toBeNull();
    expect(q('map-move')?.textContent).toBe('Déplacer');
    await click('map-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(q('map-screen')).not.toBeNull();
    expect(location.hash).toBe('#/map');
    await click('fake-pick');
    srv.answer = answerWith('booked', false);   // the server's day once the appointment left it
    const asked = srv.asked;
    await click('move-ok');
    expect(srv.moves).toEqual([['j1', srv.next, 'am', null, null]]);
    expect(srv.asked).toBeGreaterThan(asked);
    expect(q('move-sheet')).toBeNull();
    expect(q('stop-j1')).toBeNull();
    expect(q('map-card')).toBeNull();
    expect(toasts.value.map((x) => x.text).join(' | ')).toMatch(/^Rendez-vous déplacé : .*matin\.$/);
  });
  it('never for a mechanic without « Réserver », an appointment under way or done, or a move still waiting on the phone', async () => {
    garage();
    await show(mechanic);
    await click('stop-j1');
    expect(q('map-card')).not.toBeNull();
    expect(q('map-move')).toBeNull();
    act(() => render(null, box));
    for (const status of ['en_route', 'on_site', 'done']) {
      garage(status);
      await show(owner);
      await click('stop-j1');
      expect(q('map-card')).not.toBeNull();
      expect(q('map-move')).toBeNull();
      act(() => render(null, box));
    }
    garage();
    setWaiting('j1', true);
    await show(owner);
    await click('stop-j1');
    expect(q('map-move')).toBeNull();
    act(() => { setWaiting('j1', false); });
    expect(q('map-move')).not.toBeNull();
  });
  it('a stop the server already sees on the way is not offered a move, even if this phone still says booked', async () => {
    garage();
    srv.answer = answerWith('en_route');
    await show(owner);
    await click('stop-j1');
    expect(q('map-move')).toBeNull();
  });
  it('a move kept on the phone (no signal): « Déplacer » is gone from the card while it waits', async () => {
    garage();
    srv.queued = true;
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    await click('fake-pick');
    await click('move-ok');
    expect(movesWaiting.value.has('j1')).toBe(true);
    expect(q('move-sheet')).toBeNull();
    expect(q('map-move')).toBeNull();
  });
});

describe('the rows of « Arrêts de … »: the agenda’s shortcut menu', () => {
  it('right-click: the menu, « Déplacer » opens the sheet on the map', async () => {
    garage();
    await show(owner);
    await rightClick(q('stop-j1')!);
    expect(q('agenda-menu')).not.toBeNull();
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).not.toBeNull();
    await click('menu-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(location.hash).toBe('#/map');
  });
  it('a mechanic without « Réserver »: the menu without « Déplacer »; an appointment done: the same', async () => {
    garage();
    await show(mechanic);
    await rightClick(q('stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
    act(() => render(null, box));
    garage('done');
    await show(owner);
    await rightClick(q('stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
  it('a plain tap still chooses the stop (its card); a long press opens the menu and its release chooses nothing', async () => {
    garage();
    wide.value = false;
    await show(owner);
    await click('map-pull-handle');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const row = q('stop-j1')!;
    act(() => { row.dispatchEvent(touchEv('touchstart', [20, 20])); });
    act(() => { vi.advanceTimersByTime(PRESS_MS); });
    act(() => { row.dispatchEvent(touchEv('touchend', null)); row.click(); });
    expect(q('agenda-menu')).not.toBeNull();
    expect(q('menu-move')).not.toBeNull();
    expect(q('map-card')).toBeNull();
    vi.useRealTimers();
    act(() => { (document.querySelector('.agenda-menu-shade') as HTMLElement).click(); });
    await new Promise((r) => setTimeout(r, 950));
    await click('stop-j1');
    expect(q('map-card')).not.toBeNull();
    expect(q('agenda-menu')).toBeNull();
  });
});
