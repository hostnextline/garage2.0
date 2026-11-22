/* « Réorganiser la journée » (Part 28, REARRANGE.md §2.3, §2.7, U1): the draft and its moves, where a stop may go, the
   basis sent to the server, and the rebase when someone else changed the day (the person's moves kept, nobody else's
   work undone). */
import { describe, it, expect, afterEach } from 'vitest';
import type { Access, Job } from '../../data/types';
import { access } from '../../data/auth';
import { replaceLocal } from '../../data/store';
import { addDays, today } from '../../lib/dates';
import {
  END, backToPlace, blocksOf, canDrop, changed, changedTrucks, draftOf, dropIndex, listsOf, mayOrderDay, moveBy, moveTo,
  movedOf, placeOf, putFirst, putOn, rebase, trucksOf, wasKey, wasOf, withLists, worksOn, type Draft, type DropCtx
} from './dayOrder';

const DAY = addDays(today(), 3);
const J = (id: string, number: number, truck: string | null, stop: number | null, o: Partial<Job> = {}) =>
  ({ id, number, customer_id: `c-${id}`, truck_id: truck, day: DAY, block: 'day', status: 'booked', stop_order: stop, duration_min: 60,
    travel_min: 20, eta_min: 480 + (stop ?? 0) * 60, win_start: 480, win_end: 720, arrive_at: null, deleted_at: null, ...o }) as unknown as Job;
/** truck A: one on site, then a, b, c; truck B: d, e; one « À placer »; one of another day; one done */
const world = () => [
  J('live', 1, 'A', 1, { status: 'on_site' }),
  J('a', 2, 'A', 2), J('b', 3, 'A', 3), J('c', 4, 'A', 4, { arrive_at: 600 }),
  J('d', 5, 'B', 1), J('e', 6, 'B', 2),
  J('loose', 7, null, null),
  J('other', 8, 'A', 1, { day: addDays(DAY, 1) }),
  J('fini', 9, 'A', 0, { status: 'done' })
];
const base = () => draftOf(world(), ['A', 'B'], DAY, ['day']);
const ids = (d: Draft, truck: string) => d.lists.find((l) => l.truck === truck)!.jobs;
const ctx = (o: Partial<DropCtx> = {}): DropCtx => ({
  book: true, trucks: [{ id: 'A', tire_machine: true }, { id: 'B', tire_machine: true }], works: () => true, ...o
});

afterEach(() => { access.value = null; });

describe('the draft of a day', () => {
  it('each truck: its stops under way first (fixed), then its booked stops in the stored order; « À placer », other days and done ones are not listed', () => {
    const d = base();
    expect(d.lists).toEqual([
      { truck: 'A', block: 'day', live: ['live'], jobs: ['a', 'b', 'c'] },
      { truck: 'B', block: 'day', live: [], jobs: ['d', 'e'] }
    ]);
    expect(d.base.b).toEqual({ truck: 'A', block: 'day', index: 1 });
    expect(changed(d)).toBe(false);
    expect(movedOf(d)).toEqual([]);
  });
  it('p_was: every booked / en route / on site stop of that day on the listed trucks, seven values, never the times', () => {
    const w = wasOf(world(), ['A', 'B'], DAY);
    expect(Object.keys(w).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'live']);
    expect(w.c).toEqual(['A', 'day', 4, 480, 720, 600, 'booked']);
    expect(w.live).toEqual(['A', 'day', 1, 480, 720, null, 'on_site']);
    // the background re-times the day all the time: eta, travel, updated_at are never part of the basis
    const later = world().map((j) => ({ ...j, eta_min: (j.eta_min ?? 0) + 7, travel_min: 99, updated_at: 'x' }));
    expect(wasKey(wasOf(later, ['A', 'B'], DAY))).toBe(wasKey(w));
    expect(wasKey(wasOf(world().map((j) => (j.id === 'a' ? { ...j, stop_order: 9 } : j)), ['A', 'B'], DAY))).not.toBe(wasKey(w));
  });
  it('listsOf: p_lists, each truck with its booked stops in the order wanted', () => {
    expect(listsOf(putFirst(base(), 'c'))).toEqual([{ truck: 'A', block: 'day', jobs: ['c', 'a', 'b'] }, { truck: 'B', block: 'day', jobs: ['d', 'e'] }]);
  });
  it('blocks mode: one list per truck and block, a drag stays in its block', () => {
    const rows = [J('m1', 1, 'A', 1, { block: 'am' }), J('m2', 2, 'A', 2, { block: 'am' }), J('p1', 3, 'A', 1, { block: 'pm' })];
    const d = draftOf(rows, ['A'], DAY, ['am', 'pm', 'eve']);
    expect(d.lists.map((l) => [l.block, l.jobs])).toEqual([['am', ['m1', 'm2']], ['pm', ['p1']], ['eve', []]]);
    expect(moveTo(d, 'p1', 'A', 'am', 0)).toBe(d);                                   // another block: refused
    expect(canDrop(d, { id: 'p1' }, 'A', 'am', ctx())).toBe('block');
  });
});

