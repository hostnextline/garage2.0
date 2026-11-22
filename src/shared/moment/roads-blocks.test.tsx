/* « Vraies routes » and the blocks picker (booking, « Appel entrant », « Coller », « Déplacer »): the REAL BlockPicker,
   MomentMap and RoutePreview, the server's rows pretended, the map itself replaced by a box that keeps what it was given
   (its pins). Switch OFF = the rollback state (as before, minus the straight-line words); ON = the phone decides nothing
   by straight line (review-moments H1, H2, H3, M1, M2, M4, M5). */
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
import { forgetWindows } from './useDayWindows';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T17:00:00Z'));
afterAll(() => { vi.useRealTimers(); });

/* the roads of the maps: `mode` silent (asked, never answered) or osrm (4 points: 12 km / 30 min, else 8 km / 20 min) */
let mode: 'silent' | 'osrm' = 'silent';
let urls: string[] = [];
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
globalThis.fetch = ((input: RequestInfo | URL) => {
  const u = String(input);
  urls.push(u);
  if (mode === 'silent' || !u.includes('/driving/')) return new Promise(() => undefined);
  const n = u.split('/driving/')[1].split('?')[0].split(';').length;
  const [m, s] = n === 4 ? [12000, 1800] : [8000, 1200];
  return json({ code: 'Ok', routes: [{ distance: m, duration: s, legs: Array.from({ length: n - 1 }, (_, i) => ({ steps: [{ geometry: { coordinates: [[-73.6, 45.5 + i / 100], [-73.59, 45.51 + i / 100]] } }] })) }] });
}) as typeof fetch;

const tomorrow = addDays(today(), 1);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const text = (id: string) => q(id)?.textContent || '';
const wait = async (ms = 800) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
let picked: (BlockChoice | null)[] = [];
function Host(p: { first?: BlockChoice | null; duration?: number; truckId?: string }) {
  const [v, setV] = useState<BlockChoice | null>(p.first ?? null);
  return <BlockPicker lat={45.56} lng={-73.54} duration={p.duration ?? 60} value={v} onPick={(c) => { picked.push(c); setV(c); }} onClear={() => setV(null)} layout="grid" truckId={p.truckId} />;
}
const draw = (p: { first?: BlockChoice | null; duration?: number; truckId?: string } = {}) => act(() => render(<Host {...p} />, box));
const roads = (on: boolean) => upsertLocal('settings', [{ id: '1', booking: { windows_on: false, roads_on: on, unknown_min: 20,
  home: { label: 'Centrale', address: 'x', lat: 45.50, lng: -73.60 } } } as never], { force: true });
const row = (o: Record<string, unknown> = {}) => ({ day: tomorrow, block: 'am', drive_min: 10, near: 0, truck: 'T1', left: 100, add_min: 10, add_km: 3, day_min: 40, hop_min: 10, stops: 2, far: null, ...o });
const pin = (id: string, map = 'mm-map') => maps.last.get(map)?.markers.find((m) => m.id === id);

