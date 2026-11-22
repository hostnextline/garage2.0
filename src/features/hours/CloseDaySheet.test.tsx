/* « La voiture ferme »: the other vehicle's route with the moved appointments. Switch « Vraies routes » OFF: the phone's
   copy as before (moveStops). ON: the server's answer (move_preview), or the day as it is with the moved appointments as
   pins without numbers and « Ordre et route : pas encore calculés ». The roads are asked for THAT day and the note says
   why a line is missing. (The server, the map and the route planner are pretended.) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { MovePreview } from '../../data/roads';

const h = vi.hoisted(() => ({
  map: null as null | { markers: { id: string; number?: number | string | null; color?: string | null }[]; lines: { points: [number, number][] }[] },
  preview: vi.fn((..._a: unknown[]): Promise<MovePreview | null> => new Promise(() => undefined)),
  days: [] as unknown[],
  total: null as null | { km: number; minutes: number; by: string },
  state: 'known' as string
}));
vi.mock('../../shared/map/MapView', () => ({ MapView: (p: typeof h.map) => { h.map = p; return null; } }));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<typeof import('../../data/roads')>()), movePreview: h.preview }));
vi.mock('../../shared/map/useRoads', () => ({
  useRoads: (_t: unknown, day: unknown) => { h.days.push(['useRoads', day]); return 0; },
  roadOf: (leg: { points: [number, number][] }, day: unknown) => { h.days.push(['roadOf', day]); return leg.points; },
  roadTotal: (_t: unknown, day: unknown) => { h.days.push(['roadTotal', day]); return h.total; },
  roadState: (_t: unknown, day: unknown) => { h.days.push(['roadState', day]); return h.state; }
}));

import { CloseDaySheet } from './CloseDaySheet';
import { replaceLocal } from '../../data/store';
import { roadsTick } from '../../data/roads';
import { lang } from '../../lib/i18n';
import { addDays, clock, duration, dow, today } from '../../lib/dates';
import type { Job } from '../../data/types';
import type { Move } from '../../shared/map/closing';

const DAY = (() => { let d = addDays(today(), 2); while ([0, 6].includes(dow(d))) d = addDays(d, 1); return d; })();
const job = (id: string, number: number, truck: string, stop: number, lng: number) =>
  ({ id, number, customer_id: null, truck_id: truck, day: DAY, block: 'am', status: 'booked', stop_order: stop, duration_min: 45, eta_min: 480 + stop * 60, lat: 45.5, lng }) as unknown as Job;
// the truck: A then B going east from the Centrale; X, moved from the car, sits next to the start (a straight line puts it first)
const A = job('a1', 1, 'truck', 1, -73.6), B = job('b2', 2, 'truck', 2, -73.5), X = job('x3', 3, 'car', 1, -73.69);
function seed(roadsOn: boolean) {
  replaceLocal('settings', [{ id: '1', booking: { horizon_days: 120, unknown_min: 20, min_block_min: 45, roads_on: roadsOn, home: { label: 'Centrale', address: '', lat: 45.5, lng: -73.7 } } } as never]);
  replaceLocal('trucks', [
    { id: 'car', name: 'Voiture', active: true, sort: 1, color: '#2F6FD0', driver_id: null, tire_machine: false },
    { id: 'truck', name: 'Camion', active: true, sort: 2, color: '#D3000E', driver_id: null, tire_machine: true }
  ] as never);
  replaceLocal('jobs', [A, B, X] as never);
}
const moves: Move[] = [{ job: X, target: 'truck', why: null }];
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 5; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0))); };
const did = { move: 0, close: 0 };
async function show(list: Move[] = moves) {
  await act(async () => { render(<CloseDaySheet truckId="car" moves={list} onMove={async () => { did.move++; }} onJustClose={async () => { did.close++; }} onClose={() => undefined} />, box); });
  await settle();
}
const pins = () => Object.fromEntries((h.map?.markers || []).filter((m) => m.id !== 'from').map((m) => [m.id, m.number ?? null]));
const touches = (lng: number) => (h.map?.lines || []).some((l) => l.points.some((p) => p[1] === lng));
const ANSWER: MovePreview = { order: ['a1', 'b2', 'x3'], eta: { a1: 540, b2: 600, x3: 700 }, refused: [], day_min: 95, day_km: 41.2, unmeasured: 0 };

beforeEach(() => { lang.value = 'fr'; roadsTick.value = 0; did.move = 0; did.close = 0; h.map = null; h.days = []; h.total = null; h.state = 'known'; h.preview.mockReset(); h.preview.mockImplementation(() => new Promise(() => undefined)); });
afterEach(() => { render(null, box); });

describe('switch OFF: as before', () => {
  it('the phone’s copy with the moved appointment at its cheapest place, the streets’ total; the server is not asked', async () => {
    seed(false);
    h.total = { km: 12.3, minutes: 34, by: 'tomtom' };
    await show();
    expect(h.preview).not.toHaveBeenCalled();
    expect(pins()).toEqual({ x3: 1, a1: 2, b2: 3 });
    expect(q('close-day-facts')!.textContent).toBe(`3 arrêts ce jour-là. Route de la journée : 12,3 km, ${duration(34, 'fr')}.`);
    expect(q('close-day-server')).toBeNull();
  });
  it('the roads are asked for THAT day, and the note says why the line is not there yet', async () => {
    seed(false);
    h.state = 'asking';
    await show();
    expect(h.days.length).toBeGreaterThan(0);
    for (const [fn, day] of h.days as [string, unknown][]) expect([fn, day]).toEqual([fn, DAY]);
    expect((h.days as [string, unknown][]).some(([fn]) => fn === 'roadOf')).toBe(true);
    expect(q('close-day-facts')!.textContent).toBe('3 arrêts ce jour-là.');
    expect(q('close-day-road-note')!.textContent).toBe('Route en cours de calcul…');
    h.state = 'down';
    await show();
    expect(q('close-day-road-note')!.textContent).toBe('Route indisponible pour l’instant');
    h.state = 'never';
    await show();
    expect(q('close-day-road-note')!.textContent).toBe('Route impossible à tracer');
  });
});

describe('switch ON: the server’s answer, or nothing guessed', () => {
  it('while it is asked: the day as it is, the moved appointment as a pin without a number, no line through it, no total', async () => {
    seed(true);
    h.total = { km: 12.3, minutes: 34, by: 'tomtom' };
    await show();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.preview.mock.calls[0]).toEqual(['truck', DAY, null, ['x3']]);
    expect(pins()).toEqual({ a1: 1, b2: 2, x3: null });
    expect(touches(-73.69)).toBe(false);
    expect(q('close-day-facts')!.textContent).toBe('3 arrêts ce jour-là. Ordre et route : pas encore calculés.');
    expect(q('close-day-facts')!.textContent).not.toContain('Route de la journée');
    expect(q('close-day-place')).toBeNull();
  });
  it('no answer (no signal, an error): the same, nothing guessed', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.reject(new Error('offline')));
    await show();
    expect(pins()).toEqual({ a1: 1, b2: 2, x3: null });
    expect(q('close-day-facts')!.textContent).toBe('3 arrêts ce jour-là. Ordre et route : pas encore calculés.');
    h.preview.mockImplementation(() => Promise.resolve(null));            // an older server: no preview
    render(null, box);
    await show();
    expect(pins()).toEqual({ a1: 1, b2: 2, x3: null });
  });
  it('answered: the server’s order and numbers, its line, its « Route de la journée », each moved stop’s place and arrival', async () => {
    seed(true);
    h.total = { km: 12.3, minutes: 34, by: 'tomtom' };                    // the browser's total is NOT what is said
    h.preview.mockImplementation(() => Promise.resolve(ANSWER));
    await show();
    expect(pins()).toEqual({ a1: 1, b2: 2, x3: 3 });
    expect(touches(-73.69)).toBe(true);
    // the line follows the server's order: B → X is a leg (the straight line would have gone start → X → A)
    expect(h.map!.lines.some((l) => l.points[0][1] === -73.5 && l.points[l.points.length - 1][1] === -73.69)).toBe(true);
    expect(q('close-day-facts')!.textContent).toBe(`3 arrêts ce jour-là. Route de la journée : 41,2 km, ${duration(95, 'fr')}.`);
    expect(q('close-day-place')!.textContent!.trim()).toBe(`arrêt 3, vers ${clock(700, 'fr')}`);
    expect(q('close-day-server')).toBeTruthy();
  });
  it('a trip not measured yet: no km and no minutes, it is said', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, day_km: null, unmeasured: 2 }));
    await show();
    expect(q('close-day-facts')!.textContent).toBe('3 arrêts ce jour-là. Route de la journée : pas encore mesurée (2 trajets à mesurer).');
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, day_km: 30, unmeasured: 1 }));
    render(null, box);
    await show();
    expect(q('close-day-facts')!.textContent).not.toMatch(/km/);
  });
  it('a move the server refuses is said, and it is not on the route', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, order: ['a1', 'b2'], eta: { a1: 540, b2: 600 }, refused: ['x3'], day_min: 60, day_km: 25 }));
    await show();
    expect(q('close-day-refused')!.textContent).toBe('Ne peut pas aller sur le camion');
    expect(pins()).toEqual({ a1: 1, b2: 2 });
    expect(q('close-day-facts')!.textContent).toContain('Le serveur refuse d’y mettre 1 de ces rendez-vous.');
    expect(q('close-day-facts')!.textContent).toContain('2 arrêts ce jour-là.');
  });
  it('in English too', async () => {
    seed(true);
    lang.value = 'en';
    await show();
    expect(q('close-day-facts')!.textContent).toBe('3 stops that day. Order and route: not worked out yet.');
  });
});

/* fix-sheets (review-sheets M1, M2, L1, L2) */
const place = () => (q('close-day-place')?.textContent || '').trim();
describe('switch ON: an arrival is said only when every trip of that day is measured (review M1)', () => {
  it('unmeasured > 0: the moved stop’s place without a time, and why', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, day_km: null, unmeasured: 2 }));
    await show();
    expect(q('close-day-facts')!.textContent).toBe('3 arrêts ce jour-là. Route de la journée : pas encore mesurée (2 trajets à mesurer).');
    expect(place()).toBe('arrêt 3, heure : trajets pas encore mesurés');
    expect(place()).not.toContain(clock(700, 'fr'));
  });
  it('the server does not say its trips are measured (unmeasured null): the place alone, no time', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, day_km: null, unmeasured: null }));
    await show();
    expect(place()).toBe('arrêt 3');
  });
  it('in English', async () => {
    seed(true);
    lang.value = 'en';
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, day_km: null, unmeasured: 1 }));
    await show();
    expect(place()).toBe('stop 3, time: trips not measured yet');
  });
});

