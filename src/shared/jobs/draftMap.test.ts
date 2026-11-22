/* The map of « Réorganiser la journée » (Part 30, K4), what it draws for a draft: the pins in the DRAFT order with the
   numbers of the sheet's rows (a move within a truck and onto the other truck), the Carte's colour per truck, the stops
   done and under way, each truck's start, the arrival of the row, and NO line before a road came (Hassan's rule: never a
   straight line). Pure (draftMap.ts). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { draftAnswer, draftLayers, draftTrucks, numbersOf, arrivalOf, routesKey, mapOpenPref, keepMapOpen, type LayerCtx } from './draftMap';
import { assemble, PALETTE, type TeamMapAnswer, type Leg, type LatLng } from '../map/assemble';
import { drawable } from '../map/markers';
import { moveTo, type Draft } from '../../domain/jobs/dayOrder';
import { dayAnswer, type DayAnswer } from '../../data/dayOrder';

const DAY = '2026-12-01';
const job = (id: string, number: number, truck: string, order: number, o: Partial<TeamMapAnswer['jobs'][number]> = {}): TeamMapAnswer['jobs'][number] => ({
  id, number, truck_id: truck, order, eta_min: 480 + order * 60, status: 'booked', block: 'day', name: id.toUpperCase(), address: `${id} rue`,
  lat: 45.5 + number / 100, lng: -73.6 - number / 100, win_start: 480, win_end: 720, win_flex: false, ...o
});
const base = (): TeamMapAnswer => ({
  home: { lat: 45.5, lng: -73.6, label: 'Centrale', address: '1 rue du Garage' },
  trucks: [
    { id: 'A', name: 'Camion Complet', color: null, driver_id: null },
    { id: 'B', name: 'Voiture', color: null, driver_id: null, start: { lat: 45.45, lng: -73.7, label: 'Chez Adam', address: '9 rue Adam' } },
    { id: 'C', name: 'Camion 3', color: '#123456', driver_id: null }
  ],
  jobs: [
    job('done', 9, 'A', 1, { status: 'done' }),
    job('live', 10, 'A', 2, { status: 'on_site' }),
    job('a', 11, 'A', 3), job('b', 12, 'A', 4), job('c', 13, 'A', 5),
    job('d', 21, 'B', 1),
    job('x', 31, 'C', 1),                       // a truck the draft does not show (a mechanic's sheet): left out
    job('u', 41, '', 1, { truck_id: null })    // « À placer »: not in the draft
  ],
  people: [{ id: 'p1', name: 'Saleh', color: null, lat: 45.51, lng: -73.61, at: null, job_id: 'live' }],
  trips: [{ job_id: 'a', staff_id: 'p1', eta_at: null, km: null, minutes: null, route: null }]
});
const draft = (): Draft => ({
  day: DAY, moved: [], auto: false, was: {}, news: [],
  lists: [{ truck: 'A', block: 'day', live: ['live'], jobs: ['a', 'b', 'c'] }, { truck: 'B', block: 'day', live: [], jobs: ['d'] }],
  base: { a: { truck: 'A', block: 'day', index: 0 }, b: { truck: 'A', block: 'day', index: 1 }, c: { truck: 'A', block: 'day', index: 2 }, d: { truck: 'B', block: 'day', index: 0 } }
});
const nothing = () => [] as LatLng[];
function layers(d: Draft, o: Partial<LayerCtx> = {}) {
  const m = assemble(draftAnswer(base(), d));
  const trucks = draftTrucks(m, d);
  const out = draftLayers(m, trucks, {
    l: 'fr', cur: null, judge: false, changed: new Set(), dragged: new Set(), auto: false, row: () => undefined, unsure: () => false,
    numbers: numbersOf(d), marked: null, spot: null, road: nothing, ...o
  });
  return { m, trucks, ...out };
}
/** the stops of a truck as the map draws them: [id, number] in the order of its route */
const pinsOf = (r: ReturnType<typeof layers>, truck: string) => r.trucks.find((t) => t.id === truck)!.stops.map((s) => [s.id, r.markers.find((m) => m.id === s.id)!.number]);
const colourOf = (r: ReturnType<typeof layers>, id: string) => r.markers.find((m) => m.id === id)!.color;

