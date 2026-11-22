/* « Déplacer » from the trucks' stops on Aujourd'hui: what the first tests did not pin (the reviews of 2026-11-21).
   - « Les camions »: the card still opens the appointment it speaks of (person F5, M15); the hint is phone first and
     names « Déplacer » only for who may move (person F7).
   - « Ma journée »: the NEXT stop has the menu too (person F5, M7).
   - A move kept on the phone: the message says the text follows, the ticket says « En attente d'envoi », and once the
     server has it with `tell` the customer's text goes (rules F1, person F1).
   - A move still in the outbox, or a « Je pars » still waiting on the phone: no « Déplacer » (rules F2, F6, M12).
   - The phone's gesture: a long press on a ticket opens the menu (person F5, M5).
   The server (move_job, notify), the outbox and the moment picker are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const srv = vi.hoisted(() => ({ moves: [] as unknown[][], next: '', queued: false, notified: [] as unknown[][], outbox: [] as unknown[], done: [] as ((d: unknown) => void)[] }));
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    moveJob: async (...a: unknown[]) => {
      srv.moves.push(a);
      if (srv.queued) return { queued: true };
      const store = await import('../../data/store');
      const j = store.getRow<{ id: string } & Record<string, unknown>>('jobs', String(a[0]))!;
      store.replaceLocal('jobs', [...store.rowsOf<{ id: string } & Record<string, unknown>>('jobs').filter((x) => x.id !== j.id), { ...j, day: a[1], block: a[2] }] as never);
      return { queued: false, data: { ok: true, changed: true, tell: false } };
    },
    notify: async (...a: unknown[]) => { srv.notified.push(a); return { ok: true, status: 'sent', message: 'm', link: null, phone: '5145550100' }; }
  };
});
vi.mock('../../data/sync', async (orig) => ({
  ...(await orig<typeof import('../../data/sync')>()),
  outboxList: async () => srv.outbox,
  whenDone: () => new Promise((res) => { srv.done.push(res); }),
  refetch: async () => 'updated',
  pull: async () => undefined
}));
vi.mock('../../shared/moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void }) => h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick({ day: srv.next, block: 'am' }) }, 'pick') };
});

import TodayScreen from './TodayScreen';
import { ContextMenuHost, PRESS_MS } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll } from '../../data/store';
import { outbox, setNet } from '../../data/net';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { today, addDays } from '../../lib/dates';
import { movesWaiting } from '../../shared/jobs/moving';
import type { Access } from '../../data/types';

const DAY = today();
srv.next = addDays(DAY, 1);
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const booker = { id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true, book: true }, trucks: ['t1'] } as unknown as Access;
// an « Agenda »-only account (no « Réserver »): it gets the office's day, « Les camions » included
const agendaOnly = { id: 'lea', owner: false, roles: ['office'], rights: { agenda: true }, trucks: [] } as unknown as Access;
const J = (id: string, order: number, status = 'booked') => ({ id, number: order, customer_id: 'c1', truck_id: 't1', day: DAY, block: 'am', status, stop_order: order, duration_min: 60, eta_min: 540 + order * 70, deleted_at: null });
function garage() {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: false, min_block_min: 45, unknown_min: 20 }, messages: { on: { moved: true } } }] as never);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion Complet', active: true, sort: 1, color: '#D3000E', driver_id: 'saleh' }] as never);
  replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Tremblay', phone: '5145550100', sms_ok: true }] as never);
  replaceLocal('jobs', [J('j1', 1), J('j2', 2)] as never);
}
const pendingMove = { op: 'o-move', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1', p_day: addDays(DAY, 2), p_block: 'pm' }, at: '2026-11-21T10:00:00Z', tries: 0 };
const pendingLeave = { op: 'o-leave', kind: 'rpc', rpc: 'job_step', state: 'pending', args: { p_job: 'j1', p_action: 'leave' }, at: '2026-11-21T10:00:00Z', tries: 0 };

const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const rightClick = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })); }); };
const touchEv = (type: string, at: [number, number] | null) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'touches', { value: at ? [{ clientX: at[0], clientY: at[1] }] : [] }); return e; };
const said = () => toasts.value.map((x) => x.text).join(' | ');
let bump = 0;
const outboxChanged = async () => { await act(async () => { setNet({ pending: ++bump }); }); await settle(); };
async function show(who: Access) {
  access.value = who;
  await act(async () => { render(<><TodayScreen params={{}} query={new URLSearchParams()} /><ContextMenuHost /></>, box); });
  await settle();
}
const closeMenu = () => act(() => { (document.querySelector('.agenda-menu-shade') as HTMLElement | null)?.click(); });

beforeEach(() => { clearAll(); lang.value = 'fr'; srv.moves = []; srv.queued = false; srv.notified = []; srv.outbox = []; srv.done = []; toasts.value = []; location.hash = '#/'; });
afterEach(async () => { vi.useRealTimers(); closeMenu(); act(() => render(null, box)); clearAll(); access.value = null; movesWaiting.value = new Set(); outbox.value = []; srv.outbox = []; await outboxChanged(); });

describe('« Les camions »', () => {
  it('the card still opens the appointment it speaks of (its next stop)', async () => {
    garage();
    await show(owner);
    expect(q('today-truck')!.querySelector('a.today-truck-link')?.getAttribute('href')).toBe('#/job/j1');
  });
  it('the hint: phone first, « Déplacer » named for who may move; not for an « Agenda »-only account', async () => {
    garage();
    await show(owner);
    await click('today-truck-stops-t1');
    expect(q('today-truck-list-t1')!.textContent).toContain('Appui long sur un arrêt (à l’ordi : clic droit) : « Déplacer », « Appeler », « Itinéraire »…');
    act(() => render(null, box));
    await show(agendaOnly);
    await click('today-truck-stops-t1');
    const hint = q('today-truck-list-t1')!.querySelector('.today-truck-hint')!.textContent!;
    expect(hint).toMatch(/^Appui long sur un arrêt \(à l’ordi : clic droit\)/);
    expect(hint).not.toContain('Déplacer');
    await rightClick(q('today-stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
    // English: the same meaning, phone first
    closeMenu();
    act(() => render(null, box));
    lang.value = 'en';
    await show(owner);
    await click('today-truck-stops-t1');
    expect(q('today-truck-list-t1')!.querySelector('.today-truck-hint')!.textContent).toBe('Press and hold a stop (on a computer: right-click): “Move”, “Call”, “Directions”…');
  });
  it('a move kept on the phone: the message says the text follows, the ticket « En attente d’envoi », the text once it is sent', async () => {
    garage();
    srv.queued = true;
    srv.outbox = [pendingMove];
    await show(owner);
    await click('today-truck-stops-t1');
    await rightClick(q('today-stop-j1')!);
    await click('menu-move');
    await click('fake-pick');
    await click('move-ok');
    expect(said()).toContain('Le texto au client partira quand le déplacement sera envoyé, si l’app reste ouverte.');
    expect(q('today-stop-j1')!.textContent).toContain('En attente d’envoi');
    srv.outbox = [];
    await act(async () => { srv.done.forEach((r) => r({ ok: true, changed: true, tell: true })); });
    await settle(); await settle();
    expect(srv.notified.length).toBe(1);
    expect(srv.notified[0].slice(0, 2)).toEqual(['moved', 'j1']);
    expect(q('today-stop-j1')!.textContent).not.toContain('En attente d’envoi');
  });
  it('a move still in the outbox (no screen marked it): no « Déplacer », the ticket says why', async () => {
    garage();
    await show(owner);
    act(() => { outbox.value = [pendingMove] as never; });
    await settle();
    await click('today-truck-stops-t1');
    expect(q('move-wait-j1')).not.toBeNull();
    await rightClick(q('today-stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
  it('a « Je pars » still waiting on the phone: no « Déplacer »', async () => {
    garage();
    srv.outbox = [pendingLeave];
    await show(owner);
    await outboxChanged();
    await click('today-truck-stops-t1');
    await rightClick(q('today-stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
});

describe('« Ma journée »', () => {
  it('the NEXT stop has the menu: « Déplacer » for a mechanic with « Réserver », the sheet on « Ma journée »', async () => {
    garage();
    await show(booker);
    expect(q('today-next')!.querySelector('[data-testid="today-stop-j1"]')).not.toBeNull();
    await rightClick(q('today-stop-j1')!);
    await click('menu-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(location.hash).toBe('#/');
    await click('fake-pick');
    await click('move-ok');
    expect(srv.moves).toEqual([['j1', srv.next, 'am', null, null]]);
  });
  it('a « Je pars » of the next stop still waiting on the phone: no « Déplacer » in its menu', async () => {
    garage();
    srv.outbox = [pendingLeave];
    await show(booker);
    await outboxChanged();
    await rightClick(q('today-stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
});

// last in the file: the long press leaves the menu's guard against Android's late right-click for 1.2 s
describe('the phone’s gesture', () => {
  it('a long press on a ticket of « Les camions »: the menu with « Déplacer »; the release does not open it', async () => {
    garage();
    await show(owner);
    await click('today-truck-stops-t1');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const ticket = q('today-stop-j2')!;
    let opened = false;
    ticket.addEventListener('click', (e) => { if (!e.defaultPrevented) opened = true; });
    act(() => { ticket.dispatchEvent(touchEv('touchstart', [20, 20])); });
    act(() => { vi.advanceTimersByTime(PRESS_MS); });
    act(() => { ticket.dispatchEvent(touchEv('touchend', null)); (ticket.querySelector('a') ?? ticket).click(); });
    expect(q('agenda-menu')).not.toBeNull();
    expect(q('menu-move')).not.toBeNull();
    expect(opened).toBe(false);
  });
});
