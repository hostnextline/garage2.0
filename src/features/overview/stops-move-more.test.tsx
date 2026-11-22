/* « Déplacer » from the trucks' stops on « Vue d'ensemble »: what the first tests did not pin (the reviews of 2026-11-21).
   - The phone's gesture: a long press on a row opens the menu with « Déplacer » (person F5, M6).
   - A move kept on the phone: the message says the question « Texter … ? » follows, the row says « En attente d'envoi »,
     and once the server has it with `tell` the question is asked (nothing goes by itself: Hassan, 2026-11-22);
     « Envoyer le texto » sends the customer's text (rules F1, person F1).
   - A move still in the outbox, or a « Je pars » still waiting on the phone: no « Déplacer » (rules F2, F6, M11).
   - The map: a stop the phone holds on another day leaves this day's map only when it was moved from this phone a
     moment ago; one the phone's copy is behind on stays where the server says (rules F5).
   - The « ? » names « Déplacer » only for who may move (person F7). The sheet opens its picker on the stop's own day
     (window mode: another hour the same day, person F4); closed, the focus goes back to the row (person F8).
   The server (team_map, move_job, notify), the outbox, the map and the moment picker are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const srv = vi.hoisted(() => ({
  answer: null as unknown, moves: [] as unknown[][], next: '', queued: false, notified: [] as unknown[][],
  outbox: [] as unknown[], done: [] as ((d: unknown) => void)[], openDay: undefined as unknown
}));
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    rpcNow: async () => srv.answer,
    moveJob: async (...a: unknown[]) => {
      srv.moves.push(a);
      if (srv.queued) return { queued: true };
      const store = await import('../../data/store');
      const j = store.getRow<{ id: string } & Record<string, unknown>>('jobs', String(a[0]))!;
      store.replaceLocal('jobs', [{ ...j, day: a[1], block: a[2] }] as never);
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
vi.mock('../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../shared/map/useRoads', () => ({ useRoads: () => 0, roadOf: () => [], roadState: () => 'known' }));
vi.mock('../../shared/moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void; openDay?: string | null }) => { srv.openDay = p.openDay; return h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick({ day: srv.next, block: 'am' }) }, 'pick'); } };
});

import OverviewScreen from './OverviewScreen';
import { useTeamMap } from './useTeamMap';
import { ContextMenuHost, PRESS_MS } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll } from '../../data/store';
import { outbox, setNet } from '../../data/net';
import { access } from '../../data/auth';
import { lang, t } from '../../lib/i18n';
import { today, addDays } from '../../lib/dates';
import { movesWaiting } from '../../shared/jobs/moving';
import { clearTextAsks, TEXT_ASK_DEAD_MS } from '../../shared/jobs/textAsk';
import type { Access } from '../../data/types';

const TODAY = today();
srv.next = addDays(TODAY, 1);
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true }, trucks: ['t1'] } as unknown as Access;
const sJob = (id: string) => ({ id, number: 7, truck_id: 't1', order: 1, eta_min: 600, status: 'booked', block: 'am', name: 'Julie Tremblay', address: '1250 rue Graham', lat: 45.52, lng: -73.64 });
const answer = (jobs: ReturnType<typeof sJob>[]) => ({ home: null, trucks: [{ id: 't1', name: 'Camion Complet', color: '#D3000E', driver_id: null }], jobs, people: [], trips: [] });
function garage(o: { day?: string } = {}) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: false, min_block_min: 45, unknown_min: 20 }, messages: { on: { moved: true } } }] as never);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion Complet', active: true, sort: 1, driver_id: null, color: '#D3000E' }] as never);
  replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Tremblay', phone: '5145550100', sms_ok: true }] as never);
  replaceLocal('jobs', [{ id: 'j1', number: 7, customer_id: 'c1', truck_id: 't1', day: o.day ?? TODAY, block: 'am', status: 'booked', stop_order: 1, duration_min: 60, eta_min: 600, lat: 45.52, lng: -73.64 }] as never);
  srv.answer = answer([sJob('j1')]);
}
const pendingMove = { op: 'o-move', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1', p_day: addDays(TODAY, 2), p_block: 'pm' }, at: '2026-11-21T10:00:00Z', tries: 0 };
const pendingLeave = { op: 'o-leave', kind: 'rpc', rpc: 'job_step', state: 'pending', args: { p_job: 'j1', p_action: 'leave' }, at: '2026-11-21T10:00:00Z', tries: 0 };

const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const rightClick = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })); }); };
const touchEv = (type: string, at: [number, number] | null) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'touches', { value: at ? [{ clientX: at[0], clientY: at[1] }] : [] }); return e; };
const said = () => toasts.value.map((x) => x.text).join(' | ');
/** « Texter … ? » (Hassan, 2026-11-22: nothing goes by itself): the question is on screen; answered once it takes taps */
async function answerTextAsk(send: boolean) {
  // (it waits for the step back in the history of the sheet just closed: up to 700 ms when the browser never answers it)
  for (let i = 0; i < 60 && !q('text-ask'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(q('text-ask')).not.toBeNull();
  await act(async () => { await new Promise((r) => setTimeout(r, TEXT_ASK_DEAD_MS + 40)); });
  await click(send ? 'text-ask-send' : 'text-ask-skip');
  await settle();
}
let bump = 0;
const outboxChanged = async () => { await act(async () => { setNet({ pending: ++bump }); }); await settle(); };
async function show(who: Access) {
  access.value = who;
  await act(async () => { render(<><OverviewScreen params={{}} query={new URLSearchParams()} /><ContextMenuHost /></>, box); });
  await settle();
}
const closeMenu = () => act(() => { (document.querySelector('.agenda-menu-shade') as HTMLElement | null)?.click(); });

beforeEach(() => { lang.value = 'fr'; srv.moves = []; srv.queued = false; srv.notified = []; srv.outbox = []; srv.done = []; toasts.value = []; location.hash = '#/overview'; });
afterEach(async () => { vi.useRealTimers(); act(() => { clearTextAsks(); }); closeMenu(); act(() => render(null, box)); clearAll(); access.value = null; movesWaiting.value = new Set(); outbox.value = []; srv.outbox = []; await outboxChanged(); vi.useRealTimers(); });

describe('« Vue d’ensemble »: the phone, the offline move', () => {
  it('a move kept on the phone: the message says the question « Texter … ? » follows, the row « En attente d’envoi », the question once it is sent', async () => {
    garage();
    srv.queued = true;
    srv.outbox = [pendingMove];
    await show(owner);
    await rightClick(q('overview-job-j1')!);
    await click('menu-move');
    await click('fake-pick');
    await click('move-ok');
    expect(said()).toContain('Quand le déplacement sera envoyé, l’app te demandera s’il faut texter le client (si l’app reste ouverte).');
    expect(q('overview-job-j1')!.textContent).toContain('En attente d’envoi');
    srv.outbox = [];
    await act(async () => { srv.done.forEach((r) => r({ ok: true, changed: true, tell: true })); });
    await settle(); await settle();
    expect(q('overview-job-j1')!.textContent).not.toContain('En attente d’envoi');
    // asked, never sent by itself; « Envoyer le texto »: the text, once
    expect(srv.notified).toEqual([]);
    await answerTextAsk(true);
    expect(srv.notified.length).toBe(1);
    expect(srv.notified[0].slice(0, 2)).toEqual(['moved', 'j1']);
  });
  it('a move still in the outbox (no screen marked it): no « Déplacer », the row says why', async () => {
    garage();
    await show(owner);
    act(() => { outbox.value = [pendingMove] as never; });
    await settle();
    expect(q('move-wait-j1')).not.toBeNull();
    await rightClick(q('overview-job-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
  it('a « Je pars » still waiting on the phone: no « Déplacer »', async () => {
    garage();
    srv.outbox = [pendingLeave];
    await show(owner);
    await outboxChanged();
    await rightClick(q('overview-job-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
});

describe('the sheet: its first day, the focus', () => {
  it('the picker opens on the stop’s own day (window mode: another hour the same day is one tap away)', async () => {
    garage();
    await show(owner);
    await rightClick(q('overview-job-j1')!);
    await click('menu-move');
    expect(srv.openDay).toBe(TODAY);
  });
  it('closed with « Annuler »: the focus goes back to the row the menu opened from (computer, keyboard)', async () => {
    garage();
    await show(owner);
    const link = q('overview-job-j1')!;
    link.focus();
    await rightClick(link);
    await click('menu-move');
    const cancel = [...q('move-sheet')!.querySelectorAll('button')].find((b) => b.textContent === 'Annuler')!;
    await act(async () => { cancel.click(); });
    await settle();
    expect(q('move-sheet')).toBeNull();
    expect(document.activeElement).toBe(link);
  });
});

describe('the map of « Vue d’ensemble » and the « ? »', () => {
  function Probe(p: { day: string }) {
    const m = useTeamMap(p.day);
    return <i data-testid="probe">{m.jobs.map((j) => j.id).join(',')}</i>;
  }
  it('a stop the phone holds on another day but did not move: the server’s answer keeps it on this day’s map', async () => {
    // the phone's copy is behind: the appointment was moved INTO today by someone else
    garage({ day: addDays(TODAY, 3) });
    access.value = owner;
    await act(async () => { render(<Probe day={TODAY} />, box); });
    await settle();
    expect(q('probe')!.textContent).toBe('j1');
  });
  it('moved from this screen to another day: it leaves this day’s map at once (the server’s answer is older)', async () => {
    garage();
    await show(owner);
    await rightClick(q('overview-job-j1')!);
    await click('menu-move');
    await click('fake-pick');
    await click('move-ok');
    act(() => render(null, box));
    await act(async () => { render(<Probe day={TODAY} />, box); });
    await settle();
    expect(q('probe')!.textContent).toBe('');
  });
  it('the « ? » names « Déplacer » for who may move, and not for a mechanic without « Réserver »; phone first', async () => {
    const bubble = async () => {
      await act(async () => { (q('overview-screen')!.querySelector('h1 .help') as HTMLElement).click(); });
      return document.querySelector('.help-pop')?.textContent ?? '';
    };
    garage();
    await show(owner);
    const forOwner = await bubble();
    expect(forOwner).toContain('Appui long sur un rendez-vous (à l’ordi : clic droit) : « Déplacer »');
    act(() => render(null, box));
    await show(mechanic);
    const forMechanic = await bubble();
    expect(forMechanic).toContain('Appui long sur un rendez-vous (à l’ordi : clic droit)');
    expect(forMechanic).not.toContain('Déplacer');
    // English: the same meaning
    lang.value = 'en';
    expect(t('overview.helpMove')).toContain('Press and hold an appointment (on a computer: right-click): “Move”');
    expect(t('overview.help')).not.toContain('Move');
  });
});

// last in the file: the long press leaves the menu's guard against Android's late right-click for 1.2 s
describe('« Vue d’ensemble »: the phone’s gesture', () => {
  it('a long press on a row (phone): the menu with « Déplacer »; the release does not open the appointment', async () => {
    garage();
    await show(owner);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const row = q('overview-job-j1')!;
    let opened = false;
    row.addEventListener('click', (e) => { if (!e.defaultPrevented) opened = true; });
    act(() => { row.dispatchEvent(touchEv('touchstart', [20, 20])); });
    act(() => { vi.advanceTimersByTime(PRESS_MS); });
    act(() => { row.dispatchEvent(touchEv('touchend', null)); row.click(); });
    expect(q('agenda-menu')).not.toBeNull();
    expect(q('menu-move')).not.toBeNull();
    expect(opened).toBe(false);
  });
});