beforeEach(() => {
  mode = 'silent'; urls = []; key.tomtom = ''; forgetRoads(); maps.last.clear(); picked = [];
  lang.value = 'fr';
  forgetWindows();
  roads(true);
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  upsertLocal('jobs', [
    { id: 'A', number: 1, day: tomorrow, block: 'am', status: 'booked', truck_id: 'T1', duration_min: 60, travel_min: 5, stop_order: 1, lat: 45.52, lng: -73.58 },
    { id: 'B', number: 2, day: tomorrow, block: 'am', status: 'booked', truck_id: 'T1', duration_min: 60, travel_min: 5, stop_order: 2, lat: 45.54, lng: -73.56 }
  ] as never, { force: true });
  api.suggestBlocks.mockReset();
  api.suggestWindows.mockReset().mockResolvedValue([]);
});
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('switch OFF (rollback state): « Choisir sur la carte » says nothing guessed', () => {
  it('no row for the block (offline, or not offered): no raw key, no « environ », no km under it', async () => {
    roads(false);
    api.suggestBlocks.mockResolvedValue([]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    const am = text('mm-block-am');
    expect(am).not.toContain('booking.');
    expect(am).not.toMatch(/environ|km/);
    // the phone's own estimate of the place stays (rollback state): « Arrêt 3 sur 3 »
    expect(am).toMatch(/Arrêt 3 sur 3/);
  });
  it('the block highlighted, no row: what it adds by the streets, both totals from ONE planner (OSRM here), never a straight line', async () => {
    roads(false);
    mode = 'osrm';
    api.suggestBlocks.mockResolvedValue([]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait(2500);
    expect(text('mm-block-am')).toContain('+12 min de route (4 km)');
    // another block of the day has no road of its own on the map: nothing is said there
    expect(text('mm-block-pm')).not.toMatch(/min de route|km/);
  });
  it('the day is asked at its own hours (departAt of that day), and the note says the road is being worked out', async () => {
    roads(false);
    key.tomtom = 'k';
    api.suggestBlocks.mockResolvedValue([]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait(1200);
    const tt = urls.filter((u) => u.includes('api.tomtom.com/routing'));
    expect(tt.length).toBeGreaterThan(0);
    expect(tt.every((u) => u.includes(`departAt=${tomorrow}T11:30:00`))).toBe(true);
    expect(text('mm-road')).toMatch(/en cours de calcul/i);
  });
});

describe('switch ON: « Meilleur choix » never on a moment whose trips are not all measured (decision 1, final-guess G2)', () => {
  it('the first row unmeasured: no « Meilleur choix »; measured: as before', async () => {
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 2, add_km: null }), row({ block: 'pm', unmeasured: 2, add_km: null })]);
    draw();
    await wait();
    expect(all('bp-sugg').length).toBeGreaterThan(0);
    expect(all('bp-sugg').map((x) => x.textContent || '').join(' ')).not.toContain('Meilleur choix');
    act(() => render(null, box));
    forgetWindows();
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 0 }), row({ block: 'pm', unmeasured: 0 })]);
    draw();
    await wait();
    expect(all('bp-sugg')[0]?.textContent || '').toContain('Meilleur choix');
  });
});

describe('switch ON: the order, the pins and what it adds come from the server row (blocks mode: nothing of the order)', () => {
  it('a blocks-mode row that still carries rank / route (sql-fix F2 not landed): no « Arrêt n sur N » anywhere, the new pin has no number', async () => {
    api.suggestBlocks.mockResolvedValue([row({ rank: 1, route: ['new', 'A', 'B'], unmeasured: 0, day_km: 12 })]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    expect(all('bp-sugg')[0]?.textContent || '').not.toMatch(/Arrêt \d+ sur \d+|Premier arrêt/);
    expect(text('mm-block-am')).not.toMatch(/Arrêt \d+ sur \d+/);
    expect(pin('new-stop')?.number).toBe('');
    // the day as it is: A and B keep their own order
    expect([pin('A')?.number, pin('B')?.number]).toEqual([1, 2]);
    expect(text('mm-facts')).toContain('Sur la route ce jour-là : sa place dans la route est choisie quand tu réserves');
    expect(text('mm-facts')).toContain('Route de la journée avec ce rendez-vous : 12 km, 40 min');
  });
  it('no row at all for the block: no number invented, no raw key, nothing said of a time', async () => {
    api.suggestBlocks.mockResolvedValue([]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    const am = text('mm-block-am');
    expect(am).not.toMatch(/Arrêt|booking\.|km|min de route/);
    expect(pin('new-stop')?.number).toBe('');
  });
  it('what the block adds is the row’s real road: « +10 min de route (3 km) »', async () => {
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 0, day_km: 12 })]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    expect(text('mm-block-am')).toContain('+10 min de route (3 km)');
  });
  it('a row with unmeasured > 0: « route pas encore mesurée » on the block, the suggestion and the day chip, never its 40 min', async () => {
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 2, add_min: 40, drive_min: 40, add_km: null, day_km: null, hop_min: 20 })]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    expect(text('mm-block-am')).toContain('Route pas encore mesurée');
    expect(text('mm-block-am')).not.toMatch(/40 min/);
    expect(all('bp-sugg')[0]?.textContent || '').toMatch(/pas encore mesur/);
    expect(all('bp-sugg')[0]?.textContent || '').not.toMatch(/40 min/);
    expect(text(`mm-day-${tomorrow}`)).not.toMatch(/40 min/);
    expect(text(`mm-day-${tomorrow}`)).toContain('route à mesurer');
    expect(text('mm-facts')).toContain('Route de la journée : pas encore mesurée');
  });
  it('the same on a block that is NOT the one chosen (the afternoon while the morning is chosen)', async () => {
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 0 }), row({ block: 'pm', unmeasured: 2, add_min: 40, drive_min: 40, add_km: null })]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    expect(text('mm-block-pm')).toContain('Route pas encore mesurée');
    expect(text('mm-block-pm')).not.toMatch(/40 min/);
  });
  it('« Voir sur la carte » of the moment chosen gets its row: what it adds and the day with it, from the server', async () => {
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 0, day_km: 12 })]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait();
    act(() => { q('bp-see-map')!.click(); });
    await wait(300);
    expect(text('route-preview-extra')).toBe('Ce rendez-vous ajoute 10 min de route (3 km).');
    expect(text('route-preview-day')).toBe('Route de la journée avec ce rendez-vous : 12 km, 40 min');
    expect(text('route-preview')).not.toMatch(/Arrêt \d+ sur \d+/);
  });
  it('the day map asks the roads for the day shown and says « Route en cours de calcul… » while they come', async () => {
    key.tomtom = 'k';
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 0, day_km: 12 })]);
    draw({ first: { day: tomorrow, block: 'am' } });
    await wait(1200);
    const tt = urls.filter((u) => u.includes('api.tomtom.com/routing'));
    expect(tt.length).toBeGreaterThan(0);
    expect(tt.every((u) => u.includes(`departAt=${tomorrow}T11:30:00`))).toBe(true);
    expect(text('mm-road')).toMatch(/en cours de calcul/i);
  });
});

