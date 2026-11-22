/* The map of « Réorganiser la journée » (Part 30, K4; Hassan, 2026-11-22: « i want to be able to have the map open and
   showing me the changements in real time »), on the screen: the pins at once in the draft order (a move on its truck, a
   move onto the other truck), NO line before a road comes, the road asked a moment after the last change and never during
   a drag (nor redrawn then), an order seen again drawn at once without asking; in the sheet: « Carte » on a phone and its
   memory, a computer opens it by default, a pin tapped shows its row, a mouse on a row names its pin.
   Leaflet is not drawn here (MapView pretended: what it is given is what it would draw); the route planner is the real
   roads.ts with OSRM pretended (fetch). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const h = vi.hoisted(() => ({
  views: [] as { markers: import('../map/markers').MapMarker[]; lines: import('../map/markers').MapLine[] }[],
  preview: vi.fn(),
  warm: vi.fn(() => Promise.resolve({ ok: true, ready: true }))
}));
vi.mock('../map/MapView', () => ({ MapView: (p: { markers: never[]; lines: never[] }) => { h.views.push({ markers: p.markers, lines: p.lines }); return null; } }));
vi.mock('../../lib/config', async (orig) => ({ ...(await orig<typeof import('../../lib/config')>()), TOMTOM_KEY: '' }));
vi.mock('./draftMap', async (orig) => ({ ...(await orig<typeof import('./draftMap')>()), ROAD_WAIT_MS: 50 }));
vi.mock('../../data/dayOrder', async (orig) => ({ ...(await orig<typeof import('../../data/dayOrder')>()), dayOrderPreview: h.preview, DAY_ORDER_WAIT_MS: 30 }));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<typeof import('../../data/roads')>()), warmRoads: h.warm }));
vi.mock('./TellHost', () => ({ openTell: vi.fn() }));

import { DayOrderMap } from './DayOrderMap';
import { DayOrderSheet } from './DayOrderSheet';
import { draftOf, moveTo, type Draft } from '../../domain/jobs/dayOrder';
import { dayAnswer } from '../../data/dayOrder';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { setNet } from '../../data/net';
import { wide } from '../../platform/media';
import { forgetRoads } from '../map/roads';
import { drawable } from '../map/markers';
import { PALETTE } from '../map/assemble';
import { AskHost } from '../../ui/ask';
import { lang } from '../../lib/i18n';
import { addDays, today } from '../../lib/dates';
import type { Access, Job } from '../../data/types';

const DAY = addDays(today(), 3);
const owner = { id: 'u-hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const J = (id: string, number: number, first: string, stop: number, o: Partial<Job> = {}) => ({
  id, number, customer_id: `c-${id}`, truck_id: 'A', day: DAY, block: 'day', status: 'booked', stop_order: stop, duration_min: 60, travel_min: 20,
  eta_min: 480 + stop * 60, win_start: 480, win_end: 720, win_flex: false, arrive_at: null, deleted_at: null, lat: 45.5 + number / 100, lng: -73.6 - number / 100,
  told_day: DAY, told_start: 480, told_end: 720, told_at: '2026-11-01T10:00:00.000Z', told_how: 'sms', _first: first, ...o
}) as unknown as Job & { _first: string };
const world = () => [J('a', 11, 'Benoit', 1), J('b', 12, 'Chloe', 2), J('c', 13, 'Denis', 3), J('d', 21, 'Omar', 1, { truck_id: 'B' })];
function seed() {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, roads_on: false, home: { lat: 45.5, lng: -73.6, label: 'Centrale', address: '1 rue' } }, messages: { on: {} } }] as never);
  replaceLocal('trucks', [{ id: 'A', name: 'Camion Complet', active: true, sort: 1, tire_machine: true }, { id: 'B', name: 'Voiture', active: true, sort: 2, tire_machine: true }] as never);
  const dow = new Date(`${DAY}T12:00:00Z`).getUTCDay();
  replaceLocal('truck_week', [{ id: 'wa', truck_id: 'A', dow, ranges: [[480, 1020]] }, { id: 'wb', truck_id: 'B', dow, ranges: [[480, 1020]] }] as never);
  replaceLocal('truck_days', [] as never);
  const jobs = world();
  replaceLocal('customers', jobs.map((j) => ({ id: j.customer_id, first_name: j._first, last_name: 'Roy', phone: '5145550100' })) as never);
  replaceLocal('jobs', jobs as never);
}
const RAW = () => ({ ok: true, day: DAY, basis_ok: true, mode: 'windows', roads: false, rewin: true, auto: false, lists: [], stops: [], trucks: [], accept: {}, due_after: 0 });

/* OSRM pretended: a road through the points asked (a bend in each leg: never two points), each answer held until let go */
const osrm: { url: string; go: () => void }[] = [];
function osrmOf(u: string): Response {
  const pts = u.split('/driving/')[1].split('?')[0].split(';').map((c) => c.split(',').map(Number)).map(([lng, lat]) => [lat, lng]);
  const legs = pts.slice(1).map((p, i) => ({ steps: [{ geometry: { coordinates: [pts[i], [(pts[i][0] + p[0]) / 2 + 0.001, (pts[i][1] + p[1]) / 2], p].map(([lat, lng]) => [lng, lat]) } }] }));
  return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 5000, duration: 600, legs }] }), { status: 200 });
}
const fetchMock = vi.fn((input: RequestInfo | URL) => new Promise<Response>((done) => { const url = String(input); osrm.push({ url, go: () => done(osrmOf(url)) }); }));
const letGo = async () => { await act(async () => { for (const x of osrm.splice(0)) x.go(); await vi.advanceTimersByTimeAsync(400); }); };
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const box = document.createElement('div');
document.body.appendChild(box);
const last = () => h.views[h.views.length - 1];
const pins = () => Object.fromEntries(last().markers.filter((m) => m.kind === 'job').map((m) => [m.id, [m.number, m.color]]));
const drawn = () => drawable(last().markers, last().lines).lines;
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);