describe('the moves', () => {
  it('moveTo: the place AFTER the move, clamped after the stops under way and to the end; the id joins moved', () => {
    const d = moveTo(base(), 'c', 'A', 'day', -5);
    expect(ids(d, 'A')).toEqual(['c', 'a', 'b']);
    expect(d.moved).toEqual(['c']);
    expect(ids(moveTo(base(), 'a', 'A', 'day', END), 'A')).toEqual(['b', 'c', 'a']);
    expect(moveTo(base(), 'a', 'A', 'day', 0)).toEqual(base());                    // its own place: nothing moved
    expect(moveTo(base(), 'nobody', 'A', 'day', 0)).toEqual(base());
  });
  it('onto the other truck; dropIndex turns « before row p as drawn » into the place after the move', () => {
    const d = moveTo(base(), 'a', 'B', 'day', 1);
    expect(ids(d, 'A')).toEqual(['b', 'c']);
    expect(ids(d, 'B')).toEqual(['d', 'a', 'e']);
    // dragged a (index 0) to « before c » (index 2 as drawn): after removal it is index 1
    expect(dropIndex(base(), 'a', 'A', 'day', 2)).toBe(1);
    expect(dropIndex(base(), 'c', 'A', 'day', 0)).toBe(0);
    expect(dropIndex(base(), 'a', 'B', 'day', 2)).toBe(2);
  });
  it('moveBy, putFirst, putOn (its end), the keyboard moves', () => {
    expect(ids(moveBy(base(), 'b', -1), 'A')).toEqual(['b', 'a', 'c']);
    expect(ids(moveBy(base(), 'b', 1), 'A')).toEqual(['a', 'c', 'b']);
    expect(moveBy(base(), 'a', -1)).toEqual(base());                               // already first
    expect(ids(putFirst(base(), 'c'), 'A')).toEqual(['c', 'a', 'b']);
    const on = putOn(base(), 'b', 'B');
    expect(ids(on, 'B')).toEqual(['d', 'e', 'b']);
    // ← → keep the same place on the other truck, or its end
    expect(ids(moveTo(base(), 'b', 'B', 'day', 1), 'B')).toEqual(['d', 'b', 'e']);
    expect(ids(moveTo(base(), 'c', 'B', 'day', 2), 'B')).toEqual(['d', 'e', 'c']);
  });
  it('movedOf drops a stop put back at its own place (it keeps its pinned minute: days F8); « Remettre à sa place » does that', () => {
    let d = moveBy(base(), 'c', -1);
    expect(movedOf(d)).toEqual(['c']);
    d = moveBy(d, 'c', 1);
    expect(movedOf(d)).toEqual([]);
    expect(changed(d)).toBe(false);
    const far = putOn(putFirst(base(), 'b'), 'c', 'B');
    expect(movedOf(far).sort()).toEqual(['b', 'c']);
    const back = backToPlace(far, 'c');
    expect(placeOf(back, 'c')).toEqual({ truck: 'A', block: 'day', index: 2 });
    expect(movedOf(back)).toEqual(['b']);
    expect(back.moved).toEqual(['b']);
  });
  it('changed and changedTrucks: only the trucks whose list differs', () => {
    expect([...changedTrucks(base())]).toEqual([]);
    expect([...changedTrucks(moveBy(base(), 'd', 1))]).toEqual(['B']);
    expect([...changedTrucks(putOn(base(), 'a', 'B'))].sort()).toEqual(['A', 'B']);
    expect(changed({ ...base(), auto: true })).toBe(true);
  });
  it('withLists: the planner\'s lists become the draft (auto), a stop it did not list stays at the end of its truck', () => {
    const d = withLists(base(), [{ truck: 'A', block: 'day', jobs: ['c', 'a'] }, { truck: 'B', block: 'day', jobs: ['e', 'd', 'ghost'] }]);
    expect(ids(d, 'A')).toEqual(['c', 'a', 'b']);
    expect(ids(d, 'B')).toEqual(['e', 'd']);
    expect(d.auto).toBe(true);
    expect(d.moved).toEqual([]);
  });
});