describe('switch ON: the roads of THAT day too (review M2, Mg)', () => {
  it('while asked (the day as it is) and answered (the server’s day): every road call names the day', async () => {
    seed(true);
    await show();
    expect((h.days as [string, unknown][]).some(([fn]) => fn === 'useRoads')).toBe(true);
    for (const [fn, day] of h.days as [string, unknown][]) expect([fn, day]).toEqual([fn, DAY]);
    h.days = [];
    h.preview.mockImplementation(() => Promise.resolve(ANSWER));
    render(null, box);
    await show();
    expect((h.days as [string, unknown][]).some(([fn]) => fn === 'roadOf')).toBe(true);
    for (const [fn, day] of h.days as [string, unknown][]) expect([fn, day]).toEqual([fn, DAY]);
  });
});

describe('switch ON: a preview that never answers blocks nothing (review M2, C5)', () => {
  it('« Déplacer » and « Fermer sans déplacer » are enabled and run', async () => {
    seed(true);
    await show();
    expect(q('close-day-facts')!.textContent).toContain('pas encore calculés');
    const move = q('close-day-move') as HTMLButtonElement, only = q('close-day-only') as HTMLButtonElement;
    expect(move.disabled).toBe(false);
    expect(only.disabled).toBe(false);
    await act(async () => { move.click(); });
    await act(async () => { only.click(); });
    expect(did).toEqual({ move: 1, close: 1 });
  });
});

