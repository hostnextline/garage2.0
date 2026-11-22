/* « Vraies routes » and the windows picker (window mode: the server's rank and route are exact), « Voir sur la carte »
   alone (RoutePreview) and the day map (DayRoute). REAL components; the server's rows pretended; the map replaced by a
   box that keeps its pins. review-moments H2, H3, M1, M4, M5, L1, L2, L3. */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const api = vi.hoisted(() => ({ suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
const maps = vi.hoisted(() => ({ last: new Map<string, { markers: { id: string; number?: unknown }[] }>() }));
const key = vi.hoisted(() => ({ tomtom: '' }));
vi.mock('../../data/api', () => api);
vi.mock('../../data/auth', () => ({ isOwner: () => false, hasRole: () => false }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<Record<string, unknown>>()), get TOMTOM_KEY() { return key.tomtom; } }));
vi.mock('../map/MapView', async () => {
  const { h } = await import('preact');
  return { MapView: (p: { markers: { id: string }[]; 'data-testid'?: string }) => { maps.last.set(p['data-testid'] || '', p); return h('div', { 'data-testid': p['data-testid'] }); } };
});

import { upsertLocal, clearAll } from '../../data/store';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import { forgetRoads } from '../map/roads';
import { BlockPicker, type BlockChoice } from './BlockPicker';
import { RoutePreview } from './RoutePreview';
import { DayRoute } from './DayRoute';
import { forgetWindows } from './useDayWindows';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T17:00:00Z'));
afterAll(() => { vi.useRealTimers(); });
let urls: string[] = [];
globalThis.fetch = ((u: RequestInfo | URL) => { urls.push(String(u)); return new Promise(() => undefined); }) as typeof fetch;

const tomorrow = addDays(today(), 1);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const text = (id: string) => q(id)?.textContent || '';
const wait = async (ms = 800) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const pin = (id: string, map: string) => maps.last.get(map)?.markers.find((m) => m.id === id);
function Host(p: { first?: BlockChoice | null }) {
  const [v, setV] = useState<BlockChoice | null>(p.first ?? null);
  return <BlockPicker lat={45.56} lng={-73.54} duration={60} value={v} onPick={(c) => setV(c)} onClear={() => setV(null)} layout="grid" />;
}
const settingsRow = (o: Record<string, unknown>) => upsertLocal('settings', [{ id: '1', booking: { unknown_min: 20, home: { label: 'Centrale', address: 'x', lat: 45.50, lng: -73.60 }, ...o } } as never], { force: true });
// the best moment of tomorrow (suggest_blocks in window mode: block 'day'), the server's exact place: 2nd of A → new → B
const best = (o: Record<string, unknown> = {}) => ({ day: tomorrow, block: 'day', drive_min: 12, near: 0, truck: 'T1', left: 300, eta: 900, win_start: 840, win_end: 1080,
  add_min: 14, add_km: 5, day_min: 50, day_km: 20, stops: 2, far: null, unmeasured: 0, rank: 2, route: ['A', 'new', 'B'], ...o });
const chosen: BlockChoice = { day: tomorrow, block: 'day', win_start: 840, win_end: 1080, eta: 900, truck: 'T1' };

beforeEach(() => {
  urls = []; key.tomtom = ''; forgetRoads(); maps.last.clear();
  lang.value = 'fr';
  forgetWindows();
  settingsRow({ windows_on: true, roads_on: true });
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  upsertLocal('jobs', [
    { id: 'A', number: 1, day: tomorrow, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 1, eta_min: 600, lat: 45.52, lng: -73.58 },
    { id: 'B', number: 2, day: tomorrow, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 2, eta_min: 1000, lat: 45.54, lng: -73.56 }
  ] as never, { force: true });
  api.suggestBlocks.mockReset().mockResolvedValue([best()]);
  api.suggestWindows.mockReset().mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, day: string) => [best({ day })]);
});
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('windows picker, switch ON: the order is the server’s (window mode: exact)', () => {
  it('the best moment says « Arrêt 1 sur 3 » from the row (the server puts it first), not the phone’s « 2 sur 3 »', async () => {
    api.suggestBlocks.mockResolvedValue([best({ rank: 1, route: ['new', 'A', 'B'] })]);
    act(() => render(<Host />, box));
    await wait();
    expect(text('bp-sugg-order')).toBe('Arrêt 1 sur 3 de la journée');
  });
  it('a row whose trips are not all measured: « Route pas encore mesurée », never its 20-minute unknown time', async () => {
    api.suggestBlocks.mockResolvedValue([best({ unmeasured: 1, drive_min: 20, add_km: null, day_km: null })]);
    act(() => render(<Host />, box));
    await wait();
    expect(text('win-sugg-0')).toContain('Route pas encore mesurée');
    expect(text('win-sugg-0')).not.toMatch(/20 min/);
  });
  it('the first row not measured: never the ★ « Meilleur choix » (its rank counts the unknown time: decision 1, final-guess G2)', async () => {
    api.suggestBlocks.mockResolvedValue([best({ unmeasured: 1, drive_min: 20, add_km: null, day_km: null })]);
    act(() => render(<Host />, box));
    await wait();
    expect(q('win-sugg-0')).not.toBeNull();
    expect(q('win-sugg-0')!.querySelector('.bp-best-star')).toBeNull();
    // measured: the ★ as before
    api.suggestBlocks.mockResolvedValue([best({ unmeasured: 0 })]);
    act(() => render(null, box));
    forgetWindows();
    act(() => render(<Host />, box));
    await wait();
    expect(q('win-sugg-0')!.querySelector('.bp-best-star')).not.toBeNull();
  });
  it('« Voir sur la carte » of the window chosen gets its row: the pins follow the server’s route, what it adds is the row’s', async () => {
    const first = best({ rank: 1, route: ['new', 'A', 'B'] });
    api.suggestBlocks.mockResolvedValue([first]);
    api.suggestWindows.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, day: string) => [{ ...first, day }]);
    act(() => render(<Host first={chosen} />, box));
    await wait();
    act(() => { q('bp-see-map')!.click(); });
    await wait(300);
    expect(text('route-preview-facts')).toContain('Arrêt 1 sur 3 dans la journée, sur la route');
    expect(text('route-preview-extra')).toBe('Ce rendez-vous ajoute 14 min de route (5 km).');
    expect(text('route-preview-day')).toBe('Route de la journée avec ce rendez-vous : 20 km, 50 min');
    expect(['new-stop', 'A', 'B'].map((id) => pin(id, 'route-preview-map')?.number)).toEqual([1, 2, 3]);
  });
  it('switch OFF: the same moment says the phone’s estimate as before (no row read)', async () => {
    settingsRow({ windows_on: true, roads_on: false });
    act(() => render(<Host />, box));
    await wait();
    // eta 900 is after A (600) and before B (1000): the phone's estimate also says 2 of 3 here, from the arrival times
    expect(text('bp-sugg-order')).toBe('Arrêt 2 sur 3 de la journée');
    api.suggestBlocks.mockResolvedValue([best({ rank: 1, route: ['new', 'A', 'B'] })]);
    act(() => render(null, box));
    act(() => render(<Host />, box));
    await wait();
    // the row says first: off, the phone does not read it
    expect(text('bp-sugg-order')).toBe('Arrêt 2 sur 3 de la journée');
  });
});