describe('where a stop may go (canDrop)', () => {
  it('its own truck always; another truck only with « Réserver », working that day, with the machine for tire work', () => {
    const d = base();
    expect(canDrop(d, { id: 'a' }, 'A', 'day', ctx({ book: false }))).toBeNull();
    expect(canDrop(d, { id: 'a' }, 'B', 'day', ctx({ book: false }))).toBe('right');
    expect(canDrop(d, { id: 'a' }, 'B', 'day', ctx({ works: (t) => t !== 'B' }))).toBe('off');
    const car = ctx({ trucks: [{ id: 'A', tire_machine: true }, { id: 'B', tire_machine: false }] });
    expect(canDrop(d, { id: 'a', needs_machine: true }, 'B', 'day', car)).toBe('machine');
    expect(canDrop(d, { id: 'a' }, 'B', 'day', ctx())).toBeNull();
  });
  it("'kind' between a Camion and a Voiture (asked, not refused); not once it is there, nor back home", () => {
    const car = ctx({ trucks: [{ id: 'A', tire_machine: true }, { id: 'B', tire_machine: false }] });
    expect(canDrop(base(), { id: 'a' }, 'B', 'day', car)).toBe('kind');
    const there = putOn(base(), 'a', 'B');
    expect(canDrop(there, { id: 'a' }, 'B', 'day', car)).toBeNull();                 // moving it again on the car
    expect(canDrop(there, { id: 'a' }, 'A', 'day', car)).toBeNull();                 // back to its own truck
  });
});

describe('rebase (someone else changed the day: days F2)', () => {
  it('a stop NOT moved takes the server\'s truck and order (the other person\'s save kept); a moved one goes back after the same neighbour', () => {
    // the person put c right after a on truck A
    const mine = moveTo(base(), 'c', 'A', 'day', 1);
    expect(ids(mine, 'A')).toEqual(['a', 'c', 'b']);
    // meanwhile someone saved the day: b first, then a, c; and e moved to truck A
    const server = world().map((j) => (j.id === 'b' ? { ...j, stop_order: 2 } : j.id === 'a' ? { ...j, stop_order: 3 } : j.id === 'e' ? { ...j, truck_id: 'A', stop_order: 5 } : j));
    const r = rebase(mine, server, ['A', 'B'], ['day']);
    expect(ids(r.draft, 'A')).toEqual(['b', 'a', 'c', 'e']);
    expect(ids(r.draft, 'B')).toEqual(['d']);
    expect(r.draft.moved).toEqual(['c']);
    expect(movedOf(r.draft)).toEqual([]);                                           // after a = its server place now: keeps its pin
    expect(r.what.moved).toEqual(['e']);
    expect(r.draft.was).toEqual(wasOf(server, ['A', 'B'], DAY));
  });
  it('the neighbour gone: after the nearest earlier stop still there; none: first after the stops under way', () => {
    const mine = moveTo(base(), 'c', 'A', 'day', 1);                                 // a, c, b
    const aGone = world().filter((j) => j.id !== 'a');
    expect(ids(rebase(mine, aGone, ['A', 'B'], ['day']).draft, 'A')).toEqual(['c', 'b']);
    const mine2 = moveTo(moveTo(base(), 'c', 'A', 'day', 0), 'b', 'A', 'day', 1);  // c, b, a
    expect(ids(mine2, 'A')).toEqual(['c', 'b', 'a']);
    // two moved stops one after the other: the first is placed, the second goes after it
    expect(ids(rebase(mine2, world(), ['A', 'B'], ['day']).draft, 'A')).toEqual(['c', 'b', 'a']);
  });
  it('gone (cancelled), under way (started), new (« Nouveau », at its server place), auto ends', () => {
    const mine = { ...moveTo(base(), 'a', 'B', 'day', 0), auto: true };
    const server = [
      ...world().filter((j) => j.id !== 'd').map((j) => (j.id === 'b' ? { ...j, status: 'en_route' as const } : j)),
      J('zoe', 10, 'A', 3)                                                              // booked meanwhile, between b and c
    ];
    const r = rebase(mine, server, ['A', 'B'], ['day']);
    expect(r.what).toEqual({ added: ['zoe'], gone: ['d'], started: ['b'], moved: [] });
    const A = r.draft.lists.find((l) => l.truck === 'A')!;
    expect(A.live).toEqual(['live', 'b']);
    expect(A.jobs).toEqual(['zoe', 'c']);
    expect(ids(r.draft, 'B')).toEqual(['a', 'e']);                                    // a kept where the person put it
    expect(r.draft.news).toEqual(['zoe']);
    expect(r.draft.auto).toBe(false);
  });
  it('a moved stop started meanwhile leaves the moves; a kept draft (no basis, no stops under way) comes back through the same rebase', () => {
    const mine = putFirst(base(), 'c');
    const server = world().map((j) => (j.id === 'c' ? { ...j, status: 'en_route' as const } : j));
    const r = rebase(mine, server, ['A', 'B'], ['day']);
    expect(r.draft.moved).toEqual([]);
    expect(r.what.started).toEqual(['c']);
    const kept = { day: DAY, lists: listsOf(putFirst(base(), 'c')), moved: ['c'], auto: false };
    const back = rebase(kept, world(), ['A', 'B'], ['day']);
    expect(ids(back.draft, 'A')).toEqual(['c', 'a', 'b']);
    expect(movedOf(back.draft)).toEqual(['c']);
    expect(changed(back.draft)).toBe(true);
  });
});

