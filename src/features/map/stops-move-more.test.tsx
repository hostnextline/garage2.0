/* « Déplacer » from the trucks' stops on the Carte: what the first tests did not pin (the reviews of 2026-11-21).
   - A move kept on the phone (no signal): the message says the question « Texter … ? » follows; « En attente d'envoi » on
     the stop's row and card; once the move reaches the server and its answer says the customer must be told (`tell`),
     the question is asked (nothing goes by itself: Hassan, 2026-11-22) and « Envoyer le texto » sends the « moved » text,
     once (rules F1, person F1).
   - A move of it still in the outbox (the job screen's own « Déplacer », or one kept before the app was reopened):
     « Déplacer » is not offered and the mark says why (rules F2). A « Je pars » still waiting on the phone: no
     « Déplacer » either (rules F6).
   - « À placer » rows have the menu (person F5). Moved: the message stays 6 s with « Voir » (person F2). The sheet
     closes when the stop goes under way meanwhile, and never comes back by itself (rules F3). Copied from the map: the
     message says it is pasted in the agenda (person F6). The « text to send by hand » sheet rises on the map when the
   texts are not connected (person F5, M16). The « ? » names « Déplacer » only for who may (person F7, M18).
   The server (team_map, move_job, notify), the outbox, the map itself and the moment picker are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const srv = vi.hoisted(() => ({
  answer: null as unknown, moves: [] as unknown[][], next: '', queued: false, notified: [] as unknown[][],
  outbox: [] as unknown[], done: [] as ((d: unknown) => void)[], textStatus: 'sent', tell: false
}));
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    rpcNow: async (name: string) => { if (name !== 'team_map') throw new Error('not pretended'); return srv.answer; },
    moveJob: async (...a: unknown[]) => {
      srv.moves.push(a);
      if (srv.queued) return { queued: true };
      const store = await import('../../data/store');
      const j = store.getRow<{ id: string } & Record<string, unknown>>('jobs', String(a[0]))!;
      store.replaceLocal('jobs', [{ ...j, day: a[1], block: a[2] }] as never);
      return { queued: false, data: { ok: true, changed: true, tell: srv.tell } };
    },
    notify: async (...a: unknown[]) => { srv.notified.push(a); return { ok: true, status: srv.textStatus, message: 'Bonjour Julie, votre rendez-vous est déplacé.', link: null, phone: '5145550100' }; }
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
vi.mock('../../shared/map/useRoads', () => ({ useRoads: () => 0, roadOf: () => [], roadTotal: () => null, roadState: () => 'known' }));
vi.mock('../../shared/moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void }) => h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick({ day: srv.next, block: 'am' }) }, 'pick') };
});

import MapScreen from './MapScreen';
import { ContextMenuHost } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll, getRow } from '../../data/store';
import { outbox, setNet } from '../../data/net';
import { access } from '../../data/auth';
import { wide } from '../../platform/media';
import { lang } from '../../lib/i18n';
import { today, addDays } from '../../lib/dates';
import { forgetTeamMaps } from '../../shared/map/useTeamMap';
import { movesWaiting } from '../../shared/jobs/moving';
import { moveOpenFor } from '../../shared/jobs/MoveHost';
import { clearTextAsks, TEXT_ASK_DEAD_MS } from '../../shared/jobs/textAsk';
import type { Access } from '../../data/types';

const TODAY = today();
srv.next = addDays(TODAY, 1);
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const sJob = (id: string, truck: string | null, status = 'booked') => ({ id, number: 7, truck_id: truck, order: truck ? 1 : null, eta_min: truck ? 600 : null, status, block: 'am', name: 'Julie Tremblay', address: '1250 rue Graham', lat: 45.52, lng: -73.64 });
const answerWith = (jobs: ReturnType<typeof sJob>[]) => ({
  home: { lat: 45.53, lng: -73.65, label: 'Centrale', address: '1401 rue Legendre' },
  trucks: [{ id: 't1', name: 'Camion Complet', color: '#D3000E', driver_id: null }],
  jobs, people: [], trips: []
});
const jobRow = (o: Record<string, unknown> = {}) => ({ id: 'j1', number: 7, customer_id: 'c1', truck_id: 't1', day: TODAY, block: 'am', status: 'booked', stop_order: 1, duration_min: 60, eta_min: 600, lat: 45.52, lng: -73.64, address: '1250 rue Graham', ...o });
function garage(o: { textOn?: boolean; truck?: string | null } = {}) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: false, min_block_min: 45, unknown_min: 20 }, messages: { on: { moved: o.textOn ?? true } } }] as never);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion Complet', active: true, sort: 1, color: '#D3000E', driver_id: null }] as never);
  replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Tremblay', phone: '5145550100', sms_ok: true }] as never);
  const truck = o.truck === undefined ? 't1' : o.truck;
  replaceLocal('jobs', [jobRow({ truck_id: truck, stop_order: truck ? 1 : null })] as never);
  srv.answer = answerWith([sJob('j1', truck)]);
}
const pendingMove = { op: 'o-move', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1', p_day: addDays(TODAY, 2), p_block: 'pm' }, at: '2026-11-21T10:00:00Z', tries: 0 };
const pendingLeave = { op: 'o-leave', kind: 'rpc', rpc: 'job_step', state: 'pending', args: { p_job: 'j1', p_action: 'leave' }, at: '2026-11-21T10:00:00Z', tries: 0 };

const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const rightClick = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40, button: 2 })); }); };
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
/** the outbox changed (the pending view of the job screens reads it again) */
const outboxChanged = async () => { await act(async () => { setNet({ pending: ++bump }); }); await settle(); };
async function show(who: Access) {
  access.value = who;
  await act(async () => { render(<><MapScreen params={{}} query={new URLSearchParams()} /><ContextMenuHost /></>, box); });
  await settle();
}
const closeMenu = () => act(() => { (document.querySelector('.agenda-menu-shade') as HTMLElement | null)?.click(); });