describe('switch ON: the calendar’s « Complet / Presque plein » from the rows (PE-09)', () => {
  it('the page answered, tomorrow morning has no row: « Complet »; the afternoon has one: room, never « presque plein »', async () => {
    api.suggestBlocks.mockResolvedValue([row({ block: 'pm', unmeasured: 0 })]);
    draw();
    await wait();
    expect(q(`bp-cell-${tomorrow}-am`)!.className).toContain('is-full');
    expect(q(`bp-cell-${tomorrow}-pm`)!.className).toContain('is-ok');
  });
  it('a row that fits with 5 min left: no « ça passe si la route est courte » from the fixed 20 minutes', async () => {
    api.suggestBlocks.mockResolvedValue([row({ unmeasured: 0, left: 5, drive_min: 5 })]);
    draw({ duration: 100, first: { day: tomorrow, block: 'am' } });
    await wait();
    expect(q(`bp-cell-${tomorrow}-am`)!.className).not.toContain('is-tight');
    expect(document.body.textContent).not.toContain('ça passe si la route est courte');
  });
  it('no answer (the server is unreachable): « À vérifier », a legend entry, still pickable, and the booking is told it is checked at send', async () => {
    api.suggestBlocks.mockRejectedValue(new Error('server'));
    draw();
    await wait();
    const cell = q(`bp-cell-${tomorrow}-am`)!;
    expect(cell.className).toContain('is-unknown');
    expect(cell.textContent).toContain('À vérifier');
    expect(text('bp-legend-unknown')).toContain('À vérifier');
    await act(async () => { cell.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'am' });
    expect(text('bp-unknown-warn')).toContain('vérifiée à l’envoi');
  });
  it('a vehicle chosen by hand, answered, no row: « À vérifier », never « Complet » (the server placed on the vehicle it prefers)', async () => {
    api.suggestBlocks.mockResolvedValue([]);
    draw({ truckId: 'T1' });
    await wait();
    expect(q(`bp-cell-${tomorrow}-am`)!.className).toContain('is-unknown');
  });
  it('switch OFF: the calendar is the phone’s, as before (no « À vérifier » legend)', async () => {
    roads(false);
    api.suggestBlocks.mockResolvedValue([row({ block: 'pm' })]);
    draw();
    await wait();
    expect(q(`bp-cell-${tomorrow}-am`)!.className).toContain('is-ok');
    expect(q('bp-legend-unknown')).toBeNull();
  });
});