const ask = (o: Record<string, unknown> = {}) => ({ day: tomorrow, block: 'day', truckId: 'T1', lat: 45.56, lng: -73.54, name: '', address: 'x', when: 'demain', exclude: null, eta: 900, ...o });
const sheet = (a: Record<string, unknown>) => act(() => render(<RoutePreview ask={a as never} onClose={() => {}} />, box));

describe('« Voir sur la carte » alone, switch ON', () => {
  it('a stop the phone has but the route does not name (booked a moment ago): drawn without a number, never above « sur N » (L2)', async () => {
    upsertLocal('jobs', [{ id: 'C', number: 3, day: tomorrow, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 3, eta_min: 1100, lat: 45.53, lng: -73.57 }] as never);
    sheet(ask({ row: best() }));
    await wait(300);
    expect(text('route-preview-facts')).toContain('Arrêt 2 sur 3');
    expect(pin('C', 'route-preview-map')?.number).toBe('');
    expect(pin('B', 'route-preview-map')?.number).toBe(3);
  });
  it('a blocks-mode row (rank and route sent anyway): nothing of the order, the new pin has no number (M5)', async () => {
    settingsRow({ windows_on: false, roads_on: true });
    sheet(ask({ block: 'am', eta: null, row: best({ block: 'am', rank: 1, route: ['new', 'A', 'B'] }) }));
    await wait(300);
    expect(text('route-preview')).not.toMatch(/Arrêt \d+ sur \d+/);
    expect(pin('new-stop', 'route-preview-map')?.number).toBe('');
    expect(text('route-preview-facts')).toContain('Sur la route ce jour-là');
  });
  it('vehicle T1 chosen, the row is T2’s: none of T2’s numbers under T1’s map (L1)', async () => {
    upsertLocal('trucks', [{ id: 'T2', name: 'Camion 2', active: true, sort: 1 }]);
    sheet(ask({ row: best({ truck: 'T2', rank: null, route: null, add_min: 25, add_km: 9, day_min: 90, day_km: 40 }) }));
    await wait(300);
    const txt = text('route-preview');
    expect(txt).not.toMatch(/25 min|40 km|1 h 30/);
    expect(text('route-preview-extra')).toBe('Route ajoutée : pas encore calculée');
  });
  it('no vehicle yet: « Le camion … » with trucks only, « Le véhicule … » when the garage has the car too (L3)', async () => {
    upsertLocal('jobs', [], { force: true });
    upsertLocal('jobs', [{ id: 'Z', number: 9, day: tomorrow, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 1, lat: 45.52, lng: -73.58 }] as never, { force: true });
    sheet(ask({ truckId: null, row: null }));
    await wait(300);
    expect(text('route-preview-facts')).toContain('Le camion n’est pas encore choisi');
    act(() => render(null, box));
    upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0, tire_machine: true }, { id: 'V', name: 'Voiture', active: true, sort: 1, tire_machine: false }], { force: true });
    sheet(ask({ truckId: null, row: null }));
    await wait(300);
    expect(text('route-preview-facts')).toContain('Le véhicule n’est pas encore choisi');
  });
});

