/* « La nouvelle journée » (Part 30, K3): after a booking at a minute that changed the day, the new map of that day — every
   vehicle in its new order with numbered stops, the new appointment « Nouveau », the ones pushed later and the ones late
   marked (on the map and in the list), the routes by the streets only when they come (never a straight line), « Voir le
   rendez-vous » / « Fermer ». The map itself and the day are pretended; what is checked is what it asks the map to draw. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { MapViewProps } from '../map/MapView';
import type { TeamMapAnswer } from '../map/assemble';

const seen = vi.hoisted(() => ({ maps: [] as unknown[], day: null as unknown, roads: false }));
vi.mock('../map/MapView', () => ({ MapView: (p: unknown) => { seen.maps.push(p); return null; } }));
// the roads: none yet (roadOf answers nothing: never a straight line), or every one drawn by the streets
vi.mock('../map/useRoads', () => ({ useRoads: () => 0, roadOf: (leg: { points: [number, number][] }) => (seen.roads ? [leg.points[0], [45.51, -73.62], leg.points[1]] : []),
  roadState: () => (seen.roads ? 'known' : 'asking') }));
vi.mock('./deviceDay', () => ({ dayOf: () => seen.day }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../platform/router', async (orig) => ({ ...(await orig<typeof import('../../platform/router')>()), navigate: nav.navigate }));

import { lang } from '../../lib/i18n';
import { BookedMap, markOf, markWords, openBookedMap, bookedMapShown, closeBookedMap, type BookedMapAsk } from './BookedMap';
import { NEW_STOP_COLOR } from './preview';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const map = () => seen.maps.at(-1) as MapViewProps;
const job = (id: string, truck: string, order: number, eta: number, name: string, lat: number, lng: number) =>
  ({ id, number: order, truck_id: truck, order, eta_min: eta, status: 'booked', block: 'day', name, address: '', lat, lng });
// the day as the phone holds it right after the booking: the new one (N) second on the Camion, Denis pushed late after it
const DAY: TeamMapAnswer = {
  home: { lat: 45.5005, lng: -73.6577, label: 'Centrale', address: '8255 av. Mountain Sights' },
  trucks: [{ id: 'T1', name: 'Camion', color: '#D3000E', driver_id: null }, { id: 'T2', name: 'Voiture', color: '#2F6FD0', driver_id: null }],
  jobs: [job('a', 'T1', 1, 500, 'Julie', 45.5205, -73.6489), job('N', 'T1', 2, 840, 'Nadia', 45.4955, -73.6152), job('d', 'T1', 3, 965, 'Denis', 45.4972, -73.6588),
    job('e', 'T1', 4, 1040, 'Emma', 45.4772, -73.6213), job('v', 'T2', 1, 640, 'Amira', 45.5307, -73.6702)],
  people: [], trips: []
};
const ASK: BookedMapAsk = { day: '2026-11-26', jobId: 'N', at: 840,
  marks: [{ id: 'a', late: false, lateMin: 0, delay: 0, etaAfter: 500 }, { id: 'd', late: true, lateMin: 25, delay: 105, etaAfter: 965 }, { id: 'e', late: false, lateMin: 0, delay: 40, etaAfter: 1040 }] };

beforeEach(() => { seen.maps = []; seen.day = DAY; seen.roads = false; lang.value = 'fr'; nav.navigate.mockReset(); });
afterEach(() => { act(() => render(null, box)); closeBookedMap(); });

describe('the marks (pure)', () => {
  it('new, late, pushed, or nothing; their words', () => {
    expect(markOf('N', ASK).kind).toBe('new');
    expect(markOf('d', ASK).kind).toBe('late');
    expect(markOf('e', ASK).kind).toBe('pushed');
    expect(markOf('a', ASK).kind).toBeNull();
    expect(markOf('v', ASK).kind).toBeNull();
    expect(markWords('new', null, 840, 'fr')).toBe('14 h');
    expect(markWords('late', markOf('d', ASK).mark, 840, 'fr')).toBe('en retard de 25 min');
    expect(markWords('pushed', markOf('e', ASK).mark, 840, 'fr')).toBe('plus tard : 17 h 20');
    expect(markWords('late', markOf('d', ASK).mark, 840, 'en')).toBe('25 min late');
  });
});

describe('the new map of the day', () => {
  it('every vehicle’s stops numbered in the new order; the new one in black « Nouveau 14 h », Denis late in red, Emma later; the list says the same', () => {
    act(() => render(<BookedMap ask={ASK} onClose={() => undefined} onSee={() => undefined} />, box));
    const mk = map().markers;
    const n = mk.find((m) => m.id === 'N')!;
    expect([n.number, n.color, n.active, n.label, n.sub]).toEqual([2, NEW_STOP_COLOR, true, 'Nouveau', '14 h']);
    const d = mk.find((m) => m.id === 'd')!;
    expect([d.number, d.active, d.label, d.sub]).toEqual([3, true, 'Denis', 'en retard de 25 min']);
    expect(mk.find((m) => m.id === 'e')!.sub).toBe('plus tard : 17 h 20');
    expect(mk.find((m) => m.id === 'a')!.sub).toBeUndefined();
    expect(mk.find((m) => m.id === 'v')!.number).toBe(1);
    expect(mk.some((m) => m.kind === 'home')).toBe(true);
    // the list, in the new order of each vehicle
    const camion = [...q('booked-map-truck-T1')!.querySelectorAll('li')].map((li) => [li.dataset.n, li.dataset.mark, li.textContent]);
    expect(camion).toEqual([['1', '', '1Julie8 h 20'], ['2', 'new', '2Nouveau14 h'], ['3', 'late', '3Denisen retard de 25 min'], ['4', 'pushed', '4Emmaplus tard : 17 h 20']]);
    expect(q('booked-map-truck-T2')?.textContent).toContain('Amira');
  });
  it('never a straight line: nothing between two stops until a real road comes (said under the map), then the roads by the streets', () => {
    act(() => render(<BookedMap ask={ASK} onClose={() => undefined} onSee={() => undefined} />, box));
    expect((map().lines ?? []).every((l) => l.points.length === 0)).toBe(true);
    expect(q('booked-map-road')?.textContent).toBeTruthy();
    seen.roads = true;
    act(() => render(<BookedMap ask={{ ...ASK, marks: [...ASK.marks] }} onClose={() => undefined} onSee={() => undefined} />, box));
    expect((map().lines ?? []).length).toBeGreaterThan(0);
    expect((map().lines ?? []).every((l) => l.points.length >= 3)).toBe(true);
  });
  it('« Voir le rendez-vous » opens the appointment; « Fermer » closes (the host, in its own root)', async () => {
    openBookedMap(ASK);
    await act(async () => { await Promise.resolve(); });
    expect(bookedMapShown()).toEqual(ASK);
    expect(q('booked-map')).toBeTruthy();
    await act(async () => { q('booked-map-see')!.click(); });
    expect(nav.navigate).toHaveBeenCalledWith('/job/N');
    expect(bookedMapShown()).toBeNull();
    openBookedMap(ASK);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { q('booked-map-close')!.click(); });
    expect(bookedMapShown()).toBeNull();
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });
});
