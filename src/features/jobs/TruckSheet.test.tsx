/* « Changer de camion »: what each truck says. Switch « Vraies routes » OFF: its free time in the block from the phone's
   copy, « Peut-être trop juste » as before. ON: no free time worked out by the phone; the server says, for each other
   truck, whether it can take the appointment and its arrival there (move_preview with only it), or « pas encore
   calculée ». (The server is pretended.) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { MovePreview } from '../../data/roads';

const h = vi.hoisted(() => ({
  preview: vi.fn((..._a: unknown[]): Promise<MovePreview | null> => new Promise(() => undefined)),
  move: vi.fn((..._a: unknown[]) => Promise.resolve({ queued: false, data: { changed: true } as Record<string, unknown> }))
}));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<typeof import('../../data/roads')>()), movePreview: h.preview }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), moveJob: h.move }));

import { TruckSheet } from './TruckSheet';
import { replaceLocal } from '../../data/store';
import { roadsTick } from '../../data/roads';
import { lang } from '../../lib/i18n';
import { addDays, clock, dow, duration, today } from '../../lib/dates';
import { freeWords } from '../../domain/moment/words';
import type { Job } from '../../data/types';

const DAY = (() => { let d = addDays(today(), 2); while ([0, 6].includes(dow(d))) d = addDays(d, 1); return d; })();
const J = (id: string, truck: string, o: Partial<Job> = {}) =>
  ({ id, number: 1, customer_id: null, truck_id: truck, day: DAY, block: 'pm', status: 'booked', stop_order: 1, duration_min: 60, travel_min: 30, eta_min: 750, deleted_at: null, ...o }) as unknown as Job;
const THIS = J('j1', 't1');
function seed(roadsOn: boolean) {
  replaceLocal('settings', [{ id: '1', booking: { horizon_days: 120, unknown_min: 20, min_block_min: 45, roads_on: roadsOn } } as never]);
  replaceLocal('trucks', ['t1', 't2', 't3'].map((id, i) => ({ id, name: `Camion ${i + 1}`, active: true, sort: i, color: '#D3000E', driver_id: null, tire_machine: true })) as never);
  replaceLocal('truck_week', ['t1', 't2', 't3'].flatMap((id) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: `${id}${d}`, truck_id: id, dow: d, ranges: [[480, 1200]] }))) as never);
  replaceLocal('truck_days', []);
  // t2 is almost full that afternoon: 200 min of work and 30 of driving in a 240-minute block
  replaceLocal('jobs', [THIS, J('k2', 't2', { duration_min: 200 })] as never);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 5; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0))); };
async function show() { await act(async () => { render(<TruckSheet job={THIS} open onClose={() => undefined} />, box); }); await settle(); }
const sub = (id: string) => q(`truck-pick-${id}`)!.textContent || '';

beforeEach(() => { lang.value = 'fr'; roadsTick.value = 0; h.preview.mockReset(); h.preview.mockImplementation(() => new Promise(() => undefined)); h.move.mockClear(); });
afterEach(() => { render(null, box); });

describe('switch OFF: as before', () => {
  it('each truck’s free time from the phone’s copy, « Peut-être trop juste »; the server is not asked', async () => {
    seed(false);
    await show();
    expect(h.preview).not.toHaveBeenCalled();
    expect(sub('t2')).toContain(freeWords(230, 240, 'fr'));
    expect(sub('t2')).toContain(`Peut-être trop juste pour ${duration(60, 'fr')}`);
    expect(sub('t3')).toContain(freeWords(0, 240, 'fr'));
    expect(sub('t1')).toContain(freeWords(0, 240, 'fr'));
  });
});

describe('switch ON: the server’s word, never a free time guessed', () => {
  it('asks each OTHER truck that works then, with only this appointment, same day and block', async () => {
    seed(true);
    await show();
    expect(h.preview.mock.calls.map((c) => c[0]).sort()).toEqual(['t2', 't3']);
    // the move the tap sends (the 5-argument move_job: the window kept as told), not the 7-argument one (fix-sql « C »)
    for (const c of h.preview.mock.calls) expect(c.slice(1)).toEqual([DAY, 'pm', ['j1'], { asTold: true }]);
    // while it answers: no number
    expect(sub('t2')).toContain('Place : en calcul…');
    expect(sub('t2')).not.toMatch(/libre|trop juste/);
  });
  it('answered: room with the arrival there, or « ne peut pas le prendre »; the current truck: its planned arrival', async () => {
    seed(true);
    const no: MovePreview = { order: ['k2'], eta: { k2: 730 }, refused: ['j1'], day_min: 60, day_km: 20, unmeasured: 0 };
    const yes: MovePreview = { order: ['j1'], eta: { j1: 765 }, refused: [], day_min: 40, day_km: 15, unmeasured: 0 };
    h.preview.mockImplementation((truck) => Promise.resolve(truck === 't2' ? no : yes));
    await show();
    expect(sub('t2')).toContain('Ne peut pas le prendre à ce moment-là');
    expect(sub('t3')).toContain(`Il y a de la place : arrivée vers ${clock(765, 'fr')}`);
    expect(sub('t1')).toContain(`Arrivée prévue vers ${clock(750, 'fr')}`);
    for (const id of ['t1', 't2', 't3']) expect(sub(id)).not.toMatch(/libre|trop juste/);
    // a tap still moves it (the server has the last word)
    await act(async () => { q('truck-pick-t3')!.click(); });
    await settle();
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'pm', 't3']);
  });
  it('no answer: « Place : pas encore calculée », no number', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.reject(new Error('offline')));
    await show();
    expect(sub('t2')).toContain('Place : pas encore calculée');
    expect(sub('t3')).toContain('Place : pas encore calculée');
    expect(sub('t2')).not.toMatch(/libre|trop juste|\d+ min/);
  });
});

/* fix-sheets (review-sheets M1, M2, L2, L5) */
const yes = (eta: number, o: Partial<MovePreview> = {}): MovePreview => ({ order: ['j1'], eta: { j1: eta }, refused: [], day_min: 40, day_km: 15, unmeasured: 0, ...o });
describe('switch ON: an arrival only when every trip of that day is measured (review M1)', () => {
  it('unmeasured > 0: « Il y a de la place », no time, and why', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve(yes(765, { day_km: null, unmeasured: 2 })));
    await show();
    expect(sub('t3')).toBe('Camion 3Il y a de la place (heure : trajets pas encore mesurés)');
    expect(sub('t3')).not.toContain(clock(765, 'fr'));
  });
  it('the server does not say its trips are measured (null): « Il y a de la place » alone', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve(yes(765, { day_km: null, unmeasured: null })));
    await show();
    expect(sub('t3')).toBe('Camion 3Il y a de la place');
  });
  it('in English', async () => {
    seed(true);
    lang.value = 'en';
    h.preview.mockImplementation(() => Promise.resolve(yes(765, { day_km: null, unmeasured: 1 })));
    await show();
    expect(sub('t3')).toBe('Camion 3There is room (time: trips not measured yet)');
  });
});

