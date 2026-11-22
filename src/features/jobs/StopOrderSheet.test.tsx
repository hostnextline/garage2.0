/* « Ordre des arrêts ». Switch « Vraies routes » OFF: as before (a guess from the times shown, windows only). ON: the
   arrival times and « Hors plage » of the order built are the server's (stop_order_preview), asked a short moment after
   the last change; no answer → no time, no warning, « Heures d'arrivée : pas encore calculées », and saving still works.
   (The server is pretended.) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { StopEta } from '../../data/roads';

const h = vi.hoisted(() => ({
  preview: vi.fn((..._a: unknown[]): Promise<StopEta[] | null> => new Promise(() => undefined)),
  save: vi.fn((..._a: unknown[]) => Promise.resolve({ queued: false }))
}));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<typeof import('../../data/roads')>()), stopOrderPreview: h.preview }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), setStopOrder: h.save }));

import { StopOrderSheet } from './StopOrderSheet';
import { ORDER_WAIT_MS } from './previews';
import { replaceLocal } from '../../data/store';
import { roadsTick } from '../../data/roads';
import { lang } from '../../lib/i18n';
import { addDays, clock, today } from '../../lib/dates';
import type { Job } from '../../data/types';

const DAY = addDays(today(), 3);
const J = (id: string, number: number, stop: number, o: Partial<Job> = {}) =>
  ({ id, number, customer_id: null, truck_id: 't1', day: DAY, block: 'day', status: 'booked', stop_order: stop, duration_min: 60, travel_min: 30, eta_min: 480 + (stop - 1) * 120, deleted_at: null, ...o }) as unknown as Job;
// three stops by arrival window; the third one's window closes at 11 h: put first it is fine, the first one then is late
const winJobs = () => [
  J('a', 11, 1, { win_start: 420, win_end: 660 }),
  J('b', 12, 2, { win_start: 540, win_end: 780 }),
  J('c', 13, 3, { win_start: 600, win_end: 840 })
];
function seed(roadsOn: boolean, jobs: Job[] = winJobs(), windows = true) {
  replaceLocal('settings', [{ id: '1', booking: { horizon_days: 120, unknown_min: 20, min_block_min: 45, roads_on: roadsOn, windows_on: windows } } as never]);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null, tire_machine: true }] as never);
  replaceLocal('jobs', jobs as never);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const settle = async () => { for (let i = 0; i < 4; i++) await wait(); };
async function show(j: Job) { await act(async () => { render(<StopOrderSheet job={j} open onClose={() => undefined} />, box); }); await settle(); }
const tap = async (id: string) => { await act(async () => { q(id)!.click(); }); await settle(); };
const row = (n: number) => q(`stop-order-${n}`)!.textContent || '';

beforeEach(() => { lang.value = 'fr'; roadsTick.value = 0; h.preview.mockReset(); h.preview.mockImplementation(() => new Promise(() => undefined)); h.save.mockClear(); });
afterEach(() => { render(null, box); });

describe('switch OFF: as before', () => {
  it('a new order is guessed from the times shown (windows only), the server is never asked', async () => {
    seed(false);
    await show(winJobs()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 100);
    expect(h.preview).not.toHaveBeenCalled();
    expect(row(13)).not.toContain('environ');                              // first: no time guessed late
    // c, a, b: from 8 h, c waits for 10 h, then a at about 11 h 30, after its window (11 h); b at 13 h, still inside
    expect(row(11)).toContain(`environ ${clock(690, 'fr')}`);
    expect(q('stop-late-11')).toBeTruthy();
    expect(q('stop-late-12')).toBeNull();
    expect(q('stop-order-late')!.textContent).toContain('probablement');
    expect(q('stop-order-save')!.textContent).toBe('Enregistrer quand même');
    expect(q('stop-order-pending')).toBeNull();
  });
});

describe('switch ON: the server’s times for the order built', () => {
  it('asked once, a short moment after the LAST change (not at each tap), with the order on screen', async () => {
    seed(true);
    await show(winJobs()[0]);
    await tap('stop-first-13');
    await tap('stop-first-12');
    expect(h.preview).not.toHaveBeenCalled();
    await wait(ORDER_WAIT_MS + 100);
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.preview.mock.calls[0]).toEqual(['t1', DAY, 'day', ['b', 'c', 'a']]);
  });
  it('the order as the planner had it: nothing asked, the server’s own times shown', async () => {
    seed(true);
    await show(winJobs()[0]);
    await wait(ORDER_WAIT_MS + 100);
    expect(h.preview).not.toHaveBeenCalled();
    expect(row(11)).toContain(`vers ${clock(480, 'fr')}`);
  });
  it('answered: its arrival times, its « Hors plage », its warning; no time of the phone’s', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve([{ id: 'c', eta: 470, late: false }, { id: 'a', eta: 700, late: true }, { id: 'b', eta: 790, late: true }]));
    await show(winJobs()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 100);
    await settle();
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    expect(row(11)).toContain(`vers ${clock(700, 'fr')}`);
    expect(document.body.textContent).not.toContain('environ');
    expect(q('stop-late-11')!.textContent).toBe('Hors plage');
    expect(q('stop-late-12')).toBeTruthy();
    expect(q('stop-late-13')).toBeNull();
    expect(q('stop-order-late')!.textContent).toMatch(/^Avec cet ordre, ces clients seraient servis après l’heure qui leur a été dite : .+\. Avertis-les si tu enregistres\.$/);
    expect(q('stop-order-late')!.textContent).not.toContain('probablement');
    expect(q('stop-order-save')!.textContent).toBe('Enregistrer quand même');
    expect(q('stop-order-server')).toBeTruthy();
    expect(q('stop-order-pending')).toBeNull();
  });
  it('a block job the server says late: « En retard » (after the block told)', async () => {
    seed(true, [J('a', 11, 1, { block: 'am' }), J('b', 12, 2, { block: 'am' })], false);
    h.preview.mockImplementation(() => Promise.resolve([{ id: 'b', eta: 500, late: false }, { id: 'a', eta: 735, late: true }]));
    await show(J('a', 11, 1, { block: 'am' }));
    await tap('stop-first-12');
    await wait(ORDER_WAIT_MS + 100);
    await settle();
    expect(q('stop-late-11')!.textContent).toBe('En retard');
    expect(row(11)).toContain(`vers ${clock(735, 'fr')}`);
  });
  it('no answer: no time, no warning, « pas encore calculées », and « Enregistrer » sends the order', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.reject(new Error('offline')));
    await show(winJobs()[0]);
    await tap('stop-first-13');
    // while it waits too
    expect(q('stop-order-pending')!.textContent).toBe('Heures d’arrivée : pas encore calculées.');
    await wait(ORDER_WAIT_MS + 100);
    await settle();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(q('stop-order-pending')!.textContent).toBe('Heures d’arrivée : pas encore calculées.');
    expect(row(13)).not.toContain('vers');
    expect(row(11)).not.toContain('vers');
    expect(document.body.textContent).not.toContain('environ');
    expect(q('stop-late-11')).toBeNull();
    expect(q('stop-late-12')).toBeNull();
    expect(q('stop-order-late')).toBeNull();
    const save = q('stop-order-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.textContent).toBe('Enregistrer l’ordre');
    await tap('stop-order-save');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]).toEqual(['t1', DAY, 'day', ['c', 'a', 'b']]);
  });
});

/* fix-sheets (review-sheets M2, L2, L5) */
const four = () => [...winJobs(), J('d', 14, 4, { win_start: 600, win_end: 900 })];
const ANS1: StopEta[] = [{ id: 'c', eta: 470, late: false }, { id: 'a', eta: 700, late: true }, { id: 'b', eta: 790, late: true }, { id: 'd', eta: 900, late: false }];
const ANS2: StopEta[] = [{ id: 'd', eta: 481, late: false }, { id: 'c', eta: 601, late: false }, { id: 'a', eta: 721, late: true }, { id: 'b', eta: 841, late: true }];
describe('switch ON: answers out of order (review M2, R1)', () => {
  it('the answer of an OLDER order arriving after the newer one is never shown', async () => {
    seed(true, four());
    const pending: ((v: StopEta[]) => void)[] = [];
    h.preview.mockImplementation(() => new Promise<StopEta[]>((r) => { pending.push(r); }));
    await show(four()[0]);
    await tap('stop-first-13');                 // c a b d
    await wait(ORDER_WAIT_MS + 50);
    await tap('stop-first-14');                 // d c a b
    await wait(ORDER_WAIT_MS + 50);
    expect(h.preview).toHaveBeenCalledTimes(2);
    await act(async () => { pending[1](ANS2); });
    await settle();
    await act(async () => { pending[0](ANS1); });
    await settle();
    expect(row(14)).toContain(`vers ${clock(481, 'fr')}`);
    expect(row(13)).toContain(`vers ${clock(601, 'fr')}`);
    expect(q('stop-late-11')).toBeTruthy();
    expect(document.body.textContent).not.toContain(clock(470, 'fr'));
  });
  it('the older answer arriving while the newer is still asked: nothing of it, « pas encore calculées »', async () => {
    seed(true, four());
    const pending: ((v: StopEta[]) => void)[] = [];
    h.preview.mockImplementation(() => new Promise<StopEta[]>((r) => { pending.push(r); }));
    await show(four()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 50);
    await tap('stop-first-14');
    await act(async () => { pending[0](ANS1.map((x) => ({ ...x, late: true }))); });
    await settle();
    expect(q('stop-order-pending')).toBeTruthy();
    expect(q('stop-order-late')).toBeNull();
    expect(document.body.textContent).not.toContain(clock(470, 'fr'));
  });
  it('an order answered, then another order asked: the first order’s times are not shown for the second', async () => {
    seed(true, four());
    let n = 0;
    h.preview.mockImplementation(() => (n++ === 0 ? Promise.resolve(ANS1) : new Promise(() => undefined)));
    await show(four()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 50); await settle();
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    await tap('stop-first-11');                 // a c b d
    await wait(ORDER_WAIT_MS + 50); await settle();
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(clock(470, 'fr'));
    expect(q('stop-order-late')).toBeNull();
    expect(q('stop-order-pending')).toBeTruthy();
    // back to the first order (c a b d): its answer at once, not asked again
    await tap('stop-first-13');
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    await wait(ORDER_WAIT_MS + 50);
    expect(h.preview).toHaveBeenCalledTimes(2);
  });
});

