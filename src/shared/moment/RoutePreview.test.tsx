/* The map window beside a moment under the mouse (RouteHover): the real map of that day, with the new appointment in it.
   The map itself and the day are pretended: what is checked is what the window asks the map to draw, its size and its
   words. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { MapViewProps } from '../map/MapView';
import type { TeamMapAnswer } from '../map/assemble';

const seen = vi.hoisted(() => ({ maps: [] as unknown[], day: null as unknown, added: null as { km: number; minutes: number } | null }));
vi.mock('../map/MapView', () => ({ MapView: (p: unknown) => { seen.maps.push(p); return null; } }));
// the roads: every route drawn (roadState 'known'); what the new stop adds, measured by the streets (seen.added; null:
// not measured yet, « Vraies routes »: never a straight-line guess in its place)
vi.mock('../map/useRoads', () => ({ useRoads: () => 0, roadOf: (leg: { points: unknown }) => leg.points, roadTotal: () => null,
  roadState: () => 'known', roadAdded: () => seen.added }));
vi.mock('./deviceDay', () => ({ dayOf: () => seen.day }));

import { lang } from '../../lib/i18n';
import { NEW_STOP, NEW_STOP_COLOR } from './preview';
import { POP } from './place';
import { RouteHover, MapHover, type PreviewAsk } from './RoutePreview';

const box = document.createElement('div');
document.body.appendChild(box);
const pop = () => document.querySelector('[data-testid="route-hover"]') as HTMLElement | null;
const map = () => seen.maps.at(-1) as MapViewProps;
const job = (id: string, truck: string | null, order: number, eta: number, name: string, lat: number, lng: number, status = 'booked') =>
  ({ id, number: order, truck_id: truck, order, eta_min: eta, status, block: 'day', name, address: '', lat, lng });
const DAY: TeamMapAnswer = {
  home: { lat: 45.5005, lng: -73.6577, label: 'Centrale', address: '8255 av. Mountain Sights' },
  trucks: [{ id: 'T1', name: 'Camion Complet', color: '#D3000E', driver_id: null }, { id: 'T2', name: 'Voiture', color: '#2F6FD0', driver_id: null }],
  jobs: [
    job('a', 'T1', 1, 500, 'Julie', 45.5205, -73.6489, 'done'), job('b', 'T1', 2, 600, 'Marc-André', 45.5022, -73.7094), job('c', 'T1', 3, 840, 'Sophie', 45.4972, -73.6588),
    job('d', 'T2', 1, 640, 'Amira', 45.5307, -73.6702), job('e', 'T2', 2, 780, 'Patrick', 45.4772, -73.6213)
  ],
  people: [], trips: []
};
const ASK: PreviewAsk = { day: '2026-11-20', block: 'day', truckId: 'T1', lat: 45.4955, lng: -73.6152, name: '', address: '', when: 'Demain, entre 11 h et 15 h', eta: 720 };
const PICKER = { left: 747, right: 1387, top: 180, bottom: 1400 };
const ROW = { left: 747, right: 955, top: 275, bottom: 347 };
const screen = (w: number, h: number) => { Object.defineProperty(window, 'innerWidth', { value: w, configurable: true }); Object.defineProperty(window, 'innerHeight', { value: h, configurable: true }); };

beforeEach(() => { seen.maps = []; seen.day = DAY; seen.added = { km: 2.4, minutes: 7 }; lang.value = 'fr'; screen(1440, 900); });
afterEach(() => { act(() => render(null, box)); screen(1024, 768); });

describe('the map window of a moment (RouteHover)', () => {
  it('draws the real map of the day: every vehicle’s numbered stops, the start, and the new appointment in black', () => {
    act(() => render(<RouteHover ask={ASK} at={ROW} group={PICKER} />, box));
    const mk = map().markers;
    // both vehicles' stops, each numbered in its own route
    expect(mk.filter((m) => m.color === '#D3000E').map((m) => `${m.id}:${m.number}`)).toEqual(['a:1', 'b:2', 'c:4']);
    expect(mk.filter((m) => m.color === '#2F6FD0').map((m) => `${m.id}:${m.number}`)).toEqual(['d:1', 'e:2']);
    expect(mk.find((m) => m.id === 'a')?.done).toBe(true);
    // where the vehicles leave from, with its name, once
    expect(mk.filter((m) => m.kind === 'home').map((m) => m.label)).toEqual(['Centrale']);
    // the new appointment: black, numbered at its place in the route (after the stops planned before 12 h), named
    expect(mk.find((m) => m.id === NEW_STOP)).toMatchObject({ color: NEW_STOP_COLOR, number: 3, active: true, label: 'Nouveau rendez-vous', lat: ASK.lat, lng: ASK.lng });
    // its moment is the window's title, not a second line on the map
    expect(mk.find((m) => m.id === NEW_STOP)?.sub).toBeUndefined();
    expect(pop()!.querySelector('.bp-pop-when')!.textContent).toBe('Demain, entre 11 h et 15 h');
    // every route is drawn; the route the appointment joins stronger than the other
    const lines = map().lines!;
    expect(lines.some((x) => x.color === '#D3000E') && lines.some((x) => x.color === '#2F6FD0')).toBe(true);
    expect(Math.min(...lines.filter((x) => x.color === '#D3000E').map((x) => x.weight!))).toBeGreaterThan(Math.max(...lines.filter((x) => x.color === '#2F6FD0').map((x) => x.weight!)));
  });
  it('is big: beside the whole picker, as wide and tall as a real map, with no buttons on it', () => {
    act(() => render(<RouteHover ask={ASK} at={ROW} group={PICKER} />, box));
    expect(pop()!.style.width).toBe(`${POP.maxW}px`);
    expect(pop()!.style.left).toBe(`${747 - POP.gap - POP.maxW}px`);
    expect(pop()!.dataset.aside).toBe('1');
    expect(map().height).toBe(`${POP.maxMapH}px`);
    expect(map().controls).toBe(false);
  });
  it('says, under the map, the stops of the route in order (the new one marked) and what is added', () => {
    act(() => render(<RouteHover ask={ASK} at={ROW} group={PICKER} />, box));
    const stops = [...pop()!.querySelectorAll('.bp-pop-stop')] as HTMLElement[];
    expect(stops.map((x) => x.textContent)).toEqual(['1Julie', '2Marc-André', '3Nouveau rendez-vous', '4Sophie']);
    expect(stops.map((x) => x.className.includes('is-new'))).toEqual([false, false, true, false]);
    expect(stops[0].className).toContain('is-done');
    expect((pop()!.querySelector('.bp-pop-stops') as HTMLElement).style.getPropertyValue('--c')).toBe('#D3000E');
    expect(pop()!.querySelector('[data-testid="route-hover-facts"]')!.textContent).toContain('Arrêt 3 sur 4 dans la journée');
    // what it adds, by the streets (main's words were the straight-line « ajoute environ … km (à vol d'oiseau) »: never
    // said since « Vraies routes »; not measured yet, it says so)
    expect(pop()!.querySelector('[data-testid="route-hover-facts"]')!.textContent).toContain('ajoute 2,4 km et 7 min de route');
    seen.added = null;
    act(() => render(<RouteHover ask={{ ...ASK, eta: 721 }} at={ROW} group={PICKER} />, box));
    expect(pop()!.querySelector('[data-testid="route-hover-facts"]')!.textContent).toContain('Route ajoutée : pas encore calculée');
    expect(pop()!.textContent).not.toMatch(/vol d’oiseau|environ/);
  });
  it('a title of its own (a time of the calendar) and the server’s words about the drive (blocks)', () => {
    act(() => render(<RouteHover ask={ASK} at={ROW} group={PICKER} title="Vendredi 20 novembre · Arrivée vers 12 h" road="12 min de route" far />, box));
    expect(pop()!.querySelector('.bp-pop-when')!.textContent).toBe('Vendredi 20 novembre · Arrivée vers 12 h');
    expect([...pop()!.querySelectorAll('[data-testid="route-hover-facts"] > *')].map((x) => x.textContent)).toEqual(['Arrêt 3 sur 4 dans la journée, sur la route', '12 min de route']);
    expect(pop()!.querySelector('.bp-pop-far')).toBeTruthy();
  });
  it('a day nobody works yet: the appointment alone with where the vehicles leave from, and it says so', () => {
    seen.day = { ...DAY, trucks: [], jobs: [] };
    act(() => render(<RouteHover ask={{ ...ASK, truckId: null }} at={ROW} group={PICKER} />, box));
    expect(map().markers.map((m) => m.id)).toEqual(['from', NEW_STOP]);
    expect(pop()!.querySelector('.bp-pop-stops')).toBeNull();
    expect(pop()!.querySelector('[data-testid="route-hover-facts"]')!.textContent).toContain('Aucun camion ne travaille ce jour-là');
  });
  it('a small screen: a smaller map, the window still whole in the screen', () => {
    screen(1024, 600);
    act(() => render(<RouteHover ask={ASK} at={{ left: 301, right: 519, top: 314, bottom: 386 }} group={{ left: 301, right: 1000, top: 150, bottom: 1200 }} />, box));
    expect(pop()!.dataset.aside).toBe('0');
    expect(map().height).toBe(`${600 - 16 - POP.chrome}px`);
    expect(parseFloat(pop()!.style.left) + parseFloat(pop()!.style.width)).toBeLessThanOrEqual(1024 - 8);
  });
  it('goes away with the picker', () => {
    act(() => render(<RouteHover ask={ASK} at={ROW} group={PICKER} />, box));
    expect(pop()).toBeTruthy();
    act(() => render(null, box));
    expect(pop()).toBeNull();
  });
});

describe('the map window of « Tous les jours » (MapHover)', () => {
  it('draws the markers it is given, under its own name', () => {
    act(() => render(<MapHover at={ROW} group={PICKER} title="Tous les rendez-vous à venir" markers={[{ id: 'x', kind: 'job', lat: 45.5, lng: -73.6, number: 21 }]} data-testid="mm-hover-all" />, box));
    const el = document.querySelector('[data-testid="mm-hover-all"]') as HTMLElement;
    expect(el.className).toBe('bp-pop');
    expect(el.textContent).toBe('Tous les rendez-vous à venir');
    expect(map().markers.map((m) => m.number)).toEqual([21]);
  });
});
