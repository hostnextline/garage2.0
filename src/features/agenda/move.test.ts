import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from '../../data/types';
import { lang } from '../../lib/i18n';

const api = vi.hoisted(() => ({ moveJob: vi.fn(), suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
const sync = vi.hoisted(() => ({ outboxList: vi.fn(), whenDone: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
const notify = vi.hoisted(() => ({ notifyCustomer: vi.fn(), wantsText: vi.fn() }));
const rows = vi.hoisted(() => ({ job: vi.fn(), customer: vi.fn() }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<object>()), ...sync }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<object>()), ...ui }));
vi.mock('../../shared/moment/notify', async (orig) => ({ ...(await orig<object>()), ...notify }));
vi.mock('../../data/select', async (orig) => ({ ...(await orig<object>()), ...rows }));

import { moveToWindow, moveFlow, moveToTime, movesWaiting, windowMove, moveSettled, farCheckDay } from './move';

const julie = (o: Partial<Job> = {}): Job => ({ id: 'j1', number: 7, day: '2026-11-20', block: 'day', status: 'booked', win_start: 540, win_end: 780, win_flex: false,
  truck_id: 't1', truck_pinned: false, duration_min: 60, lat: 45.5, lng: -73.6, customer_id: null, needs_machine: false, vehicle_kind: null, ...o } as Job);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  api.suggestBlocks.mockResolvedValue([]);
  ui.ask.mockResolvedValue(true);
  notify.wantsText.mockReturnValue(true);
  sync.outboxList.mockResolvedValue([]);
  movesWaiting.value = new Set();
  windowMove.value = null;
});

describe('a move from the agenda texts the customer when what they were told changed (agenda-01)', () => {
  it('a new window the same day: the server answers changed: false, the text still goes', async () => {
    const after = julie({ win_start: 840, win_end: 1080 });
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: false, rows: { jobs: [after] } } });
    expect(await moveToWindow(julie(), '2026-11-20', { start: 840 })).toBe(true);
    expect(notify.notifyCustomer).toHaveBeenCalledTimes(1);
    expect(notify.notifyCustomer).toHaveBeenCalledWith('moved', 'j1');
  });
  it('the time grid, same day, another hour: texted too', async () => {
    const after = julie({ win_start: 840, win_end: 1080 });
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: false, rows: { jobs: [after] } } });
    expect(await moveToTime(julie(), '2026-11-20', null, 900)).toBe(true);
    expect(notify.notifyCustomer).toHaveBeenCalledTimes(1);
  });
  it('« unchanged » (agenda-07): no text, and the toast says nothing changed', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, unchanged: true } });
    expect(await moveToWindow(julie({ win_flex: true }), '2026-11-20', { flex: true })).toBe(true);
    expect(notify.notifyCustomer).not.toHaveBeenCalled();
    expect(ui.toast.mock.calls[0][0]).not.toBe('Job déplacée');
  });
});

describe('the server’s « tell » decides the text when it gives it (R85)', () => {
  it('tell: true texts even when the answer has no row and the phone’s row is still as before', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: false, tell: true, window_changed: true } });
    rows.job.mockReturnValue(julie());
    expect(await moveToWindow(julie(), '2026-11-20', { start: 840 })).toBe(true);
    expect(notify.notifyCustomer).toHaveBeenCalledWith('moved', 'j1');
  });
  it('tell: false sends nothing even when the phone’s old row differs from the answer’s', async () => {
    // the phone still held 9 h – 13 h; the server had 14 h – 18 h already (what the customer was told) and keeps it
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: false, tell: false, rows: { jobs: [julie({ win_start: 840, win_end: 1080 })] } } });
    expect(await moveToWindow(julie(), '2026-11-20', { start: 840 })).toBe(true);
    expect(notify.notifyCustomer).not.toHaveBeenCalled();
  });
  it('a move kept on the phone follows the server’s « tell » once it lands', async () => {
    let land: (d: unknown) => void = () => {};
    api.moveJob.mockResolvedValue({ queued: true });
    sync.outboxList.mockResolvedValue([{ op: 'op1', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1' } }]);
    sync.whenDone.mockReturnValue(new Promise((r) => { land = r; }));
    await moveToWindow(julie(), '2026-11-22', { start: 540 });
    land({ ok: true, changed: true, tell: false, rows: { jobs: [julie({ day: '2026-11-22' })] } });
    await flush(); await flush();
    expect(notify.notifyCustomer).not.toHaveBeenCalled();
  });
  it('a server without « tell » (the live one before the rebuild): the rows decide, as before', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: true } });
    rows.job.mockReturnValue(julie());
    expect(await moveToWindow(julie(), '2026-11-21', { start: 540 })).toBe(true);
    expect(notify.notifyCustomer).toHaveBeenCalledWith('moved', 'j1');
  });
});