describe('the device\'s copy: who rearranges which trucks', () => {
  const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
  const office = { id: 'nadia', owner: false, roles: ['office'], rights: { book: true }, trucks: [] } as unknown as Access;
  const mechanic = { id: 'saleh', owner: false, roles: ['mechanic'], rights: {}, trucks: ['B'] } as unknown as Access;
  const seed = (windows = true) => {
    replaceLocal('settings', [{ id: '1', booking: { windows_on: windows } } as never]);
    replaceLocal('trucks', [
      { id: 'A', name: 'Camion', active: true, sort: 1, tire_machine: true },
      { id: 'B', name: 'Voiture', active: true, sort: 2, tire_machine: false },
      { id: 'C', name: 'Vieux', active: false, sort: 3 }
    ] as never);
    const dow = new Date(`${DAY}T12:00:00Z`).getUTCDay();
    replaceLocal('truck_week', [{ id: 'w1', truck_id: 'A', dow, ranges: [[480, 1020]] }, { id: 'w2', truck_id: 'B', dow, ranges: [[480, 720]] }] as never);
    replaceLocal('truck_days', [] as never);
    replaceLocal('jobs', world() as never);
  };
  it('mayOrderDay: today or later with a booked stop on a truck the person may order', () => {
    seed();
    access.value = owner;
    expect(mayOrderDay(DAY)).toBe(true);
    expect(mayOrderDay(addDays(today(), -1))).toBe(false);
    expect(mayOrderDay(addDays(DAY, 9))).toBe(false);
    access.value = mechanic;
    expect(mayOrderDay(DAY)).toBe(true);                                              // d, e on his truck
    access.value = { ...mechanic, trucks: ['Z'] } as Access;
    expect(mayOrderDay(DAY)).toBe(false);
  });
  it('trucksOf: owner / « Réserver » every active truck that works or holds a stop; a mechanic only his', () => {
    seed();
    access.value = owner;
    expect(trucksOf(DAY)).toEqual(['A', 'B']);
    access.value = office;
    expect(trucksOf(DAY)).toEqual(['A', 'B']);
    access.value = mechanic;
    expect(trucksOf(DAY)).toEqual(['B']);
    expect(worksOn('B', DAY, 'day')).toBe(true);
    expect(worksOn('C', DAY, 'day')).toBe(false);
  });
  it('blocksOf: windows mode the whole day; blocks mode the garage\'s blocks in order; worksOn by the block\'s hours', () => {
    seed(true);
    expect(blocksOf()).toEqual(['day']);
    seed(false);
    expect(blocksOf()).toEqual(['am', 'pm', 'eve']);
    expect(worksOn('B', DAY, 'am')).toBe(true);
    expect(worksOn('B', DAY, 'pm')).toBe(false);                                     // the Voiture ends at noon
  });
});
