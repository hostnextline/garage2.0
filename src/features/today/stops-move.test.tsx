/* « Déplacer » from the trucks' stops on Aujourd'hui (Hassan, 2026-11-21).
   « Les camions » (owner, office): each truck card lists its stops on demand (« Voir les N arrêts »), each one the app's
   ticket with the agenda's shortcut menu (right-click on a computer, long press on a phone); « Déplacer » opens the move
   sheet ON this screen; moved to another day, the stop leaves the truck's list by itself; a short message says where.
   « Ma journée » (mechanic): the same menu on its tickets, with the same rights: « Déplacer » only with « Réserver ».
   A plain tap still opens the appointment. The server (move_job) and the moment picker are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const srv = vi.hoisted(() => ({ moves: [] as unknown[][], next: '' }));
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    moveJob: async (...a: unknown[]) => {
      srv.moves.push(a);
      const store = await import('../../data/store');
      const j = store.getRow<{ id: string } & Record<string, unknown>>('jobs', String(a[0]))!;
      store.replaceLocal('jobs', [...store.rowsOf<{ id: string } & Record<string, unknown>>('jobs').filter((x) => x.id !== j.id), { ...j, day: a[1], block: a[2] }] as never);
      return { queued: false, data: { ok: true, changed: true, tell: false } };
    }
  };
});
vi.mock('../../shared/moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void }) => h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick({ day: srv.next, block: 'am' }) }, 'pick') };
});

import TodayScreen from './TodayScreen';
import { ContextMenuHost } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { today, addDays } from '../../lib/dates';
import { movesWaiting, setWaiting } from '../../shared/jobs/moving';
import type { Access } from '../../data/types';

const DAY = today();
srv.next = addDays(DAY, 1);
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true }, trucks: ['t1'] } as unknown as Access;
const booker = { ...mechanic, rights: { hours: true, book: true } } as unknown as Access;
const J = (id: string, order: number, status = 'booked') => ({ id, number: order, customer_id: null, truck_id: 't1', day: DAY, block: 'am', status, stop_order: order, duration_min: 60, eta_min: 540 + order * 70, deleted_at: null });
function garage(first = 'booked') {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: false, min_block_min: 45, unknown_min: 20 }, messages: { on: { moved: false } } }] as never);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion Complet', active: true, sort: 1, color: '#D3000E', driver_id: 'saleh' }] as never);
  replaceLocal('jobs', [J('j1', 1, first), J('j2', 2)] as never);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const rightClick = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })); }); };
async function show(who: Access) {
  access.value = who;
  await act(async () => { render(<><TodayScreen params={{}} query={new URLSearchParams()} /><ContextMenuHost /></>, box); });
  await settle();
}
const closeMenu = () => act(() => { (document.querySelector('.agenda-menu-shade') as HTMLElement | null)?.click(); });

beforeEach(() => { clearAll(); lang.value = 'fr'; srv.moves = []; toasts.value = []; location.hash = '#/'; });
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; movesWaiting.value = new Set(); });

describe('« Les camions »: the stops of each truck, with the shortcut menu', () => {
  it('folded at first; « Voir les 2 arrêts » lists them as tickets that open the appointment', async () => {
    garage();
    await show(owner);
    expect(q('today-truck')).not.toBeNull();
    expect(q('today-stop-j1')).toBeNull();
    expect(q('today-truck-stops-t1')?.textContent).toBe('Voir les 2 arrêts');
    await click('today-truck-stops-t1');
    expect(q('today-stop-j1')?.querySelector('a')?.getAttribute('href')).toBe('#/job/j1');
    expect(q('today-stop-j2')).not.toBeNull();
    expect(q('today-truck-stops-t1')?.textContent).toBe('Cacher les arrêts');
  });
  it('the owner: right-click a stop, « Déplacer », the sheet on this screen; moved: the stop leaves the truck, the message says where', async () => {
    garage();
    await show(owner);
    await click('today-truck-stops-t1');
    await rightClick(q('today-stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    await click('menu-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(q('today-screen')).not.toBeNull();
    expect(location.hash).toBe('#/');
    await click('fake-pick');
    await click('move-ok');
    expect(srv.moves).toEqual([['j1', srv.next, 'am', null, null]]);
    expect(q('move-sheet')).toBeNull();
    expect(q('today-stop-j1')).toBeNull();
    expect(q('today-stop-j2')).not.toBeNull();
    expect(toasts.value.map((x) => x.text).join(' | ')).toMatch(/^Rendez-vous déplacé : .*matin\.$/);
  });
  it('never « Déplacer » for an appointment under way or done, nor while a move of it waits on the phone', async () => {
    for (const status of ['en_route', 'on_site', 'done']) {
      garage(status);
      await show(owner);
      await click('today-truck-stops-t1');
      await rightClick(q('today-stop-j1')!);
      expect(q('menu-open')).not.toBeNull();
      expect(q('menu-move')).toBeNull();
      closeMenu();
      act(() => render(null, box));
    }
    garage();
    setWaiting('j1', true);
    await show(owner);
    await click('today-truck-stops-t1');
    await rightClick(q('today-stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
});

describe('« Ma journée »: the same menu, the same rights', () => {
  it('a mechanic without « Réserver »: the menu on his stops, without « Déplacer »', async () => {
    garage();
    await show(mechanic);
    const stop = q('today-stop-j2')!;
    expect(stop).not.toBeNull();
    await rightClick(stop);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
  it('a mechanic with « Réserver »: « Déplacer » opens the sheet on « Ma journée »; moved: the stop leaves his day', async () => {
    garage();
    await show(booker);
    await rightClick(q('today-stop-j2')!);
    await click('menu-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(location.hash).toBe('#/');
    await click('fake-pick');
    await click('move-ok');
    expect(srv.moves).toEqual([['j2', srv.next, 'am', null, null]]);
    expect(q('today-stop-j2')).toBeNull();
  });
});