describe('a drop in the job’s own truck column (agenda-08)', () => {
  // « exact move » (STATE.md A1, S2): the column's truck is sent, its own column included (it stays on its truck)
  it('moves the time on its own truck, and promises no text when only the truck changes', async () => {
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: false, rows: { jobs: [julie({ win_start: 840 })] } } });
    await moveToTime(julie(), '2026-11-20', 't1', 900);
    expect(api.moveJob.mock.calls[0][3]).toBe('t1');
    await moveToTime(julie(), '2026-11-20', 't2', 540);
    const question = ui.ask.mock.calls[ui.ask.mock.calls.length - 1][0] as { text: string };
    expect(question.text).not.toMatch(/texto/i);
    expect(api.moveJob.mock.calls[1][3]).toBe('t2');
  });
});

describe('a move kept on the phone (agenda-02, agenda-14)', () => {
  it('texts once the server has it, and is not dragged again meanwhile', async () => {
    let land: (d: unknown) => void = () => {};
    api.moveJob.mockResolvedValue({ queued: true });
    sync.outboxList.mockResolvedValue([{ op: 'op1', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1' } }]);
    sync.whenDone.mockReturnValue(new Promise((r) => { land = r; }));
    expect(await moveToWindow(julie(), '2026-11-22', { start: 540 })).toBe(true);
    await flush();
    expect(notify.notifyCustomer).not.toHaveBeenCalled();
    expect(movesWaiting.value.has('j1')).toBe(true);
    land({ ok: true, changed: true, rows: { jobs: [julie({ day: '2026-11-22' })] } });
    await flush(); await flush();
    expect(notify.notifyCustomer).toHaveBeenCalledWith('moved', 'j1');
    expect(movesWaiting.value.has('j1')).toBe(false);
  });
  it('promises the text only while the app stays open: the wait lives in memory (hors-ligne-03)', async () => {
    api.moveJob.mockResolvedValue({ queued: true });
    sync.outboxList.mockResolvedValue([{ op: 'op1', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1' } }]);
    sync.whenDone.mockReturnValue(new Promise(() => {}));
    const was = lang.value;
    try {
      lang.value = 'fr';
      await moveToWindow(julie(), '2026-11-22', { start: 540 });
      expect(ui.toast.mock.calls[ui.toast.mock.calls.length - 1][0]).toContain('Le texto au client partira quand le déplacement sera envoyé, si l’app reste ouverte.');
      lang.value = 'en';
      await moveToWindow(julie(), '2026-11-22', { start: 540 });
      expect(ui.toast.mock.calls[ui.toast.mock.calls.length - 1][0]).toContain('The text to the customer goes once the move is sent, if the app stays open.');
    } finally { lang.value = was; }
  });
  it('sends no text when it is refused later', async () => {
    api.moveJob.mockResolvedValue({ queued: true });
    sync.outboxList.mockResolvedValue([{ op: 'op1', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1' } }]);
    sync.whenDone.mockReturnValue(Promise.reject(new Error('block_full')));
    await moveToWindow(julie(), '2026-11-22', { start: 540 });
    await flush(); await flush();
    expect(notify.notifyCustomer).not.toHaveBeenCalled();
    expect(movesWaiting.value.has('j1')).toBe(false);
  });
});

describe('refusals and « garde-route »', () => {
  it('a refused move says why, opens the windows when it is full, and leaves the outbox alone (agenda-21)', async () => {
    api.moveJob.mockRejectedValue(Object.assign(new Error('Plein'), { hint: 'window_full' }));
    expect(await moveToTime(julie(), '2026-11-21', null, 600)).toBe(false);
    expect(windowMove.value).toEqual({ jobId: 'j1', day: '2026-11-21', farDone: true });
    expect(sync.outboxList).not.toHaveBeenCalled();
  });
  it('asks « Beaucoup de route ce jour-là » before a drag to a far place, and does not move when refused (agenda-03)', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: '2026-11-21', block: 'pm', far: 'day', day_min: 140 }]);
    ui.ask.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await moveFlow(julie({ block: 'am' }), { day: '2026-11-21', block: 'pm' })).toBe(false);
    expect(ui.ask).toHaveBeenCalledTimes(2);
    expect(api.moveJob).not.toHaveBeenCalled();
  });
  it('moves without a warning when the check does not answer', async () => {
    api.suggestBlocks.mockRejectedValue(new Error('offline'));
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: true } });
    expect(await moveFlow(julie({ block: 'am' }), { day: '2026-11-21', block: 'pm' })).toBe(true);
    expect(ui.ask).toHaveBeenCalledTimes(1);
  });
});

describe('waiting for a move kept on the phone, without losing the answer (review TA-3)', () => {
  const entry = { op: 'op1', kind: 'rpc', rpc: 'move_job', state: 'pending', args: { p_job: 'j1' } };
  it('ends when the send finished between reading the outbox and starting to wait (the wait is never answered)', async () => {
    sync.outboxList.mockResolvedValueOnce([entry]).mockResolvedValueOnce([]);
    sync.whenDone.mockReturnValue(new Promise(() => {}));
    expect(await moveSettled('j1')).toEqual({ kind: 'gone' });
  });
  it('ends as refused when the send was refused in between', async () => {
    sync.outboxList.mockResolvedValueOnce([entry]).mockResolvedValueOnce([{ ...entry, state: 'failed' }]);
    sync.whenDone.mockReturnValue(new Promise(() => {}));
    expect(await moveSettled('j1')).toEqual({ kind: 'refused' });
  });
  it('gives the server’s answer when the wait was set in time', async () => {
    sync.outboxList.mockResolvedValue([entry]);
    sync.whenDone.mockResolvedValue({ ok: true, changed: true });
    expect(await moveSettled('j1')).toEqual({ kind: 'done', data: { ok: true, changed: true } });
  });
  it('the race: the move leaves the phone before the wait, the text still goes and the job can be dragged again', async () => {
    api.moveJob.mockResolvedValue({ queued: true });
    rows.job.mockReturnValue(julie({ day: '2026-11-22' }));
    sync.outboxList.mockResolvedValueOnce([entry]).mockResolvedValueOnce([]);
    sync.whenDone.mockReturnValue(new Promise(() => {}));
    await moveToWindow(julie(), '2026-11-22', { start: 540 });
    await flush(); await flush();
    expect(notify.notifyCustomer).toHaveBeenCalledWith('moved', 'j1');
    expect(movesWaiting.value.has('j1')).toBe(false);
  });
  it('an unreadable outbox clears the « waiting » mark, with or without a text, and nothing is left unhandled', async () => {
    api.moveJob.mockResolvedValue({ queued: true });
    sync.outboxList.mockRejectedValue(new Error('IDB closed'));
    await moveToWindow(julie(), '2026-11-22', { start: 540 });
    await flush(); await flush();
    expect(movesWaiting.value.has('j1')).toBe(false);
    notify.wantsText.mockReturnValue(false);
    await moveToWindow(julie(), '2026-11-22', { start: 600 });
    await flush(); await flush();
    expect(movesWaiting.value.has('j1')).toBe(false);
  });
});

describe('« Beaucoup de route » asked once for one move (review TA-5)', () => {
  it('the sheet opened after a drop that did not fit does not ask it again', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: '2026-11-21', block: 'day', far: 'day', day_min: 140 }]);
    api.moveJob.mockRejectedValueOnce(Object.assign(new Error('Plein'), { hint: 'window_full' }));
    expect(await moveToTime(julie(), '2026-11-21', null, 600)).toBe(false);
    expect(ui.ask).toHaveBeenCalledTimes(2);            // the move, then « Beaucoup de route »
    expect(windowMove.value?.farDone).toBe(true);
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: true } });
    ui.ask.mockClear(); api.suggestBlocks.mockClear();
    expect(await moveToWindow(julie(), '2026-11-21', { start: 780 }, null)).toBe(true);
    expect(ui.ask).not.toHaveBeenCalled();
    expect(api.suggestBlocks).not.toHaveBeenCalled();
  });
  it('the sheet asks the question it started when it opened, without asking the server again at the pick', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: '2026-11-21', block: 'day', far: 'day', day_min: 140 }]);
    api.moveJob.mockResolvedValue({ queued: false, data: { ok: true, changed: true } });
    const far = farCheckDay(julie(), '2026-11-21');
    ui.ask.mockResolvedValueOnce(false);
    expect(await moveToWindow(julie(), '2026-11-21', { start: 780 }, far)).toBe(false);
    expect(api.suggestBlocks).toHaveBeenCalledTimes(1);
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(api.moveJob).not.toHaveBeenCalled();
  });
});