describe('switch ON: a preview that never answers (review M2, R2)', () => {
  it('« Enregistrer » stays enabled for as long as it hangs, and sends the order', async () => {
    seed(true, four());
    await show(four()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 50);
    await wait(1500);
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(q('stop-order-pending')).toBeTruthy();
    const save = q('stop-order-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await tap('stop-order-save');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]).toEqual(['t1', DAY, 'day', ['c', 'a', 'b', 'd']]);
  });
  it('one line says it is not worked out yet (not two)', async () => {
    seed(true, four());
    await show(four()[0]);
    await tap('stop-first-13');
    expect(q('stop-order-pending')!.textContent).toBe('Heures d’arrivée : pas encore calculées.');
    expect(document.body.textContent).not.toContain('Les nouvelles heures d’arrivée s’affichent après l’enregistrement.');
  });
});

describe('switch ON: a measure that ends (review L2, R4)', () => {
  it('the same order is asked again; its answer stays on screen until the new one replaces it', async () => {
    seed(true, four());
    let second: (v: StopEta[]) => void = () => undefined;
    let n = 0;
    h.preview.mockImplementation(() => (n++ === 0 ? Promise.resolve(ANS1) : new Promise<StopEta[]>((r) => { second = r; })));
    await show(four()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 50); await settle();
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    await act(async () => { roadsTick.value++; });
    await settle();
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    expect(q('stop-late-11')).toBeTruthy();
    expect(q('stop-order-pending')).toBeNull();
    await wait(ORDER_WAIT_MS + 50);
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(h.preview.mock.calls[1]).toEqual(['t1', DAY, 'day', ['c', 'a', 'b', 'd']]);
    await show(four()[0]);                      // redrawn while it is asked again: still the answer, not « pas encore »
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    expect(q('stop-order-pending')).toBeNull();
    await act(async () => { second(ANS1.map((x) => (x.id === 'c' ? { ...x, eta: 475 } : { ...x, late: false }))); });
    await settle();
    expect(row(13)).toContain(`vers ${clock(475, 'fr')}`);
    expect(q('stop-late-11')).toBeNull();
  });
});

describe('switch ON: the word for a late stop (review L5)', () => {
  it('a window job with no window told yet (« flexible ») late after the day: « En retard », not « Hors plage »', async () => {
    seed(true, [J('a', 11, 1, { win_start: 420, win_end: 660 }), J('f', 15, 2, { win_start: null, win_end: null, win_flex: true })]);
    h.preview.mockImplementation(() => Promise.resolve([{ id: 'f', eta: 500, late: false }, { id: 'a', eta: 700, late: true }].reverse().map((x) => (x.id === 'f' ? { ...x, eta: 1230, late: true } : { ...x, late: false }))));
    await show(J('a', 11, 1, { win_start: 420, win_end: 660 }));
    await tap('stop-first-15');
    await wait(ORDER_WAIT_MS + 50); await settle();
    expect(q('stop-late-15')!.textContent).toBe('En retard');
    expect(q('stop-late-11')).toBeNull();
  });
});

/* the integrator (2026-11-20): stop_order_preview says for each stop whether every trip up to it is measured
   (measured, fix-sql « C »); a stop not measured gets no arrival time (« heure : trajets pas encore mesurés »), and no
   « late » judged from a trip not measured (a guess) */
describe('switch ON: a stop whose trips are not all measured', () => {
  it('no time, the words of the sheets; the measured stops keep theirs', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve([{ id: 'c', eta: 470, late: false, measured: true }, { id: 'a', eta: 700, late: true, measured: false }, { id: 'b', eta: 790, late: false, measured: false }]));
    await show(winJobs()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 100);
    await settle();
    expect(row(13)).toContain(`vers ${clock(470, 'fr')}`);
    expect(row(11)).toContain('heure : trajets pas encore mesurés');
    expect(row(11)).not.toContain(clock(700, 'fr'));
    expect(row(12)).toContain('heure : trajets pas encore mesurés');
    expect(row(12)).not.toContain(clock(790, 'fr'));
    expect(q('stop-late-11')).toBeNull();
    expect(q('stop-order-late')).toBeNull();
    expect(q('stop-order-save')!.textContent).toBe('Enregistrer l’ordre');
  });
  it('measured absent (switch off on the server, an older server): the times as the server gave them', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve([{ id: 'c', eta: 470, late: false }, { id: 'a', eta: 700, late: true }, { id: 'b', eta: 790, late: false }]));
    await show(winJobs()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 100);
    await settle();
    expect(row(11)).toContain(`vers ${clock(700, 'fr')}`);
    expect(q('stop-late-11')).toBeTruthy();
  });
  it('in English', async () => {
    seed(true);
    lang.value = 'en';
    h.preview.mockImplementation(() => Promise.resolve([{ id: 'c', eta: 470, late: false, measured: true }, { id: 'a', eta: 700, late: false, measured: false }, { id: 'b', eta: 790, late: false, measured: false }]));
    await show(winJobs()[0]);
    await tap('stop-first-13');
    await wait(ORDER_WAIT_MS + 100);
    await settle();
    expect(row(11)).toContain('time: trips not measured yet');
  });
});