beforeEach(() => { lang.value = 'fr'; wide.value = true; srv.textStatus = 'sent'; srv.tell = false; srv.moves = []; srv.queued = false; srv.notified = []; srv.outbox = []; srv.done = []; forgetTeamMaps(); toasts.value = []; location.hash = '#/map'; });
afterEach(async () => { act(() => { clearTextAsks(); }); closeMenu(); act(() => render(null, box)); clearAll(); access.value = null; movesWaiting.value = new Set(); outbox.value = []; srv.outbox = []; await outboxChanged(); vi.useRealTimers(); });

describe('a move kept on the phone (no signal), from the card', () => {
  it('says the question follows, shows « En attente d’envoi » on the row and the card, and asks once the server has it (tell)', async () => {
    garage();
    srv.queued = true;
    srv.outbox = [pendingMove];
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    await click('fake-pick');
    await click('move-ok');
    expect(said()).toContain('Gardé sur le téléphone');
    expect(said()).toContain('Quand le déplacement sera envoyé, l’app te demandera s’il faut texter le client (si l’app reste ouverte).');
    expect(q('move-wait-j1')?.textContent).toBe('En attente d’envoi');
    expect(q('stop-j1')!.textContent).toContain('En attente d’envoi');
    expect(q('map-card')!.textContent).toContain('En attente d’envoi');
    expect(q('map-move')).toBeNull();
    expect(srv.notified).toEqual([]);
    // the move reaches the server: its answer says what the customer was told changed
    srv.outbox = [];
    await act(async () => { srv.done.forEach((r) => r({ ok: true, changed: true, tell: true })); });
    await settle(); await settle();
    // asked, not sent
    expect(srv.notified).toEqual([]);
    expect(q('move-wait-j1')).toBeNull();
    await answerTextAsk(true);
    expect(srv.notified.length).toBe(1);
    expect(srv.notified[0].slice(0, 2)).toEqual(['moved', 'j1']);
  });
  it('the server answers that the customer has nothing new to hear (tell: false): no text', async () => {
    garage();
    srv.queued = true;
    srv.outbox = [pendingMove];
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    await click('fake-pick');
    await click('move-ok');
    srv.outbox = [];
    await act(async () => { srv.done.forEach((r) => r({ ok: true, changed: false, tell: false })); });
    await settle(); await settle();
    expect(srv.notified).toEqual([]);
    expect(q('text-ask')).toBeNull();
    expect(movesWaiting.value.has('j1')).toBe(false);
  });
  it('the « moved » text off: the message says nothing of a text, and none goes', async () => {
    garage({ textOn: false });
    srv.queued = true;
    srv.outbox = [pendingMove];
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    await click('fake-pick');
    await click('move-ok');
    expect(said()).toContain('Gardé sur le téléphone');
    expect(said()).not.toMatch(/texto|texter/);
    srv.outbox = [];
    await act(async () => { srv.done.forEach((r) => r({ ok: true, changed: true, tell: true })); });
    await settle(); await settle();
    expect(srv.notified).toEqual([]);
    expect(q('text-ask')).toBeNull();
  });
});