describe('the pins follow the draft', () => {
  it('each truck’s stops numbered like the rows (the stop under way first, a stop done with its check), the Carte’s colours, its start', () => {
    const r = layers(draft());
    expect(pinsOf(r, 'A')).toEqual([['done', 1], ['live', 1], ['a', 2], ['b', 3], ['c', 4]]);
    expect(pinsOf(r, 'B')).toEqual([['d', 1]]);
    expect(r.markers.find((m) => m.id === 'done')).toMatchObject({ done: true });
    expect(r.markers.find((m) => m.id === 'live')).toMatchObject({ sub: 'sur place' });
    // the Carte's colours: the trucks in the same order, the same palette (C keeps its own and is not shown)
    expect(colourOf(r, 'a')).toBe(PALETTE[0]);
    expect(colourOf(r, 'd')).toBe(PALETTE[1]);
    expect(r.markers.map((m) => m.id)).not.toContain('x');
    expect(r.markers.map((m) => m.id)).not.toContain('u');
    // no people, no live trips: a plan
    expect(r.markers.some((m) => m.kind === 'person')).toBe(false);
    expect(r.m.trucks.flatMap((t) => t.legs).some((l) => l.kind === 'trip')).toBe(false);
    // the starts: « Départ des camions » for A, B's own
    expect(r.markers.find((m) => m.id === 'home')).toMatchObject({ kind: 'home', label: 'Centrale' });
    expect(r.markers.find((m) => m.id === 'start-B')).toMatchObject({ kind: 'customer', label: 'Chez Adam', color: PALETTE[1] });
    // A's route: the Centrale, the stop done, the one under way, then a, b, c
    expect(r.trucks.find((t) => t.id === 'A')!.legs.map((l) => l.points[1])).toEqual(['done', 'live', 'a', 'b', 'c'].map((id) => {
      const j = base().jobs.find((x) => x.id === id)!; return [j.lat, j.lng];
    }));
  });
  it('a stop put down elsewhere on its truck: its number and the others’ change at once, and the route goes in that order', () => {
    const d = moveTo(draft(), 'c', 'A', 'day', 0);
    const r = layers(d);
    expect(pinsOf(r, 'A')).toEqual([['done', 1], ['live', 1], ['c', 2], ['a', 3], ['b', 4]]);
    expect(r.trucks.find((t) => t.id === 'A')!.legs.slice(2).map((l) => l.points[1])).toEqual(['c', 'a', 'b'].map((id) => { const j = base().jobs.find((x) => x.id === id)!; return [j.lat, j.lng]; }));
    expect(routesKey(layers(draft()).trucks)).not.toBe(routesKey(r.trucks));
  });
  it('onto the other truck: its colour and its number there, the first truck numbered again, the other truck’s route through it', () => {
    const d = moveTo(draft(), 'a', 'B', 'day', 0);
    const r = layers(d, { marked: 'a' });
    expect(pinsOf(r, 'A')).toEqual([['done', 1], ['live', 1], ['b', 2], ['c', 3]]);
    expect(pinsOf(r, 'B')).toEqual([['a', 1], ['d', 2]]);
    expect(colourOf(r, 'a')).toBe(PALETTE[1]);
    // the stop just put down is marked with its name
    expect(r.markers.find((m) => m.id === 'a')).toMatchObject({ active: true, label: 'A' });
    // B's route from its own start through a, then d
    const legs = r.trucks.find((t) => t.id === 'B')!.legs;
    expect(legs[0].points[0]).toEqual([45.45, -73.7]);
    const at = (id: string) => { const j = base().jobs.find((x) => x.id === id)!; return [j.lat, j.lng]; };
    expect(legs.map((l) => l.points[1])).toEqual([at('a'), at('d')]);
  });
});

describe('the roads: never a straight line', () => {
  it('no road known: no line at all (an empty line is never drawn), the pins all there', () => {
    const r = layers(draft());
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines.every((l) => l.points.length === 0)).toBe(true);
    expect(drawable(r.markers, r.lines).lines).toEqual([]);
    expect(drawable(r.markers, r.lines).markers.length).toBe(r.markers.length);
  });
  it('only the legs whose road came are drawn, as the planner gave them, in the truck’s colour', () => {
    const road: LatLng[] = [[45.6, -73.7], [45.62, -73.69], [45.65, -73.72], [45.71, -73.81]];
    const known = (leg: Leg) => (leg.points[1][0] === 45.71 ? road : []);
    const r = layers(draft(), { road: known });
    const drawn = drawable(r.markers, r.lines).lines;
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ points: road, color: PALETTE[1] });
  });
});

