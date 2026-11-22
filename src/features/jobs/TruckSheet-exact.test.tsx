/* « Changer de camion » keeps the appointment's time (« exact move », STATE.md A1): with arrival windows, the other truck
   gets it at the very time it has (its arrival, when that arrival gives the window the customer has), through the one
   flow; switch « Vraies routes » on, each truck says it from the exact preview of that minute. « Laisser l'app choisir »
   and a time that would cut the customer a new window: the move of before. The server is pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const h = vi.hoisted(() => ({ preview: vi.fn(), move: vi.fn(), exact: vi.fn(), ask: vi.fn() }));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<object>()), movePreview: h.preview }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), moveJob: h.move }));
vi.mock('../../data/exact', async (orig) => ({ ...(await orig<object>()), exactPreview: h.exact }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<object>()), ask: h.ask }));
const asking = vi.hoisted(() => ({ askMovedText: vi.fn((..._a: unknown[]) => true), sendText: vi.fn() }));
vi.mock('../../shared/jobs/textAsk', async (orig) => ({ ...(await orig<object>()), askMovedText: asking.askMovedText }));
vi.mock('../../shared/jobs/texts', async (orig) => ({ ...(await orig<object>()), sendText: asking.sendText }));

import { TruckSheet } from './TruckSheet';
import { replaceLocal, clearAll } from '../../data/store';
import { setNet } from '../../data/net';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';
import { addDays, dow, today } from '../../lib/dates';
import type { Job } from '../../data/types';

const DAY = (() => { let d = addDays(today(), 2); while ([0, 6].includes(dow(d))) d = addDays(d, 1); return d; })();
const J = (o: Partial<Job> = {}) => ({ id: 'j1', number: 1, customer_id: null, truck_id: 't1', truck_pinned: false, day: DAY, block: 'day', status: 'booked', stop_order: 1, duration_min: 60, travel_min: 30,
  eta_min: 795, win_start: 720, win_end: 960, win_flex: false, deleted_at: null, ...o }) as unknown as Job;
function seed(roadsOn: boolean) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, win_before_min: 60, win_after_min: 180, win_round_min: 60, horizon_days: 120, unknown_min: 20, min_block_min: 45, roads_on: roadsOn,
    blocks: [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }] } } as never]);
  replaceLocal('trucks', ['t1', 't2', 't3'].map((id, i) => ({ id, name: `Camion ${i + 1}`, active: true, sort: i, color: '#D3000E', driver_id: null, tire_machine: true })) as never);
  replaceLocal('truck_week', ['t1', 't2', 't3'].flatMap((id) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: `${id}${d}`, truck_id: id, dow: d, ranges: [[480, 1200]] }))) as never);
  replaceLocal('truck_days', []);
}
const OK = { exact: true, stops: [], overHours: 0, earliest: null, earliestKeep: null, refused: null };
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 6; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0))); };
let closed = 0;
async function show(j: Job) { replaceLocal('jobs', [j] as never); await act(async () => { render(<TruckSheet job={j} open onClose={() => { closed++; }} />, box); }); await settle(); }
const tap = async (id: string) => { await act(async () => { q(id)!.click(); }); await settle(); };

beforeEach(() => {
  vi.clearAllMocks(); lang.value = 'fr'; closed = 0; toasts.value = [];
  setNet({ online: true });
  h.preview.mockImplementation(() => new Promise(() => undefined));
  h.exact.mockResolvedValue(OK);
  h.move.mockResolvedValue({ queued: false, data: { ok: true, exact: true, tell: false } });
  h.ask.mockResolvedValue(true);
});
// Hassan, 2026-11-22 (« the system should ask me first »): « Changer de camion » never sends the « moved » text itself
afterEach(() => { expect(asking.sendText).not.toHaveBeenCalled(); render(null, box); clearAll(); });

describe('the other truck at the very time it has (A1)', () => {
  it('a tap: the preview of that minute on that truck, then the move there at that minute; the message says it kept its time', async () => {
    seed(false);
    await show(J());
    await tap('truck-pick-t2');
    expect(h.exact).toHaveBeenCalledWith('j1', DAY, 't2', 795);
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'day', 't2', { start: 720, flex: false, at: 795, lateOk: [] }]);
    expect(h.ask).not.toHaveBeenCalled();
    expect(toasts.value.map((x) => x.text).join(' | ')).toBe('Rendez-vous passé à Camion 2, toujours à 13 h 15.');
    expect(closed).toBe(1);
  });
  it('« Mettre à … » on that truck: the message says the NEW time, never « toujours à » (review F5)', async () => {
    seed(false);
    h.exact.mockResolvedValueOnce({ ...OK, refused: 'arrive_late', earliest: 840, earliestKeep: 840 }).mockResolvedValue(OK);
    await show(J());
    await tap('truck-pick-t2');
    expect(h.ask).toHaveBeenCalledTimes(1);
    expect((h.ask.mock.calls[0][0] as { text: string }).text).toContain('À 14 h, la plage dite au client devient : entre 13 h et 17 h.');
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'day', 't2', { start: 780, flex: false, at: 840, lateOk: [] }]);
    expect(toasts.value.map((x) => x.text).join(' | ')).toBe('Rendez-vous passé à Camion 2, maintenant à 14 h (au lieu de 13 h 15).');
  });
  it('somebody would be late on that truck: asked first; « Choisir une autre heure » moves nothing and the sheet stays', async () => {
    seed(false);
    h.exact.mockResolvedValue({ ...OK, stops: [{ id: 'k2', day: DAY, truckId: 't2', orderBefore: 1, orderAfter: 2, etaBefore: 900, etaAfter: 1000, winStart: 720, winEnd: 960, delay: 100, late: true, lateMin: 40, measured: null }] });
    h.ask.mockResolvedValue(false);
    await show(J());
    await tap('truck-pick-t2');
    expect((h.ask.mock.calls[0][0] as { title: string }).title).toBe('Déplacer ce client à 13 h 15 met un client en retard');
    expect(h.move).not.toHaveBeenCalled();
    expect(closed).toBe(0);
  });
  it('« Laisser l’app choisir », and an arrival that would cut the customer a new window: the move of before', async () => {
    seed(false);
    await show(J({ truck_pinned: true }));
    await tap('truck-auto');
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'day', null]);
    render(null, box); h.move.mockClear();
    // 13 h 40 in 12 h – 16 h would say 13 h – 17 h: not kept, the planner's time inside the window told, as before
    await show(J({ eta_min: 820 }));
    await tap('truck-pick-t2');
    expect(h.exact).not.toHaveBeenCalled();
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'day', 't2']);
  });
  it('a flexible appointment whose window the evening lock fixed: the move of live, it stays « flexible » (main 7118fb07, review F4)', async () => {
    // the exact move would write win_flex = false with no text (the window unchanged): out of the windows to text, never told
    seed(false);
    await show(J({ win_flex: true, eta_min: 790 }));
    await tap('truck-pick-t2');
    expect(h.exact).not.toHaveBeenCalled();
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'day', 't2']);
  });
});

describe('switch « Vraies routes » ON: each truck said from the exact preview of that minute', () => {
  it('keeps its time there, or cannot be there then (the earliest), never the planner’s other time', async () => {
    seed(true);
    h.exact.mockImplementation(async (_j: string, _d: string, truck: string) => (truck === 't2' ? { ...OK, refused: 'arrive_late', earliest: 840 } : OK));
    await show(J());
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.exact.mock.calls.map((c) => c[2]).sort()).toEqual(['t2', 't3']);
    expect(q('truck-pick-t2')!.textContent).toContain('Ne peut pas y être à 13 h 15 : au plus tôt 14 h');
    expect(q('truck-pick-t3')!.textContent).toContain('Garde son heure : arrivée à 13 h 15');
  });
});

describe('« Texter … ? » instead of the text (Hassan, 2026-11-22: « the system should ask me first »)', () => {
  const textOn = () => replaceLocal('settings', [{ id: '1', booking: { windows_on: true, win_before_min: 60, win_after_min: 180, win_round_min: 60, horizon_days: 120, unknown_min: 20, min_block_min: 45, roads_on: false,
    blocks: [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }] }, messages: { on: { moved: true } } } as never]);
  it('the time kept on the other truck, « Mettre à … » cut a new window (tell): the question, never the text by itself', async () => {
    seed(false); textOn();
    h.exact.mockResolvedValueOnce({ ...OK, refused: 'arrive_late', earliest: 840, earliestKeep: 840 }).mockResolvedValue(OK);
    h.move.mockResolvedValue({ queued: false, data: { ok: true, exact: true, tell: true } });
    await show(J());
    await tap('truck-pick-t2');
    expect(closed).toBe(1);
    expect(asking.askMovedText).toHaveBeenCalledTimes(1);
    expect(asking.askMovedText.mock.calls[0][1]).toEqual({ via: 'jobs' });
    expect((asking.askMovedText.mock.calls[0][0] as Job).id).toBe('j1');
  });
  it('the same time on the other truck (tell false): nothing asked', async () => {
    seed(false); textOn();
    await show(J());
    await tap('truck-pick-t2');
    expect(h.move).toHaveBeenCalledTimes(1);
    expect(asking.askMovedText).not.toHaveBeenCalled();
  });
});
