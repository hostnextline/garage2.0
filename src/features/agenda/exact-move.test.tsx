/* « exact move » on the agenda (Hassan, 2026-11-21: « move exactly where I point, the rest stays the same »; STATE.md A1,
   A3, A4, A5): a job let go on a unit of the hour grid is moved to arrive at THAT minute, on the column's truck, through
   the one flow (the preview first, ONE question); it stays where it was let go through the question and the send, and
   the server's rows then leave it there (no jump); a new quarter hour inside the same window is a real move; no signal:
   said, nothing kept on the phone; the window list sends the arrival its row showed. The server is pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Job } from '../../data/types';

const api = vi.hoisted(() => ({ moveJob: vi.fn(), suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
const exact = vi.hoisted(() => ({ exactPreview: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
const notify = vi.hoisted(() => ({ notifyCustomer: vi.fn(), wantsText: vi.fn() }));
const textAsk = vi.hoisted(() => ({ askMovedText: vi.fn((..._a: unknown[]) => true) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/exact', async (orig) => ({ ...(await orig<object>()), ...exact }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<object>()), ...ui }));
vi.mock('../../shared/moment/notify', async (orig) => ({ ...(await orig<object>()), ...notify }));
vi.mock('../../shared/jobs/textAsk', async (orig) => ({ ...(await orig<object>()), ...textAsk }));

import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { setNet } from '../../data/net';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';
import { moveToTime, moveToWindow, landings, landingOf, windowMove, samePlace } from './move';
import { GridColumn } from './TimeGrid';
import { makeDrag, canDragJob } from './drag';

const DAY = '2030-01-10';
const julie = (o: Partial<Job> = {}): Job => ({ id: 'j1', number: 7, day: DAY, block: 'day', status: 'booked', win_start: 540, win_end: 780, win_flex: false, eta_min: 600,
  truck_id: 't1', truck_pinned: false, duration_min: 60, lat: 45.5, lng: -73.6, customer_id: 'c-julie', needs_machine: false, vehicle_kind: null, stop_order: 1, ...o } as Job);
const ok = (o: Record<string, unknown> = {}) => ({ exact: true, stops: [{ id: 'j1', etaBefore: 600, etaAfter: 780, delay: 0, late: false, lateMin: 0, measured: null, day: DAY, truckId: 't1', orderBefore: 1, orderAfter: 1, winStart: 720, winEnd: 960 }], overHours: 0, earliest: null, earliestKeep: null, refused: null, ...o });
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;

beforeEach(() => {
  vi.clearAllMocks();
  lang.value = 'fr';
  setNet({ online: true });
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, win_before_min: 60, win_after_min: 180, win_round_min: 60, blocks: [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }] }, messages: { on: { moved: true } } } as never]);
  replaceLocal('customers', [{ id: 'c-julie', first_name: 'Julie', last_name: 'B' }, { id: 'c-carla', first_name: 'Carla', last_name: 'C' }] as never);
  replaceLocal('jobs', [julie(), { ...julie(), id: 'j2', customer_id: 'c-carla', eta_min: 840, win_start: 780, win_end: 1020, stop_order: 2 }] as never);
  ui.ask.mockResolvedValue(true);
  notify.wantsText.mockReturnValue(true);
  api.suggestBlocks.mockResolvedValue([]);
  exact.exactPreview.mockResolvedValue(ok());
  landings.value = new Map();
  windowMove.value = null;
});
// Hassan, 2026-11-22 (« the system should ask me first »): a move never texts by itself, it asks « Texter … ? »
afterEach(() => { expect(notify.notifyCustomer).not.toHaveBeenCalled(); clearAll(); access.value = null; landings.value = new Map(); });
const asked = () => textAsk.askMovedText.mock.calls.map((c) => { expect(c[1]).toMatchObject({ via: 'notify' }); return (c[0] as Job).id; });

describe('a job let go on the hour grid (A1)', () => {
  it('asks the preview of THAT minute on the column’s truck (its own column too), then moves it there exactly, never kept on the phone', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, exact: true, tell: true, rows: { jobs: [julie({ eta_min: 795, win_start: 720, win_end: 960 })] } } });
    expect(await moveToTime(julie(), DAY, 't1', 795)).toBe(true);
    expect(exact.exactPreview).toHaveBeenCalledWith('j1', DAY, 't1', 795);
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', DAY, 'day', 't1', { start: 720, flex: false, at: 795, lateOk: [] }]);
    // ONE question, true words: the window told to the customer stays the garage's rule (13 h 15 → 12 h – 16 h)
    expect(ui.ask).toHaveBeenCalledTimes(1);
    const q = ui.ask.mock.calls[0][0] as { title: string; text: string };
    expect(q.title).toMatch(/^Déplacer la job de Julie : .* à 13 h 15 \?$/);
    expect(q.text.split('\n')[0]).toBe('Sa plage : entre 12 h et 16 h. Les autres arrêts gardent leur heure.');
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatch(/^Rendez-vous déplacé : .* à 13 h 15\.$/);
    // the window changed: « Texter Julie ? » (nothing goes by itself)
    expect(asked()).toEqual(['j1']);
  });
  it('the week’s column is a day: no truck sent, the server keeps its own', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true } });
    await moveToTime(julie(), DAY, null, 900);
    expect(exact.exactPreview).toHaveBeenCalledWith('j1', DAY, null, 900);
    expect(api.moveJob.mock.calls[0][3]).toBe(null);
  });
  it('a new quarter hour inside the same window is a real move; the very same arrival is not', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, tell: false } });
    // 10 h → 10 h 15: the same window 9 h – 13 h for the customer, but a move (and no text: they were told nothing new)
    expect(await moveToTime(julie(), DAY, 't1', 615)).toBe(true);
    expect(api.moveJob).toHaveBeenCalledTimes(1);
    expect(asked()).toEqual([]);
    const q = ui.ask.mock.calls[0][0] as { text: string };
    expect(q.text).not.toMatch(/texto/i);
    api.moveJob.mockClear(); ui.ask.mockClear();
    expect(await moveToTime(julie(), DAY, 't1', 600)).toBe(false);
    expect(ui.toast.mock.calls.at(-1)?.[0]).toBe('Julie arrive déjà à 10 h.');
    expect(api.moveJob).not.toHaveBeenCalled();
    expect(samePlace(julie(), { day: DAY, truck: null, at: 600 })).toBe(true);
    expect(samePlace(julie(), { day: DAY, truck: 't2', at: 600 })).toBe(false);
  });
});

describe('it stays where it was let go (A3)', () => {
  it('held at the drop through the question and the send, its block dimmed; the server’s rows then leave it there', async () => {
    let answer: (v: unknown) => void = () => {};
    let question: (v: boolean) => void = () => {};
    ui.ask.mockImplementation(() => new Promise((r) => { question = r; }));
    api.moveJob.mockImplementation(() => new Promise((r) => { answer = r; }));
    access.value = owner;
    const box = document.createElement('div');
    document.body.appendChild(box);
    const drag = { job: null, ...makeDrag(() => {}) };
    const draw = () => act(() => render(<GridColumn day={DAY} span={[480, 1200]} truckId="t1" on={null} places={[{ block: 'day', start: 480, end: 1200, v: { started: false, open: true } }]}
      jobs={[julie()]} compact={false} drag={drag} />, box));
    draw();
    const flow = moveToTime(julie(), DAY, 't1', 795);
    await new Promise((r) => setTimeout(r, 0));
    draw();
    // the question is on screen: the job is drawn at 13 h 15 with the window told, its old block dimmed
    const held = box.querySelector('[data-testid="grid-held-j1"]') as HTMLElement;
    expect(held.textContent).toBe('13 h 1512 h – 16 h');
    expect(held.style.top).toBe('calc(var(--u) * 21)');
    expect(box.querySelector('[data-testid="grid-job-j1"]')?.classList.contains('is-dragging')).toBe(true);
    question(true);
    await new Promise((r) => setTimeout(r, 0));
    // being sent: still held there
    expect(landingOf('j1')).toMatchObject({ jobId: 'j1', minute: 795, column: 't1' });
    answer({ queued: false, data: { ok: true } });
    await flow;
    draw();
    expect(landings.value.size).toBe(0);
    expect(box.querySelector('[data-testid="grid-held-j1"]')).toBeNull();
    act(() => render(null, box));
    box.remove();
  });
  it('held in the very box its block will have: a minute off the quarter hour, and at the end of the day', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const drag = { job: null, ...makeDrag(() => {}) };
    const at = (minute: number, jobs: Job[]) => {
      landings.value = new Map([['j1', { jobId: 'j1', day: DAY, column: 't1', minute, duration: 60 }]]);
      act(() => render(<GridColumn day={DAY} span={[480, 1200]} truckId="t1" on={null} places={[{ block: 'day', start: 480, end: 1200, v: { started: false, open: true } }]}
        jobs={jobs} compact={false} drag={drag} />, box));
      return (box.querySelector('[data-testid="grid-held-j1"]') as HTMLElement).style.top;
    };
    // 10 h 22 (« Mettre à … »): where the block is drawn once the server's rows say 10 h 22
    const top = at(622, [julie()]);
    landings.value = new Map();
    act(() => render(<GridColumn day={DAY} span={[480, 1200]} truckId="t1" on={null} places={[{ block: 'day', start: 480, end: 1200, v: { started: false, open: true } }]}
      jobs={[julie({ eta_min: 622 })]} compact={false} drag={drag} />, box));
    expect((box.querySelector('[data-testid="grid-job-j1"]') as HTMLElement).style.top).toBe(top);
    expect(top).not.toBe('calc(var(--u) * 9)');
    // 19 h 45 for an hour of work: kept inside the day like the block (no jump up when it lands)
    expect(at(1185, [julie()])).toBe('calc(var(--u) * 44)');
    act(() => render(null, box));
    box.remove();
    landings.value = new Map();
  });
  it('the ghost under the pointer is drawn in the same box as the held block: no jump at the drop at the end of the day (review L1)', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const drag = { job: julie(), ...makeDrag(() => {}) };
    drag.hover({ key: `${DAY}|t1`, minute: 1185, ok: true }, null, true);
    act(() => render(<GridColumn day={DAY} span={[480, 1200]} truckId="t1" on={null} places={[{ block: 'day', start: 480, end: 1200, v: { started: false, open: true } }]}
      jobs={[julie()]} compact={false} drag={drag} />, box));
    const ghost = box.querySelector('.agenda-grid-ghost:not(.is-held)') as HTMLElement;
    // 19 h 45 for an hour of work: kept inside the day, like the held box and the block (44 = (1200 - 60 - 480) / 15)
    expect(ghost.style.top).toBe('calc(var(--u) * 44)');
    act(() => render(null, box));
    box.remove();
  });
  it('« Mettre à … » (the truck cannot be there): the held block goes to that minute; « Choisir une autre heure »: gone, nothing moved', async () => {
    exact.exactPreview.mockResolvedValueOnce(ok({ refused: 'arrive_late', stops: [], earliest: 622, earliestKeep: null })).mockResolvedValueOnce(ok());
    const seen: (number | undefined)[] = [];
    api.moveJob.mockImplementation(async () => { seen.push(landings.peek().get('j1')?.minute); return { queued: false, data: { ok: true } }; });
    await moveToTime(julie(), DAY, 't1', 600 - 30);
    expect(seen).toEqual([622]);
    expect(api.moveJob.mock.calls[0][4]).toMatchObject({ at: 622 });
    ui.ask.mockResolvedValue(false);
    api.moveJob.mockClear();
    expect(await moveToTime(julie(), DAY, 't1', 900)).toBe(false);
    expect(landings.value.size).toBe(0);
    expect(api.moveJob).not.toHaveBeenCalled();
  });
});

describe('two drops one after the other (review F2)', () => {
  it('B let go while A is still being sent: A stays held where it was dropped and cannot be dragged again until its own move ends', async () => {
    access.value = owner;
    const carla = { ...julie(), id: 'j2', customer_id: 'c-carla', eta_min: 840, win_start: 780, win_end: 1020, stop_order: 2 } as Job;
    let answerA: (v: unknown) => void = () => {};
    let answerB: (v: unknown) => void = () => {};
    api.moveJob.mockImplementationOnce(() => new Promise((r) => { answerA = r; })).mockImplementationOnce(() => new Promise((r) => { answerB = r; }));
    const box = document.createElement('div');
    document.body.appendChild(box);
    const drag = { job: null, ...makeDrag(() => {}) };
    const draw = () => act(() => render(<GridColumn day={DAY} span={[480, 1200]} truckId="t1" on={null} places={[{ block: 'day', start: 480, end: 1200, v: { started: false, open: true } }]}
      jobs={[julie(), carla]} compact={false} drag={drag} />, box));
    const a = moveToTime(julie(), DAY, 't1', 795);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(api.moveJob).toHaveBeenCalledTimes(1);
    const b = moveToTime(carla, DAY, 't1', 960);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    draw();
    // both held at their drop, both dimmed at their old place, neither draggable meanwhile
    expect(box.querySelector('[data-testid="grid-held-j1"]')?.textContent).toBe('13 h 1512 h – 16 h');
    expect(box.querySelector('[data-testid="grid-held-j2"]')?.textContent).toBe('16 h15 h – 19 h');
    expect(box.querySelector('[data-testid="grid-job-j1"]')?.classList.contains('is-dragging')).toBe(true);
    expect(canDragJob(julie())).toBe(false);
    expect(canDragJob(carla)).toBe(false);
    // A's answer: A is let go, B still held
    answerA({ queued: false, data: { ok: true } });
    await a;
    draw();
    expect(box.querySelector('[data-testid="grid-held-j1"]')).toBeNull();
    expect(box.querySelector('[data-testid="grid-held-j2"]')).not.toBeNull();
    expect(canDragJob(julie())).toBe(true);
    expect(canDragJob(carla)).toBe(false);
    answerB({ queued: false, data: { ok: true } });
    await b;
    draw();
    expect(box.querySelector('[data-testid="grid-held-j2"]')).toBeNull();
    act(() => render(null, box));
    box.remove();
  });
});

describe('no signal (A4)', () => {
  it('a drop on the grid is said and kept nowhere: no preview, no move, the block back where it was', async () => {
    setNet({ online: false });
    expect(await moveToTime(julie(), DAY, 't1', 900)).toBe(false);
    expect(exact.exactPreview).not.toHaveBeenCalled();
    expect(api.moveJob).not.toHaveBeenCalled();
    expect(ui.toast.mock.calls[0][0]).toMatch(/^Pas de réseau/);
    expect(landings.value.size).toBe(0);
  });
  it('a window row with no arrival, « Flexible »: kept on the phone as today', async () => {
    setNet({ online: false });
    api.moveJob.mockResolvedValue({ queued: true });
    expect(await moveToWindow(julie(), DAY, { start: 780 }, null)).toBe(true);
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', DAY, 'day', null, { start: 780 }]);
    expect(exact.exactPreview).not.toHaveBeenCalled();
  });
});

describe('the late customers named; the refusals (A2, A5)', () => {
  // Part 28 (REARRANGE.md §3.6, §4.4): a day other than today, « les plages » allowed to move: Carla's new window leaves
  // with « Envoyer les heures aux clients » (said in the question and after the move); the app texts her nothing
  it('somebody late: the warning first (with her new window); moved anyway, the message says it goes with the day’s button (the app texts them nothing)', async () => {
    exact.exactPreview.mockResolvedValue(ok({ stops: [ok().stops[0], { id: 'j2', day: DAY, truckId: 't1', orderBefore: 2, orderAfter: 2, etaBefore: 840, etaAfter: 1050, winStart: 780, winEnd: 1020, delay: 210, late: true, lateMin: 30, measured: null }] }));
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, exact: true, tell: false, stops: [{ id: 'j2', eta_after: 1050, late: true, late_min: 30 }] } });
    await moveToTime(julie(), DAY, 't1', 780);
    expect((ui.ask.mock.calls[0][0] as { title: string }).title).toBe('Déplacer Julie à 13 h met Carla en retard');
    expect(api.moveJob.mock.calls[0][4]).toMatchObject({ lateOk: ['j2'] });
    expect((ui.ask.mock.calls[0][0] as { text: string }).text.split('\n')[0]).toBe('Carla : vers 17 h 30, 30 min après sa plage (13 h à 17 h). Il aura 16 h à 20 h avec « Envoyer les heures aux clients ».');
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatch(/Carla aura une nouvelle plage : elle part avec « Envoyer les heures aux clients »\.$/);
    expect(asked()).toEqual([]);
  });
  it('« ça ne rentre pas » or its truck does not work that day: the windows still possible open, as before', async () => {
    api.moveJob.mockRejectedValue(Object.assign(new Error('Plein'), { hint: 'window_full' }));
    expect(await moveToTime(julie(), '2030-01-11', null, 600)).toBe(false);
    expect(windowMove.value).toEqual({ jobId: 'j1', day: '2030-01-11', farDone: true });
    windowMove.value = null;
    exact.exactPreview.mockResolvedValue(ok({ refused: 'pick_truck', stops: [] }));
    expect(await moveToTime(julie(), '2030-01-11', null, 600)).toBe(false);
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatch(/camion/);
    expect(windowMove.value).toMatchObject({ jobId: 'j1', day: '2030-01-11' });
  });
});

describe('the agenda’s window list (A1)', () => {
  it('a row that showed its arrival moves there exactly (its own truck; the row’s vehicle only when its own does not work)', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true } });
    expect(await moveToWindow(julie(), '2030-01-11', { start: 780, at: 845, truck: 't2' }, null)).toBe(true);
    expect(exact.exactPreview).toHaveBeenCalledWith('j1', '2030-01-11', null, 845);
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', '2030-01-11', 'day', null, { start: 780, flex: false, at: 845, lateOk: [] }]);
    // the tap is the choice: no second question when nobody is late
    expect(ui.ask).not.toHaveBeenCalled();
  });
});

/* review F1 (2026-11-21): a row of the list is a WINDOW the server tried; its arrival is the planner's with that window held
   (the truck free before it opens: eta = its start; late in it: near its end). An exact move tells the customer the
   garage's window of the minute sent (S2), so the row must send, and print, a minute whose window IS the row's: its own
   arrival when that gives the row's window, else the nearest quarter hour that does (the « Vers … » of the best moments). */