describe('switch ON: a preview that never answers (review M2, K1)', () => {
  it('a tap on a truck still moves while « en calcul… »', async () => {
    seed(true);
    await show();
    expect(sub('t3')).toContain('en calcul');
    await act(async () => { q('truck-pick-t3')!.click(); });
    await settle();
    expect(h.move).toHaveBeenCalledTimes(1);
    expect(h.move.mock.calls[0]).toEqual(['j1', DAY, 'pm', 't3']);
  });
});

describe('switch ON: a measure that ends (review M2 K2, L2)', () => {
  it('the asks of before the measure answering last are not shown', async () => {
    seed(true);
    const pend: ((v: MovePreview) => void)[] = [];
    h.preview.mockImplementation(() => new Promise<MovePreview>((r) => { pend.push(r); }));
    await show();
    await act(async () => { roadsTick.value++; });
    await settle();
    expect(h.preview).toHaveBeenCalledTimes(4);
    for (const r of pend.slice(2)) await act(async () => { r(yes(800)); });
    await settle();
    for (const r of pend.slice(0, 2)) await act(async () => { r(yes(700)); });
    await settle();
    expect(sub('t3')).toContain(clock(800, 'fr'));
    expect(sub('t3')).not.toContain(clock(700, 'fr'));
  });
  it('the answer on screen stays while it is asked again, until the new one replaces it', async () => {
    seed(true);
    const pend: ((v: MovePreview) => void)[] = [];
    let n = 0;
    h.preview.mockImplementation(() => (n++ < 2 ? Promise.resolve(yes(765)) : new Promise<MovePreview>((r) => { pend.push(r); })));
    await show();
    expect(sub('t3')).toContain(`arrivée vers ${clock(765, 'fr')}`);
    await act(async () => { roadsTick.value++; });
    await settle();
    expect(h.preview).toHaveBeenCalledTimes(4);
    await show();                               // redrawn while it is asked again: still the answer
    expect(h.preview).toHaveBeenCalledTimes(4);
    expect(sub('t3')).toContain(`arrivée vers ${clock(765, 'fr')}`);
    for (const r of pend) await act(async () => { r(yes(790)); });
    await settle();
    expect(sub('t3')).toContain(`arrivée vers ${clock(790, 'fr')}`);
  });
  it('a pull that redraws the sheet asks nothing again', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve(yes(765)));
    await show();
    const n = h.preview.mock.calls.length;
    await act(async () => { replaceLocal('jobs', [THIS, J('k2', 't2', { duration_min: 100 })] as never); });
    await settle();
    expect(h.preview.mock.calls.length).toBe(n);
  });
});