beforeEach(() => {
  lang.value = 'fr';
  access.value = owner;
  setNet({ online: true });
  localStorage.clear();
  forgetRoads();
  osrm.length = 0;
  h.views.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  h.preview.mockReset();
  h.preview.mockImplementation(async () => dayAnswer(RAW()));
  wide.value = false;
  seed();
});
afterEach(async () => {
  await act(async () => { render(null, box); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearAll();
  access.value = null;
  wide.value = false;
});

describe('the map follows the draft', () => {
  const props = (d: Draft, o: Partial<Parameters<typeof DayOrderMap>[0]> = {}) => ({ day: DAY, draft: d, cur: null, judge: false, marked: null, spot: null, hold: false, wide: true, onPick: () => {}, onBackground: () => {}, ...o });
  const draw = (d: Draft, o: Partial<Parameters<typeof DayOrderMap>[0]> = {}) => act(async () => { render(<DayOrderMap {...props(d, o)} />, box); });
  const first = () => draftOf(world(), ['A', 'B'], DAY, ['day']);

  it('pins at once in the draft order; NO line before a road comes; the road asked a moment after the last change, never during a drag, nor drawn then; back to an order seen: drawn at once, nothing asked', async () => {
    vi.useFakeTimers();
    const d1 = first();
    await draw(d1);
    expect(pins()).toEqual({ a: [1, PALETTE[0]], b: [2, PALETTE[0]], c: [3, PALETTE[0]], d: [1, PALETTE[1]] });
    expect(drawn()).toEqual([]);                                            // nothing between two stops yet
    await tick(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);                             // at once when the map opens: truck A first
    await letGo();
    await tick(400);
    await letGo();                                                          // then B (a short pause between two trucks)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(drawn().length).toBe(4);                                         // A: 3 legs, B: 1 leg, each by the streets
    expect(drawn().every((l) => l.points.length >= 3)).toBe(true);

    // a drag starts: the map keeps its drawing; a change that comes meanwhile is neither drawn nor asked
    const views = h.views.length;
    const kept = last();
    const d2 = moveTo(d1, 'c', 'A', 'day', 0);
    await draw(d1, { hold: true });
    await draw(d2, { hold: true });
    await tick(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.views.length).toBeGreaterThan(views);                          // drawn again (the drag started), the same drawing
    expect(h.views.slice(views).every((v) => v.markers === kept.markers && v.lines === kept.lines)).toBe(true);

    // the drop: the pins at once (c first, the others numbered again), its new legs not drawn, the road asked a moment later
    await draw(d2, { marked: 'c' });
    expect(pins()).toEqual({ c: [1, PALETTE[0]], a: [2, PALETTE[0]], b: [3, PALETTE[0]], d: [1, PALETTE[1]] });
    expect(last().markers.find((m) => m.id === 'c')).toMatchObject({ active: true, label: 'Denis' });
    expect(drawn().length).toBe(2);                                         // a→b still known, B's leg; Centrale→c and c→a not yet
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(30);
    expect(fetchMock).toHaveBeenCalledTimes(2);                             // not before the pause after the last change
    await tick(40);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain(`${(-73.73).toFixed(6)},${(45.63).toFixed(6)}`);
    await letGo();
    expect(drawn().length).toBe(4);

    // back to the first order: every leg known, drawn in the same drawing, nothing asked
    await draw(d1);
    expect(pins()).toEqual({ a: [1, PALETTE[0]], b: [2, PALETTE[0]], c: [3, PALETTE[0]], d: [1, PALETTE[1]] });
    expect(drawn().length).toBe(4);
    await tick(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('onto the other truck: its colour and number there at once, both trucks numbered again, both roads asked again', async () => {
    vi.useFakeTimers();
    const d1 = first();
    await draw(d1);
    await tick(10); await letGo(); await tick(400); await letGo();
    const d2 = moveTo(d1, 'a', 'B', 'day', 1);
    await draw(d2, { marked: 'a' });
    expect(pins()).toEqual({ b: [1, PALETTE[0]], c: [2, PALETTE[0]], d: [1, PALETTE[1]], a: [2, PALETTE[1]] });
    await tick(60); await letGo(); await tick(400); await letGo();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(drawn().length).toBe(4);                                         // A: Centrale→b→c, B: Centrale→d→a
  });

  it('nothing is asked once the map is gone (the sheet or the map closed)', async () => {
    vi.useFakeTimers();
    const d1 = first();
    await draw(d1);
    await tick(10);
    await draw(moveTo(d1, 'c', 'A', 'day', 0));
    await act(async () => { render(null, box); });
    await letGo();
    await tick(120000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('in the sheet', () => {
  const sheet = () => act(async () => { render(<><DayOrderSheet at={{ day: DAY }} onClose={() => {}} /><AskHost /></>, box); for (let i = 0; i < 10; i++) await Promise.resolve(); });
  const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
  const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
  const reopen = async () => { await act(async () => { render(null, box); }); await sheet(); await settle(); };

  it('a phone: « Carte » opens the map ABOVE the lists (in the window, not in the scrolling lists), « Masquer la carte » closes it; remembered on this phone', async () => {
    await sheet(); await settle();
    expect(q('dayorder-map')).toBeNull();
    expect(q('dayorder-map-toggle')!.textContent).toBe('Carte');
    expect(fetchMock).not.toHaveBeenCalled();                               // no map: no road asked
    await click('dayorder-map-toggle');
    const map = q('dayorder-map')!;
    expect(map).not.toBeNull();
    expect(map.parentElement!.classList.contains('sheet')).toBe(true);
    expect(map.closest('.sheet-body')).toBeNull();
    expect(map.classList.contains('is-phone')).toBe(true);
    expect(localStorage.getItem('his.dayOrder.map.phone')).toBe('1');
    expect(q('dayorder-map-toggle')!.textContent).toBe('Masquer la carte');
    expect(map.contains(q('dayorder-map-toggle'))).toBe(true);
    expect(pins()).toMatchObject({ a: [1, PALETTE[0]], d: [1, PALETTE[1]] });
    await reopen();
    expect(q('dayorder-map')).not.toBeNull();                               // remembered
    await click('dayorder-map-toggle');
    expect(q('dayorder-map')).toBeNull();
    expect(localStorage.getItem('his.dayOrder.map.phone')).toBe('0');
    await reopen();
    expect(q('dayorder-map')).toBeNull();
  });

  it('no storage on this phone: the map still opens and closes', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    try {
      await sheet(); await settle();
      await click('dayorder-map-toggle');
      expect(q('dayorder-map')).not.toBeNull();
      await click('dayorder-map-toggle');
      expect(q('dayorder-map')).toBeNull();
    } finally { vi.restoreAllMocks(); }
  });

  it('a computer: open beside the lists by default (its own memory, not the phone’s); a pin tapped shows its row; a mouse on a row names its pin; a stop moved is marked and numbered at once', async () => {
    localStorage.setItem('his.dayOrder.map.phone', '0');
    wide.value = true;
    await sheet(); await settle();
    const map = q('dayorder-map')!;
    expect(map).not.toBeNull();
    expect(map.classList.contains('is-wide')).toBe(true);
    // a pin tapped: its row stands out (and is shown); tapped again: no more
    await act(async () => { last().markers.find((m) => m.id === 'b')!.onClick!(); });
    await settle();
    expect(q('dayorder-row-12')!.classList.contains('is-spot')).toBe(true);
    expect(last().markers.find((m) => m.id === 'b')).toMatchObject({ active: true, label: 'Chloe' });
    await act(async () => { last().markers.find((m) => m.id === 'b')!.onClick!(); });
    await settle();
    expect(q('dayorder-row-12')!.classList.contains('is-spot')).toBe(false);
    // the mouse on a row: its pin named
    await act(async () => { q('dayorder-row-13')!.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' })); });
    await settle();
    expect(last().markers.find((m) => m.id === 'c')).toMatchObject({ active: true, label: 'Denis' });
    await act(async () => { q('dayorder-row-13')!.dispatchEvent(Object.assign(new Event('pointerleave'), { pointerType: 'mouse' })); });
    await settle();
    expect(last().markers.find((m) => m.id === 'c')!.label).toBeUndefined();
    // a stop moved onto the other truck from the keyboard: its pin at once, in that truck's colour, marked
    const key = async (k: string) => { await act(async () => { q('dayorder-grip-11')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); await settle(); };
    await key(' '); await key('ArrowRight'); await key('Enter');
    expect(pins()).toMatchObject({ b: [1, PALETTE[0]], c: [2, PALETTE[0]], a: [1, PALETTE[1]], d: [2, PALETTE[1]] });
    expect(last().markers.find((m) => m.id === 'a')).toMatchObject({ active: true, label: 'Benoit' });
    // hidden on the computer: remembered for the computer only
    await click('dayorder-map-toggle');
    expect(localStorage.getItem('his.dayOrder.map.wide')).toBe('0');
    expect(localStorage.getItem('his.dayOrder.map.phone')).toBe('0');
  });
});