describe('the agenda’s window list: what the row prints is what is sent, and the window told is the row’s (review F1)', () => {
  it('the sheet itself: a row whose arrival gives another window sends the nearest quarter hour of ITS window, printed on it', async () => {
    const { MoveWindowHost } = await import('./MoveWindowSheet');
    api.suggestWindows.mockResolvedValue([
      { day: '2030-01-11', block: 'day', win_start: 720, win_end: 960, eta: 720, truck: 't1' },
      { day: '2030-01-11', block: 'day', win_start: 840, win_end: 1080, eta: 1040 },
      { day: '2030-01-11', block: 'day', win_start: 780, win_end: 1020, eta: 845 }
    ]);
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true } });
    const box = document.createElement('div');
    document.body.appendChild(box);
    windowMove.value = { jobId: 'j1', day: '2030-01-11' };
    await act(async () => { render(<MoveWindowHost />, box); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const row = (s: number) => document.querySelector(`[data-testid="move-window-${s}"]`) as HTMLButtonElement;
    // 12 h – 16 h, the planner at 12 h (window 11 h – 15 h): the row says, and sends, 12 h 30
    expect(row(720).textContent).toContain('Arrivée vers 12 h 30');
    // 14 h – 18 h, the planner at 17 h 20 (window 16 h – 20 h): 15 h 15, the latest quarter hour of 14 h – 18 h
    expect(row(840).textContent).toContain('Arrivée vers 15 h 15');
    // 13 h – 17 h, the planner at 14 h 05: that very minute (its window is the row's)
    expect(row(780).textContent).toContain('Arrivée vers 14 h 05');
    await act(async () => { row(720).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(exact.exactPreview).toHaveBeenCalledWith('j1', '2030-01-11', null, 750);
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', '2030-01-11', 'day', null, { start: 720, flex: false, at: 750, lateOk: [] }]);
    act(() => render(null, box));
    box.remove();
    windowMove.value = null;
  });
  it('its own window that day: another arrival in it is a real move (as on the grid), its very arrival is not (review L4)', async () => {
    const { MoveWindowHost } = await import('./MoveWindowSheet');
    // Julie: 9 h – 13 h, planned 10 h; the server's rows for the same day: its window with 10 h 15, and 13 h – 17 h
    api.suggestWindows.mockResolvedValueOnce([
      { day: DAY, block: 'day', win_start: 540, win_end: 780, eta: 615 },
      { day: DAY, block: 'day', win_start: 780, win_end: 1020, eta: 845 }
    ]).mockResolvedValueOnce([{ day: DAY, block: 'day', win_start: 540, win_end: 780, eta: 600 }]);
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true } });
    const box = document.createElement('div');
    document.body.appendChild(box);
    const row = (s: number) => document.querySelector(`[data-testid="move-window-${s}"]`) as HTMLButtonElement;
    windowMove.value = { jobId: 'j1', day: DAY };
    await act(async () => { render(<MoveWindowHost />, box); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(row(540).textContent).toContain('Plage actuelle');
    expect(row(540).disabled).toBe(false);
    await act(async () => { row(540).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', DAY, 'day', null, { start: 540, flex: false, at: 615, lateOk: [] }]);
    act(() => render(null, box));
    // the row says its very arrival (10 h): nothing to change there
    windowMove.value = null; windowMove.value = { jobId: 'j1', day: DAY };
    await act(async () => { render(<MoveWindowHost />, box); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(row(540).disabled).toBe(true);
    act(() => render(null, box));
    box.remove();
    windowMove.value = null;
  });
  it('moveToWindow never tells another window than the row’s: an arrival of another window is brought into the row’s', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true } });
    await moveToWindow(julie(), '2030-01-11', { start: 720, at: 940, truck: null }, null);
    expect(api.moveJob.mock.calls[0][4]).toEqual({ start: 720, flex: false, at: 795, lateOk: [] });
  });
});