/* two days: D1 (truck A, B; Y moved from the car) and D2 (truck A2; Z moved from the car) */
const work = (from: string) => { let d = from; while ([0, 6].includes(dow(d))) d = addDays(d, 1); return d; };
const D2 = work(addDays(DAY, 1));
const on2 = (id: string, number: number, truck: string, stop: number, lng: number) => ({ ...job(id, number, truck, stop, lng), day: D2 }) as Job;
const A2 = on2('a5', 5, 'truck', 1, -73.6), Z = on2('z4', 4, 'car', 1, -73.65);
function seed2() { seed(true); replaceLocal('jobs', [A, B, X, A2, Z] as never); }
const chip = async (i: number) => { await act(async () => { (q('close-day-days')!.querySelectorAll('button')[i] as HTMLElement).click(); }); await settle(); };

describe('switch ON: answers out of order across the day chips (review M2, C4)', () => {
  it('D1 asked, D2 chosen, D1 answers late: nothing of D1 on D2; back on D1 its answer at once, not asked again', async () => {
    seed2();
    const pending = new Map<string, (v: MovePreview) => void>();
    h.preview.mockImplementation((_t, day) => new Promise<MovePreview>((r) => { pending.set(String(day), r); }));
    await show([{ job: X, target: 'truck', why: null }, { job: Z, target: 'truck', why: null }]);
    await chip(1);
    await act(async () => { pending.get(DAY)!(ANSWER); });
    await settle();
    expect(q('close-day-facts')!.textContent).toBe('2 arrêts ce jour-là. Ordre et route : pas encore calculés.');
    expect(q('close-day-place')).toBeNull();
    expect(q('close-day-facts')!.textContent).not.toContain('41,2');
    await chip(0);
    expect(q('close-day-facts')!.textContent).toBe(`3 arrêts ce jour-là. Route de la journée : 41,2 km, ${duration(95, 'fr')}.`);
    expect(h.preview.mock.calls.filter((c) => c[1] === DAY)).toHaveLength(1);
  });
});