describe('the arrival on a pin is the one of its row', () => {
  const RAW = (stops: Record<string, unknown>[]) => ({ ok: true, day: DAY, basis_ok: true, mode: 'windows', stops, trucks: [], lists: [], accept: {} });
  const S = (id: string, o: Record<string, unknown> = {}) => ({ id, truck_id: 'A', eta: 600, eta_before: 600, ...o });
  const cur = (stops: Record<string, unknown>[]) => dayAnswer(RAW(stops)) as DayAnswer;
  const row = (id: string) => ({ a: { eta_min: 540, status: 'booked' }, b: { eta_min: 600, status: 'booked' }, c: { eta_min: 660, eta_measured: false, status: 'booked' } } as Record<string, { eta_min: number; status: string; eta_measured?: boolean }>)[id] as never;
  const ctx = { cur: null as DayAnswer | null, judge: true, changed: new Set(['A']), dragged: new Set(['a']), auto: false, row, unsure: (j: { eta_measured?: boolean | null; eta_min: number | null }) => j.eta_measured === false && j.eta_min != null };
  it('the server answered this draft: its hour; a stop dragged « fixé à » its pinned minute; a trip not measured: none', () => {
    const c = { ...ctx, cur: cur([S('a', { pin_new: true, pin: 935, eta: 935 }), S('b', { eta: 610 }), S('c', { measured: false })]) };
    expect(arrivalOf('a', 'A', c)).toEqual({ min: 935, fixed: true });
    expect(arrivalOf('b', 'A', c)).toEqual({ min: 610, fixed: false });
    expect(arrivalOf('c', 'A', c)).toBeNull();
    // nothing changed (no verdict): its hour, never « fixé »
    expect(arrivalOf('a', 'A', { ...c, judge: false })).toEqual({ min: 935, fixed: false });
  });
  it('while the server is asked: the stop dragged has none yet, the others keep their stored hour (Part 29), a truck unchanged its plan', () => {
    expect(arrivalOf('a', 'A', ctx)).toBeNull();
    expect(arrivalOf('b', 'A', ctx)).toEqual({ min: 600, fixed: false });
    expect(arrivalOf('c', 'A', ctx)).toBeNull();                      // a time counted with a trip not measured
    expect(arrivalOf('b', 'A', { ...ctx, auto: true })).toBeNull();   // the app's order: every stop worked out again
    expect(arrivalOf('b', 'B', { ...ctx, auto: true })).toEqual({ min: 600, fixed: false });
  });
  it('on the pin: the hour beside its number; its name and the row’s words when it is pointed at or just put down', () => {
    const c = cur([S('a', { pin_new: true, pin: 935, eta: 935 }), S('b', { eta: 610 }), S('c', { eta: 700 })]);
    const r = layers(moveTo(draft(), 'a', 'A', 'day', 2), { cur: c, judge: true, changed: new Set(['A']), dragged: new Set(['a']), marked: 'a', spot: 'b' });
    expect(r.markers.find((m) => m.id === 'a')).toMatchObject({ number: 4, label: 'A', sub: 'fixé à 15 h 35', title: '4. A, fixé à 15 h 35' });
    expect(r.markers.find((m) => m.id === 'b')).toMatchObject({ number: 2, label: 'B', sub: 'vers 10 h 10', active: true });
    expect(r.markers.find((m) => m.id === 'c')).toMatchObject({ number: 3, label: undefined, sub: '11 h 40' });
  });
});

describe('open or not, remembered on this device', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it('a phone: closed until opened; a computer: open until closed; each its own', () => {
    localStorage.clear();
    expect([mapOpenPref('phone'), mapOpenPref('wide')]).toEqual([false, true]);
    keepMapOpen('phone', true);
    keepMapOpen('wide', false);
    expect([mapOpenPref('phone'), mapOpenPref('wide')]).toEqual([true, false]);
    expect(localStorage.getItem('his.dayOrder.map.phone')).toBe('1');
  });
  it('no storage (a private window, storage full): the defaults, nothing thrown', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => keepMapOpen('phone', true)).not.toThrow();
    expect([mapOpenPref('phone'), mapOpenPref('wide')]).toEqual([false, true]);
  });
});