describe('the day map (DayRoute): the roads of that day, and the note while they come (M4)', () => {
  it('asks TomTom for that day’s usual hours and says « Route en cours de calcul… »', async () => {
    key.tomtom = 'k';
    act(() => render(<DayRoute day={tomorrow} onClose={() => {}} />, box));
    await wait(600);
    const tt = urls.filter((u) => u.includes('api.tomtom.com/routing'));
    expect(tt.length).toBeGreaterThan(0);
    expect(tt.every((u) => u.includes(`departAt=${tomorrow}T11:30:00`))).toBe(true);
    expect(text('day-route-road')).toMatch(/en cours de calcul/i);
  });
});

/* « Déplacer » with arrival windows (« exact move »): a time chosen is where the appointment lands, on ITS truck, every
   other stop keeping its order. The planner's row of that window may put it on the car, first of the car's route: the map
   of that time must not say so (merge-main review M-1: main's big hover and its strip of stops, with our exact move) */
describe('« Déplacer » to a time (exact move): the map shows the appointment on its own truck at that time, never the planner’s vehicle or place (M-1)', () => {
  function MoveHost(p: { first?: BlockChoice | null }) {
    const [v, setV] = useState<BlockChoice | null>(p.first ?? null);
    return <BlockPicker lat={45.56} lng={-73.54} duration={60} excludeJob="M" exactMove value={v} onPick={(c) => setV(c)} onClear={() => setV(null)} layout="grid" />;
  }
  // the planner's row: the car V, first of its route
  const onCar = (o: Record<string, unknown> = {}) => best({ truck: 'V', rank: 1, route: ['new', 'D'], stops: 1, ...o });
  beforeEach(() => {
    upsertLocal('trucks', [{ id: 'T1', name: 'Camion Complet', active: true, sort: 0, tire_machine: true }, { id: 'V', name: 'Voiture', active: true, sort: 1, tire_machine: false }], { force: true });
    upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].flatMap((dow) => [{ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] }, { id: `v${dow}`, truck_id: 'V', dow, ranges: [[480, 1200]] }]), { force: true });
    upsertLocal('jobs', [
      { id: 'M', number: 7, day: tomorrow, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, stop_order: 2, eta_min: 700, win_start: 600, win_end: 840, lat: 45.56, lng: -73.54 },
      { id: 'D', number: 4, day: tomorrow, block: 'day', status: 'booked', truck_id: 'V', duration_min: 60, stop_order: 1, eta_min: 640, lat: 45.53, lng: -73.67 }
    ] as never);
    api.suggestBlocks.mockResolvedValue([onCar()]);
    api.suggestWindows.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, day: string) => [onCar({ day })]);
  });
  it('switch ON: its truck named, its time, no « Arrêt n sur N », the new pin without a number; the best moment says no place either', async () => {
    act(() => render(<MoveHost first={{ ...chosen, truck: 'V' }} />, box));
    await wait();
    expect(q('bp-sugg-order')).toBeNull();
    act(() => { q('bp-see-map')!.click(); });
    await wait(300);
    expect(text('route-preview-facts')).toContain('Arrive à 15 h (Camion Complet). Les autres arrêts gardent leur ordre.');
    expect(text('route-preview')).not.toMatch(/Arrêt \d+ sur \d+|Voiture/);
    expect(pin('new-stop', 'route-preview-map')?.number).toBe('');
    // the truck's own stops keep their numbers; the car's stop is not renumbered around the appointment
    expect(['A', 'B'].map((id) => pin(id, 'route-preview-map')?.number)).toEqual([1, 2]);
    expect(pin('D', 'route-preview-map')?.number).toBe(1);
    expect(text('route-preview')).toContain('Avant de déplacer, l’app vérifie');
  });
  it('switch OFF: the same (the phone does not guess the place of an exact move either)', async () => {
    settingsRow({ windows_on: true, roads_on: false });
    act(() => render(<MoveHost first={{ ...chosen, truck: 'V' }} />, box));
    await wait();
    act(() => { q('bp-see-map')!.click(); });
    await wait(300);
    expect(text('route-preview-facts')).toContain('Arrive à 15 h (Camion Complet).');
    expect(text('route-preview')).not.toMatch(/Arrêt \d+ sur \d+/);
    expect(pin('new-stop', 'route-preview-map')?.number).toBe('');
  });
  it('its truck does not work that day: the vehicle offered there (the move takes it, and its question says so)', async () => {
    upsertLocal('truck_days', [{ id: 'off', truck_id: 'T1', day: tomorrow, ranges: [] }] as never, { force: true });
    act(() => render(<MoveHost first={{ ...chosen, truck: 'V' }} />, box));
    await wait();
    act(() => { q('bp-see-map')!.click(); });
    await wait(300);
    expect(text('route-preview-facts')).toContain('Arrive à 15 h (Voiture).');
  });
  it('the booking screen (no exactMove): the planner’s row as before', async () => {
    act(() => render(<BlockPicker lat={45.56} lng={-73.54} duration={60} value={{ ...chosen, truck: 'V' }} onPick={() => {}} layout="grid" />, box));
    await wait();
    act(() => { q('bp-see-map')!.click(); });
    await wait(300);
    expect(text('route-preview-facts')).toContain('Arrêt 1 sur 2');
  });
});