describe('switch ON: a day where nothing goes to the other vehicle (review L1)', () => {
  it('not « pas encore calculés » forever: the day as it is is asked (an empty list) and said', async () => {
    seed2();
    let answer: (v: MovePreview) => void = () => undefined;
    h.preview.mockImplementation((_t, day) => (day === DAY ? new Promise<MovePreview>((r) => { answer = r; }) : new Promise(() => undefined)));
    // D1 holds only an appointment that stays (no vehicle for it), D2 one that goes: the sheet opens on D1
    await show([{ job: X, target: null, why: 'closed' }, { job: Z, target: 'truck', why: null }]);
    expect(h.preview.mock.calls.find((c) => c[1] === DAY)).toEqual(['truck', DAY, null, []]);
    expect(q('close-day-facts')!.textContent).toBe('2 arrêts ce jour-là.');
    expect(pins()).toEqual({ a1: 1, b2: 2 });
    await act(async () => { answer({ order: ['a1', 'b2'], eta: { a1: 540, b2: 600 }, refused: [], day_min: 50, day_km: 20.5, unmeasured: 0 }); });
    await settle();
    expect(q('close-day-facts')!.textContent).toBe(`2 arrêts ce jour-là. Route de la journée : 20,5 km, ${duration(50, 'fr')}.`);
  });
  it('no answer for that day: the count alone, still no « pas encore calculés »', async () => {
    seed2();
    h.preview.mockImplementation(() => Promise.reject(new Error('offline')));
    await show([{ job: X, target: null, why: 'closed' }, { job: Z, target: 'truck', why: null }]);
    expect(q('close-day-facts')!.textContent).toBe('2 arrêts ce jour-là.');
  });
});