describe('a move of it already waiting in the outbox, a step waiting on the phone', () => {
  it('a move_job still in the outbox (not marked by any screen): no « Déplacer » on the card nor in the menu, the mark says why', async () => {
    garage();
    await show(owner);
    act(() => { outbox.value = [pendingMove] as never; });
    await settle();
    expect(movesWaiting.value.size).toBe(0);
    await click('stop-j1');
    expect(q('map-move')).toBeNull();
    expect(q('move-wait-j1')).not.toBeNull();
    await rightClick(q('stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
    closeMenu();
    // it left: « Déplacer » is back
    act(() => { outbox.value = []; });
    await settle();
    expect(q('map-move')).not.toBeNull();
  });
  it('a « Je pars » still waiting on the phone: no « Déplacer » (the stop is on the way as this phone sees it)', async () => {
    garage();
    srv.outbox = [pendingLeave];
    await show(owner);
    await outboxChanged();
    await click('stop-j1');
    expect(q('map-card')).not.toBeNull();
    expect(q('map-move')).toBeNull();
    await rightClick(q('stop-j1')!);
    expect(q('menu-open')).not.toBeNull();
    expect(q('menu-move')).toBeNull();
  });
});

describe('the other rows, the message, the sheet left open', () => {
  it('« À placer »: its row has the menu with « Déplacer », the sheet on the map', async () => {
    garage({ truck: null });
    await show(owner);
    expect(q('stops-unplaced')).not.toBeNull();
    await rightClick(q('stop-j1')!);
    expect(q('menu-move')).not.toBeNull();
    await click('menu-move');
    expect(q('move-sheet')).not.toBeNull();
    expect(location.hash).toBe('#/map');
  });
  it('moved: the message stays 6 s with « Voir », which opens the appointment', async () => {
    garage({ textOn: false });
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    await click('fake-pick');
    srv.answer = answerWith([]);
    await click('move-ok');
    const m = toasts.value.find((x) => x.text.startsWith('Rendez-vous déplacé'))!;
    expect(m.ms).toBe(6000);
    expect(m.action?.label).toBe('Voir');
    act(() => { void m.action!.run(); });
    await settle(); await new Promise((r) => setTimeout(r, 50)); await settle();
    expect(location.hash).toBe('#/job/j1');
  });
  it('the stop goes under way while the sheet is open: the sheet closes and says why; it never comes back by itself', async () => {
    garage();
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    expect(q('move-sheet')).not.toBeNull();
    act(() => { replaceLocal('jobs', [{ ...getRow<{ id: string } & Record<string, unknown>>('jobs', 'j1')!, status: 'en_route' }] as never); });
    await settle();
    expect(q('move-sheet')).toBeNull();
    expect(moveOpenFor()).toBeNull();
    expect(said()).toContain('Seul un rendez-vous pas encore commencé se déplace.');
    act(() => { replaceLocal('jobs', [jobRow()] as never); });
    await settle();
    expect(q('move-sheet')).toBeNull();
  });
  it('the stop leaves the phone while the sheet is open: the sheet goes and does not rise again when it comes back', async () => {
    garage();
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    expect(q('move-sheet')).not.toBeNull();
    act(() => { replaceLocal('jobs', [] as never); });
    await settle();
    expect(q('move-sheet')).toBeNull();
    expect(moveOpenFor()).toBeNull();
    act(() => { replaceLocal('jobs', [jobRow()] as never); });
    await settle();
    expect(q('move-sheet')).toBeNull();
  });
  it('moved, the texts not connected: « Envoyer le texto », then the « text to send by hand » sheet rises on the map itself', async () => {
    garage();
    srv.tell = true;
    srv.textStatus = 'off';
    await show(owner);
    await click('stop-j1');
    await click('map-move');
    await click('fake-pick');
    srv.answer = answerWith([]);
    await click('move-ok');
    await answerTextAsk(true);
    expect(srv.notified.length).toBe(1);
    expect(q('text-outcome')).not.toBeNull();
    expect(q('text-outcome-message')?.textContent).toBe('Bonjour Julie, votre rendez-vous est déplacé.');
    expect(location.hash).toBe('#/map');
  });
  it('the « ? » of the map: phone first, « Déplacer » named for who may move, not for a mechanic without « Réserver »', async () => {
    const bubble = async () => {
      await act(async () => { (q('map-screen')!.querySelector('h1 .help') as HTMLElement).click(); });
      return document.querySelector('.help-pop')?.textContent ?? '';
    };
    garage();
    await show(owner);
    expect(await bubble()).toContain('le déplacer ou t’y rendre ; appui long sur un arrêt de la liste (à l’ordi : clic droit) : « Déplacer », « Appeler », « Itinéraire »…');
    act(() => render(null, box));
    await show({ id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true, map: true }, trucks: ['t1'] } as unknown as Access);
    const forMechanic = await bubble();
    expect(forMechanic).toContain('appui long sur un arrêt de la liste (à l’ordi : clic droit)');
    expect(forMechanic).not.toMatch(/[Dd]éplacer/);
  });
  it('« Copier le rendez-vous » from the map: the message says to paste it in the agenda', async () => {
    garage();
    await show(owner);
    await rightClick(q('stop-j1')!);
    await click('menu-copy-job');
    expect(said()).toContain('Dans l’agenda');
    expect(said()).toMatch(/^Rendez-vous de Julie copié\. Dans l’agenda : appui long/);
  });
});
