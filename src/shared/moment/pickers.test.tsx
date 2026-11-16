/* The bugs of the moment pickers found by the scan of 2026-11-15, each drawn with the real pickers and a pretended
   server (each test fails with the pickers of before). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import type { MenuAction } from '../../ui/ContextMenu';

const api = vi.hoisted(() => ({ suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
const seen = vi.hoisted(() => ({ preview: [] as { onPick?: () => void }[], menus: [] as MenuAction[][] }));
vi.mock('../../data/api', () => api);
vi.mock('../../data/auth', () => ({ isOwner: () => false, hasRole: () => false }));
vi.mock('./RoutePreview', () => ({ RoutePreview: (p: { onPick?: () => void }) => { seen.preview.push(p); return null; }, RouteHover: () => null, MapHover: () => null, floatStyle: () => ({}) }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ask: ui.ask, toast: ui.toast }));
vi.mock('../../ui/ContextMenu', async (orig) => ({ ...(await orig<typeof import('../../ui/ContextMenu')>()), openMenu: (_e: MouseEvent, a: MenuAction[]) => { seen.menus.push(a); } }));

import { upsertLocal, clearAll } from '../../data/store';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import type { FarInfo } from '../../domain/moment/logic';
import { BlockPicker, type BlockChoice } from './BlockPicker';
import { forgetWindows } from './useDayWindows';

const tomorrow = addDays(today(), 1);
const later = addDays(today(), 3);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (prefix: string) => [...box.querySelectorAll(`[data-testid^="${prefix}"]`)] as HTMLElement[];
const unit = (m: number, day = tomorrow) => q(`pick-unit-${day}-${m}`)!;
const wait = async (ms = 800) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
let picked: (BlockChoice | null)[] = [];
let fars: (FarInfo | null)[] = [];
interface HostProps { layout?: 'grid' | 'list'; lat?: number; duration?: number; truckId?: string; reload?: number; excludeJob?: string; first?: BlockChoice | null }
function Host(p: HostProps) {
  const [v, setV] = useState<BlockChoice | null>(p.first ?? null);
  return <BlockPicker lat={p.lat ?? 45.5} lng={-73.6} duration={p.duration ?? 60} value={v} onPick={(c) => { picked.push(c); setV(c); }} onClear={() => { picked.push(null); setV(null); }}
    onFar={(f) => fars.push(f)} layout={p.layout ?? 'grid'} truckId={p.truckId} reload={p.reload} excludeJob={p.excludeJob} />;
}
const draw = (p: HostProps = {}) => act(() => render(<Host {...p} />, box));
const win = (day: string, start: number, truck: string | null = 'T1') => ({ day, block: 'day', drive_min: 12, near: 2, truck, left: 300, eta: start + 60, win_start: start, win_end: start + 240 });
const windowsOn = (on: boolean) => upsertLocal('settings', [{ id: '1', booking: { windows_on: on } }], { force: true });

beforeEach(() => {
  picked = []; fars = []; seen.preview = []; seen.menus = [];
  lang.value = 'fr';
  forgetWindows();
  ui.ask.mockReset().mockResolvedValue(true);
  ui.toast.mockReset();
  windowsOn(true);
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  api.suggestBlocks.mockReset().mockResolvedValue([win(tomorrow, 840), win(later, 540)]);
  api.suggestWindows.mockReset().mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, day: string) => [win(day, 840), win(day, 540)]);
});
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('« garde-route » with « Plages d’arrivée » (booking-b-01, x-dualmode-01)', () => {
  beforeEach(() => {
    // tomorrow is far from the truck's other stops (52 min between two customers); in 3 days it is not
    api.suggestBlocks.mockResolvedValue([{ ...win(tomorrow, 840), far: 'hop', hop_min: 52, add_min: 40 }, { ...win(later, 540), far: null, add_min: 12 }]);
  });
  it('a far day is never offered among the best moments, and is marked in the calendar', async () => {
    draw();
    await wait();
    expect(all('win-sugg-').map((x) => x.dataset.day)).toEqual([later]);
    expect(q(`pick-day-${tomorrow}`)?.className).toContain('is-far');
    expect(q(`pick-day-${tomorrow}`)?.getAttribute('aria-label')).toContain('loin des autres arrêts');
    expect(q(`pick-day-${later}`)?.className).not.toContain('is-far');
    expect(q('pick-legend-far')).toBeTruthy();
  });
  // review mp-1: the class alone drew nothing (the state of an open day is an empty space): the legend's road mark is drawn
  it('the far day of the time grid shows the road mark of the legend in its header', async () => {
    draw();
    await wait();
    const mark = q(`pick-day-far-${tomorrow}`);
    expect(mark?.tagName.toLowerCase()).toBe('svg');
    expect(q(`pick-day-${tomorrow}`)!.querySelector('.pk-dayhd-state')!.contains(mark)).toBe(true);
    expect(q(`pick-day-far-${later}`)).toBeNull();
  });
  // review mp-2: while the answer for a new address is awaited, the old address's scores neither warn nor tell the screen
  it('a new address: the warning waits for its own answer (never the old address’s)', async () => {
    draw();
    await wait();
    await act(async () => { unit(900).click(); });
    expect(fars.at(-1)).toMatchObject({ day: tomorrow, kind: 'hop' });
    let land: (rows: unknown[]) => void = () => {};
    api.suggestBlocks.mockImplementation(() => new Promise((ok) => { land = ok; }));
    draw({ lat: 45.6 });
    await wait();
    expect(fars.at(-1)).toBeNull();
    expect(q('bp-far-warn')).toBeNull();
    // the new address is near that day's other stops
    await act(async () => { land([{ ...win(tomorrow, 840), far: null, add_min: 8 }]); });
    expect(fars.at(-1)).toBeNull();
    expect(q('bp-far-warn')).toBeNull();
    await act(async () => { land([]); });
  });
  it('the same address asked again for another length of work: the warning comes back with its answer', async () => {
    draw();
    await wait();
    await act(async () => { unit(900).click(); });
    let land: (rows: unknown[]) => void = () => {};
    api.suggestBlocks.mockImplementation(() => new Promise((ok) => { land = ok; }));
    draw({ duration: 90 });
    await wait();
    expect(fars.at(-1)).toBeNull();
    await act(async () => { land([{ ...win(tomorrow, 840), far: 'hop', hop_min: 55, add_min: 40 }]); });
    expect(fars.at(-1)).toMatchObject({ day: tomorrow, kind: 'hop' });
    expect(q('bp-far-warn')?.textContent).toContain('55 min');
  });
  it('a time chosen on a far day: warned with « Plutôt … », and the screen is told (it asks before booking)', async () => {
    draw();
    await wait();
    await act(async () => { unit(900).click(); });
    expect(fars.at(-1)).toMatchObject({ day: tomorrow, block: 'day', kind: 'hop' });
    expect(q('bp-far-warn')?.textContent).toContain('52 min');
    const better = q('bp-far-better')!;
    expect(better.textContent).toContain('Plutôt');
    expect(better.textContent).toContain('28 min de route en moins');
    await act(async () => { better.click(); });
    expect(picked.at(-1)).toMatchObject({ day: later, block: 'day', win_start: 540 });
    expect(fars.at(-1)).toBeNull();
    expect(q('bp-far-warn')).toBeNull();
  });
  it('« Flexible » on a far day is warned too', async () => {
    draw();
    await wait();
    await act(async () => { unit(900).click(); });
    await act(async () => { q('book-flex')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_flex: true });
    expect(fars.at(-1)).toMatchObject({ day: tomorrow, block: 'day' });
  });
});

describe('a vehicle chosen by hand (x-dualmode-07, booking-b-02)', () => {
  it('its own kind is asked, so the windows it can take are open (before: the car’s rows, all dropped)', async () => {
    upsertLocal('trucks', [{ id: 'CAR', name: 'Voiture', active: true, sort: 0, tire_machine: false }, { id: 'T1', name: 'Camion', active: true, sort: 1, tire_machine: true }], { force: true });
    upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].flatMap((dow) => ['CAR', 'T1'].map((id) => ({ id: `${id}${dow}`, truck_id: id, dow, ranges: [[480, 1200]] }))), { force: true });
    // the planner sends the car first unless the truck is asked
    api.suggestWindows.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, day: string, _x: unknown, _n: unknown, kind: string | null) => [win(day, 840, kind === 'truck' ? 'T1' : 'CAR')]);
    api.suggestBlocks.mockImplementation(async (...a: unknown[]) => [win(tomorrow, 840, a[7] === 'truck' ? 'T1' : 'CAR')]);
    draw({ truckId: 'T1' });
    await wait();
    expect(api.suggestWindows).toHaveBeenCalledWith(45.5, -73.6, 60, tomorrow, null, false, 'truck');
    expect(api.suggestBlocks.mock.calls[0][7]).toBe('truck');
    expect(unit(900).dataset.state).toBe('open');
    expect(all('win-sugg-')).toHaveLength(1);
  });
});

describe('the phone’s list while the days answer in any order (booking-b-04)', () => {
  it('the times of a later day never take the place of an earlier day still waiting', async () => {
    const wait4: Record<string, (rows: unknown[]) => void> = {};
    api.suggestWindows.mockImplementation((_a: unknown, _b: unknown, _c: unknown, day: string) => new Promise((ok) => { wait4[day] = ok; }));
    draw({ layout: 'list' });
    await wait();
    await act(async () => { wait4[later]([win(later, 540)]); });
    expect(all('pick-time-')).toHaveLength(0);
    expect(q(`pick-daychip-${later}`)?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { for (const d of Object.keys(wait4)) if (d !== later && d !== tomorrow) wait4[d]([]); });
    await act(async () => { wait4[tomorrow]([win(tomorrow, 840)]); });
    expect(q(`pick-daychip-${tomorrow}`)?.getAttribute('aria-pressed')).toBe('true');
    expect(all('pick-time-').map((x) => x.dataset.testid)).toEqual(['pick-time-870', 'pick-time-885', 'pick-time-900', 'pick-time-915']);
  });
});

describe('« Voir sur la carte » of a time the server refuses (booking-b-08)', () => {
  it('the map opens, but « Choisir ce moment » is not in it', async () => {
    draw();
    await wait();
    const col = box.querySelector(`.pk-col[data-day="${tomorrow}"]`)!;
    await act(async () => { col.querySelector('.pk-u')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientY: 0 })); });
    const actions = seen.menus.at(-1)!;
    expect(actions.map((a) => a.testid)).toEqual(['menu-see-map']);
    await act(async () => { actions[0].run(); });
    expect(seen.preview.at(-1)?.onPick).toBeUndefined();
    // a possible time keeps both
    await act(async () => { unit(900).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
    expect(seen.menus.at(-1)!.map((a) => a.testid)).toContain('menu-see-map');
  });
});

describe('answers being replaced (booking-b-26, booking-b-33)', () => {
  it('a best moment of the address before does not take a tap while the new address is being looked at', async () => {
    draw();
    await wait();
    draw({ lat: 45.6 });
    await act(async () => { q('win-sugg-0')!.click(); });
    expect(picked).toEqual([]);
    await wait();
    await act(async () => { q('win-sugg-0')!.click(); });
    expect(picked).toHaveLength(1);
  });
  it('back to a length of work already asked: its own answer is drawn, even with as many rows as the other', async () => {
    api.suggestWindows.mockImplementation(async (_a: unknown, _b: unknown, dur: number, day: string) => [win(day, dur === 60 ? 840 : 540)]);
    draw();
    await wait();
    expect(unit(900).dataset.state).toBe('open');
    api.suggestBlocks.mockImplementation(() => new Promise(() => {}));   // the best moments do not come back to redraw it
    draw({ duration: 120 });
    await wait();
    expect(unit(600).dataset.state).toBe('open');
    expect(unit(900).dataset.state).toBe('no');
    draw({ duration: 60 });
    await wait(100);
    expect(unit(900).dataset.state).toBe('open');
    expect(unit(600).dataset.state).toBe('no');
  });
});

describe('the time grid on a touch screen (booking-b-09)', () => {
  it('a tap does not open the words and the map of the unit (only a mouse that hovers does)', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      draw();
      await wait();
      await act(async () => { unit(900).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
      expect(q('pick-label')).toBeNull();
    } finally { window.matchMedia = mm; }
  });
});

describe('blocks (the switch off)', () => {
  beforeEach(() => { windowsOn(false); });
  it('a block refused by the server asks the suggestions again (booking-b-29)', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: tomorrow, block: 'pm', drive_min: 12, near: 2, truck: null, left: 200 }]);
    draw();
    await wait();
    const n = api.suggestBlocks.mock.calls.length;
    draw({ reload: 1 });
    await wait();
    expect(api.suggestBlocks.mock.calls.length).toBe(n + 1);
  });
  it('a later page of the calendar gets its own garde-route scores (booking-b-03)', async () => {
    const d20 = addDays(today(), 20);
    api.suggestBlocks.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, from: string) => (from === today() ? [] : [{ day: d20, block: 'pm', drive_min: 50, near: 0, truck: null, left: 200, far: 'hop', hop_min: 60 }]));
    draw();
    await wait();
    await act(async () => { q('bp-later')!.click(); });
    await wait();
    expect(api.suggestBlocks).toHaveBeenCalledWith(45.5, -73.6, 60, addDays(today(), 14), 14, null, false, null);
    expect(q(`bp-cell-${d20}-pm`)?.className).toContain('is-far');
    await act(async () => { q(`bp-cell-${d20}-pm`)!.click(); });
    expect(fars.at(-1)).toMatchObject({ day: d20, block: 'pm', kind: 'hop' });
    // back to the first page: the moment chosen is still known to be far
    await act(async () => { q('bp-earlier')!.click(); });
    await wait();
    expect(q('bp-far-warn')).toBeTruthy();
  });
  // review mp-7: the map's day strip got only the first two weeks' scores, so the same day was far in the calendar only
  it('a later page: the map’s day strip marks the far day too', async () => {
    const d20 = addDays(today(), 20);
    api.suggestBlocks.mockImplementation(async (_a: unknown, _b: unknown, _c: unknown, from: string) => (from === today() ? [] : [{ day: d20, block: 'pm', drive_min: 50, near: 0, truck: null, left: 200, far: 'hop', hop_min: 60 }]));
    draw();
    await wait();
    await act(async () => { q('bp-later')!.click(); });
    await wait();
    expect(q(`bp-cell-${d20}-pm`)?.className).toContain('is-far');
    expect(q(`mm-day-${d20}`)?.className).toContain('is-far');
  });
  it('a block chosen, then another address: no warning from the old address’s scores (booking-b-26)', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: tomorrow, block: 'pm', drive_min: 50, near: 0, truck: null, left: 200, far: 'hop', hop_min: 60 }]);
    draw();
    await wait();
    await act(async () => { q(`bp-cell-${tomorrow}-pm`)!.click(); });
    expect(fars.at(-1)).toMatchObject({ day: tomorrow, block: 'pm' });
    api.suggestBlocks.mockImplementation(() => new Promise(() => {}));
    draw({ lat: 45.6 });
    await wait();
    expect(fars.at(-1)).toBeNull();
    expect(q('bp-far-warn')).toBeNull();
  });
  it('a suggestion being replaced does not take a tap (booking-b-26)', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: tomorrow, block: 'pm', drive_min: 12, near: 2, truck: null, left: 200 }]);
    draw();
    await wait();
    draw({ lat: 45.6 });
    await act(async () => { q('bp-sugg')!.click(); });
    expect(picked).toEqual([]);
  });
  it('moving: « Plutôt … » never proposes the block the appointment is in now (booking-b-27)', async () => {
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira' }], { force: true });
    upsertLocal('jobs', [{ id: 'J1', customer_id: 'C1', day: tomorrow, block: 'am', status: 'booked', truck_id: 'T1', duration_min: 60, number: 1 }], { force: true });
    api.suggestBlocks.mockResolvedValue([
      { day: tomorrow, block: 'am', drive_min: 5, near: 2, truck: 'T1', left: 200, add_min: 5 },
      { day: tomorrow, block: 'pm', drive_min: 9, near: 1, truck: 'T1', left: 200, add_min: 9 },
      { day: later, block: 'eve', drive_min: 50, near: 0, truck: 'T1', left: 200, far: 'hop', hop_min: 60, add_min: 60 }
    ]);
    draw({ excludeJob: 'J1', first: { day: later, block: 'eve' } });
    await wait();
    const better = all('bp-far-better').map((x) => x.textContent);
    expect(better).toHaveLength(1);
    expect(better[0]).toContain('après-midi');
  });
});