describe('switch ON: a measure that ends does not throw the answer away (review L2)', () => {
  it('asked again, the answer on screen kept until the new one replaces it', async () => {
    seed(true);
    let second: (v: MovePreview) => void = () => undefined;
    let n = 0;
    h.preview.mockImplementation(() => (n++ === 0 ? Promise.resolve(ANSWER) : new Promise<MovePreview>((r) => { second = r; })));
    await show();
    expect(q('close-day-facts')!.textContent).toContain('41,2 km');
    await act(async () => { roadsTick.value++; });
    await settle();
    expect(h.preview).toHaveBeenCalledTimes(2);
    await show();                               // anything that redraws the sheet meanwhile (a pull…): still the answer
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(q('close-day-facts')!.textContent).toContain('41,2 km');
    expect(pins()).toEqual({ a1: 1, b2: 2, x3: 3 });
    await act(async () => { second({ ...ANSWER, day_km: 38, day_min: 80 }); });
    await settle();
    expect(q('close-day-facts')!.textContent).toBe(`3 arrêts ce jour-là. Route de la journée : 38 km, ${duration(80, 'fr')}.`);
  });
  it('the ask from before the measure answering last is not shown; a failed new ask keeps the answer', async () => {
    seed(true);
    const asks: ((v: MovePreview) => void)[] = [];
    const fails: ((e: Error) => void)[] = [];
    h.preview.mockImplementation(() => new Promise<MovePreview>((r, f) => { asks.push(r); fails.push(f); }));
    await show();
    await act(async () => { roadsTick.value++; });
    await settle();
    expect(asks).toHaveLength(2);
    await act(async () => { asks[1]({ ...ANSWER, day_km: 38, day_min: 80 }); });
    await settle();
    await act(async () => { asks[0](ANSWER); });
    await settle();
    expect(q('close-day-facts')!.textContent).toContain('38 km');
    await act(async () => { roadsTick.value++; });
    await settle();
    await act(async () => { fails[2](new Error('offline')); });
    await settle();
    expect(q('close-day-facts')!.textContent).toContain('38 km');
  });
});

/* the integrator (2026-11-20): why the server refuses a move, in the words of its code (move_preview refused_why, the codes
   of move_job; fix-sheets §5.3 « both sheets »); no code, or none with words: the pill alone, as before */
describe('switch ON: why a move is refused', () => {
  it('the code’s words under the row (fr, en); « refused » (no code from move_job): the pill alone', async () => {
    seed(true);
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, order: ['a1', 'b2'], eta: { a1: 540, b2: 600 }, refused: ['x3'], refused_why: { x3: 'truck_full' }, day_min: 60, day_km: 25 }));
    await show();
    expect(q('close-day-refused')!.textContent).toBe('Ne peut pas aller sur le camion');
    expect(q('close-day-why')!.textContent).toBe('Ce camion n’a plus de place dans ce bloc.');
    render(null, box);
    lang.value = 'en';
    await show();
    expect(q('close-day-why')!.textContent).toBe('This truck has no room left in this block.');
    render(null, box);
    lang.value = 'fr';
    h.preview.mockImplementation(() => Promise.resolve({ ...ANSWER, order: ['a1', 'b2'], eta: { a1: 540, b2: 600 }, refused: ['x3'], refused_why: { x3: 'refused' }, day_min: 60, day_km: 25 }));
    await show();
    expect(q('close-day-refused')).toBeTruthy();
    expect(q('close-day-why')).toBeNull();
  });
});
