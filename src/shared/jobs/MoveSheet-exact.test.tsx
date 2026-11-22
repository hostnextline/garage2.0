/* « exact move » in « Déplacer » (STATE.md A1, A2, A4): with arrival windows, the time the picker showed is sent (a quarter
   hour of the calendar, a computer's grid or a phone's list; a best moment's « Vers … »), through the one flow: the
   preview, a question only when there is something to hear, the move to that minute never kept on the phone. Flexible
   and the blocks move as before. The picker and the server are pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { BlockChoice } from '../../domain/moment/choice';

const pick = vi.hoisted(() => ({ next: null as unknown }));
const api = vi.hoisted(() => ({ moveJob: vi.fn() }));
const exact = vi.hoisted(() => ({ exactPreview: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn() }));
const asking = vi.hoisted(() => ({ askMovedText: vi.fn((..._a: unknown[]) => true), sendText: vi.fn() }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/exact', async (orig) => ({ ...(await orig<object>()), ...exact }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<object>()), ...ui }));
vi.mock('./textAsk', async (orig) => ({ ...(await orig<object>()), askMovedText: asking.askMovedText }));
vi.mock('./texts', async (orig) => ({ ...(await orig<object>()), sendText: asking.sendText }));
vi.mock('../moment/BlockPicker', async () => {
  const { h } = await import('preact');
  return { BlockPicker: (p: { onPick: (c: unknown) => void }) => h('button', { type: 'button', 'data-testid': 'fake-pick', onClick: () => p.onPick(pick.next) }, 'pick') };
});

import { MoveSheet } from './MoveSheet';
import { toasts } from '../../ui/toast';
import { replaceLocal, clearAll, getRow } from '../../data/store';
import { access } from '../../data/auth';
import { setNet } from '../../data/net';
import { lang } from '../../lib/i18n';
import type { Access, Job } from '../../data/types';

const DAY = '2030-01-10';
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const JOB = { id: 'j1', number: 7, customer_id: 'c1', truck_id: 't1', day: DAY, block: 'day', status: 'booked', stop_order: 1, duration_min: 60, eta_min: 600, win_start: 540, win_end: 780, win_flex: false, lat: 45.52, lng: -73.64 };
const okAnswer = { exact: true, stops: [], overHours: 0, earliest: null, earliestKeep: null, refused: null };
const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
let closed = 0;
const sent: unknown[] = [];
async function open(choice: Partial<BlockChoice>) {
  pick.next = choice;
  await act(async () => { render(<MoveSheet job={getRow<Job>('jobs', 'j1')!} open onClose={() => { closed++; }} onSent={(r) => sent.push(r)} />, box); });
  await click('fake-pick');
}

beforeEach(() => {
  vi.clearAllMocks();
  lang.value = 'fr'; closed = 0; sent.length = 0; toasts.value = [];
  setNet({ online: true });
  access.value = owner;
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, win_before_min: 60, win_after_min: 180, win_round_min: 60, blocks: [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }] }, messages: { on: { moved: false } } }] as never);
  replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'T' }, { id: 'c2', first_name: 'Carla', last_name: 'C' }] as never);
  replaceLocal('jobs', [JOB, { ...JOB, id: 'j2', customer_id: 'c2', eta_min: 900, win_start: 840, win_end: 1080, stop_order: 2 }] as never);
  ui.ask.mockResolvedValue(true);
  exact.exactPreview.mockResolvedValue(okAnswer);
  api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, exact: true, tell: false } });
});
// Hassan, 2026-11-22 (« the system should ask me first »): « Déplacer » never sends the « moved » text itself
afterEach(() => { expect(asking.sendText).not.toHaveBeenCalled(); act(() => render(null, box)); clearAll(); access.value = null; });
const textOn = (on: boolean) => replaceLocal('settings', [{ ...getRow<{ id: string } & Record<string, unknown>>('settings', '1')!, messages: { on: { moved: on } } }] as never);
const asked = () => asking.askMovedText.mock.calls.map((c) => { expect(c[1]).toEqual({ via: 'jobs' }); return (c[0] as Job).id; });

describe('« Déplacer » sends the time it showed (A1)', () => {
  it('a quarter hour of the calendar: that very minute, its own truck, no second question when nobody is later', async () => {
    await open({ day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 795, truck: 't2' });
    await click('move-ok');
    expect(exact.exactPreview).toHaveBeenCalledWith('j1', '2030-01-11', null, 795);
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', '2030-01-11', 'day', null, { start: 720, flex: false, at: 795, lateOk: [] }]);
    expect(ui.ask).not.toHaveBeenCalled();
    expect(toasts.value.map((x) => x.text).join(' | ')).toMatch(/^Rendez-vous déplacé : .* à 13 h 15\.$/);
    expect(closed).toBe(1);
    expect(sent).toEqual([{ queued: false, data: { ok: true, exact: true, tell: false } }]);
  });
  it('a best moment: the « Vers … » its bar says (the nearest quarter hour of its window)', async () => {
    await open({ day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 787 });
    await click('move-ok');
    expect(api.moveJob.mock.calls[0][4]).toMatchObject({ at: 780 });
  });
  it('another quarter hour of its own window is a move; its very arrival is not', async () => {
    await open({ day: DAY, block: 'day', win_start: 540, win_end: 780, eta: 600 });
    expect((q('move-ok') as HTMLButtonElement).disabled).toBe(true);
    await open({ day: DAY, block: 'day', win_start: 540, win_end: 780, eta: 615 });
    expect((q('move-ok') as HTMLButtonElement).disabled).toBe(false);
    await click('move-ok');
    expect(api.moveJob.mock.calls[0][4]).toMatchObject({ start: 540, at: 615 });
  });
});

describe('its own truck does not work that day (review T1 / M16)', () => {
  it('the vehicle the calendar offered at that time is taken, SAID in the question, and the move goes on it', async () => {
    replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 0 }, { id: 't2', name: 'Voiture', active: true, sort: 1 }] as never);
    exact.exactPreview.mockResolvedValueOnce({ ...okAnswer, refused: 'pick_truck' }).mockResolvedValue(okAnswer);
    await open({ day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 795, truck: 't2' });
    await click('move-ok');
    expect(exact.exactPreview.mock.calls.map((c) => c[2])).toEqual([null, 't2']);
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect((ui.ask.mock.calls[0][0] as { text: string }).text.split('\n')[0]).toBe('Son camion ne travaille pas ce jour-là : la job va sur Voiture.');
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', '2030-01-11', 'day', 't2', { start: 720, flex: false, at: 795, lateOk: [] }]);
    expect(closed).toBe(1);
  });
});

describe('the one question in the sheet (A2)', () => {
  it('somebody late: who; « Choisir une autre heure » leaves the sheet open, nothing moved', async () => {
    exact.exactPreview.mockResolvedValue({ ...okAnswer, stops: [{ id: 'j2', day: '2030-01-11', truckId: 't1', orderBefore: 2, orderAfter: 2, etaBefore: 900, etaAfter: 1110, winStart: 840, winEnd: 1080, delay: 210, late: true, lateMin: 30, measured: null }] });
    ui.ask.mockResolvedValue(false);
    await open({ day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 780 });
    await click('move-ok');
    expect((ui.ask.mock.calls[0][0] as { title: string }).title).toBe('Déplacer Julie à 13 h met Carla en retard');
    expect(api.moveJob).not.toHaveBeenCalled();
    expect(closed).toBe(0);
    expect(q('move-sheet')).not.toBeNull();
  });
});

describe('no signal (A4) and what points no time', () => {
  it('a time shown, no signal: said, nothing kept on the phone, the sheet stays', async () => {
    setNet({ online: false });
    await open({ day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 795 });
    await click('move-ok');
    expect(api.moveJob).not.toHaveBeenCalled();
    expect(toasts.value.map((x) => x.text).join(' | ')).toMatch(/^Pas de réseau/);
    expect(closed).toBe(0);
  });
  it('« Flexible »: the move of before (no preview, no minute)', async () => {
    await open({ day: '2030-01-11', block: 'day', win_flex: true });
    await click('move-ok');
    expect(exact.exactPreview).not.toHaveBeenCalled();
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', '2030-01-11', 'day', null, { start: null, flex: true }]);
  });
});

describe('« Texter … ? » instead of the text (Hassan, 2026-11-22: « the system should ask me first »)', () => {
  it('a time shown, the window changed (tell): the question, never the text by itself', async () => {
    textOn(true);
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, exact: true, tell: true } });
    await open({ day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 795 });
    await click('move-ok');
    expect(closed).toBe(1);
    expect(asked()).toEqual(['j1']);
  });
  it('a time shown, the customer told nothing new (tell false): nothing asked', async () => {
    textOn(true);
    await open({ day: DAY, block: 'day', win_start: 540, win_end: 780, eta: 615 });
    await click('move-ok');
    expect(api.moveJob).toHaveBeenCalledTimes(1);
    expect(asked()).toEqual([]);
  });
  it('« Flexible » (the move of before), tell: the question; the switch « Rendez-vous changé » off: nothing asked', async () => {
    textOn(true);
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: true, tell: true } });
    await open({ day: '2030-01-11', block: 'day', win_flex: true });
    expect(q('move-sheet')!.textContent).toContain('Ensuite, l’app te demandera s’il faut texter le client.');
    await click('move-ok');
    expect(asked()).toEqual(['j1']);
    asking.askMovedText.mockClear();
    textOn(false);
    await open({ day: '2030-01-12', block: 'day', win_flex: true });
    expect(q('move-sheet')!.textContent).not.toMatch(/texto|texter/);
    await click('move-ok');
    expect(asked()).toEqual([]);
  });
  it('a move kept on the phone (no signal) asks nothing now: its question waits for the server (MoveHost, the agenda)', async () => {
    textOn(true);
    api.moveJob.mockResolvedValue({ queued: true });
    await open({ day: '2030-01-11', block: 'day', win_flex: true });
    await click('move-ok');
    expect(asked()).toEqual([]);
  });
});