describe('switch ON: the words of a refusal (review L5)', () => {
  it('tire work refused by the car: « ce travail demande le camion », not « à ce moment-là »', async () => {
    seed(true);
    replaceLocal('trucks', ['t1', 't2', 't3'].map((id, i) => ({ id, name: `Camion ${i + 1}`, active: true, sort: i, color: '#D3000E', driver_id: null, tire_machine: id !== 't3' })) as never);
    const tire = { ...THIS, needs_machine: true } as Job;
    replaceLocal('jobs', [tire, J('k2', 't2', { duration_min: 200 })] as never);
    h.preview.mockImplementation((truck) => Promise.resolve(truck === 't3' ? { ...yes(0), order: [], eta: {}, refused: ['j1'] } : { ...yes(0), order: ['k2'], eta: {}, refused: ['j1'] }));
    await act(async () => { render(<TruckSheet job={tire} open onClose={() => undefined} />, box); });
    await settle();
    expect(sub('t3')).toBe('Camion 3Ne peut pas : ce travail demande le camion');
    expect(sub('t2')).toBe('Camion 2Ne peut pas le prendre à ce moment-là');
  });
});

/* the integrator (2026-11-20): each refusal said with the words of its code (move_preview refused_why: the codes of
   move_job, their words in src/i18n/fr|en/errors.ts); a code with no words, or none: the general words */
describe('switch ON: why each truck refuses, from the server (refused_why)', () => {
  const no = (code: string | null): MovePreview => ({ order: [], eta: {}, refused: ['j1'], day_min: 0, day_km: null, unmeasured: 0, ...(code ? { refused_why: { j1: code } } : {}) });
  it('truck_full, block_started, needs_truck: their own words; an unknown code or none: « ne peut pas le prendre »', async () => {
    seed(true);
    h.preview.mockImplementation((truck) => Promise.resolve(truck === 't2' ? no('truck_full') : no('block_started')));
    await show();
    expect(sub('t2')).toBe('Camion 2Ce camion n’a plus de place dans ce bloc.');
    expect(sub('t3')).toBe('Camion 3Ce bloc est déjà commencé. Choisis un autre bloc.');
    render(null, box);
    h.preview.mockReset();
    h.preview.mockImplementation((truck) => Promise.resolve(truck === 't2' ? no('needs_truck') : no('refused')));
    await show();
    expect(sub('t2')).toBe('Camion 2Ne peut pas : ce travail demande le camion');
    expect(sub('t3')).toBe('Camion 3Ne peut pas le prendre à ce moment-là');
    render(null, box);
    h.preview.mockReset();
    h.preview.mockImplementation(() => Promise.resolve(no(null)));
    await show();
    expect(sub('t2')).toBe('Camion 2Ne peut pas le prendre à ce moment-là');
  });
  it('in English', async () => {
    seed(true);
    lang.value = 'en';
    h.preview.mockImplementation((truck) => Promise.resolve(truck === 't2' ? no('truck_full') : no('block_full')));
    await show();
    expect(sub('t2')).toBe('Camion 2This truck has no room left in this block.');
    expect(sub('t3')).toBe('Camion 3This block is full. Pick another block.');
  });
});
