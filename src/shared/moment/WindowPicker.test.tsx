/* « Plages d'arrivée »: the picker as drawn when the garage books by windows — the time calendar on a computer (a grid
   of 15-minute units) and on a phone (a list of arrival times). The server's answers are pretended. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const api = vi.hoisted(() => ({ suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
vi.mock('../../data/api', () => api);
vi.mock('../../data/auth', () => ({ isOwner: () => auth.owner, hasRole: () => false }));
vi.mock('./RoutePreview', () => ({ RoutePreview: () => null, floatStyle: () => ({}) }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ask: ui.ask, toast: ui.toast }));
const auth = { owner: false };

import { upsertLocal, clearAll } from '../../data/store';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import { BlockPicker, type BlockChoice } from './BlockPicker';
import { forgetWindows } from './useDayWindows';

const tomorrow = addDays(today(), 1);
const later = addDays(today(), 3);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (prefix: string) => [...box.querySelectorAll(`[data-testid^="${prefix}"]`)] as HTMLElement[];
const unit = (m: number, day = tomorrow) => q(`pick-unit-${day}-${m}`)!;
const wait = async (ms = 450) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
let picked: (BlockChoice | null)[] = [];
interface HostProps { openDay?: string | null; reload?: number; layout?: 'grid' | 'list'; first?: BlockChoice | null; excludeJob?: string; lat?: number | null }
function Host(p: HostProps) {
  const [v, setV] = useState<BlockChoice | null>(p.first ?? null);
  return <BlockPicker lat={p.lat === undefined ? 45.5 : p.lat} lng={p.lat === undefined ? -73.6 : null} duration={60} value={v} onPick={(c) => { picked.push(c); setV(c); }} onClear={() => { picked.push(null); setV(null); }}
    openDay={p.openDay} reload={p.reload} layout={p.layout ?? 'grid'} excludeJob={p.excludeJob} />;
}
const draw = (p: HostProps = {}) => act(() => render(<Host {...p} />, box));

beforeEach(() => {
  picked = []; auth.owner = false;
  lang.value = 'fr';
  forgetWindows();
  ui.ask.mockReset().mockResolvedValue(true);
  ui.toast.mockReset();
  // windows on the hour (the default rounding): an arrival at 15 h is told 14 h to 18 h
  upsertLocal('settings', [{ id: '1', booking: { windows_on: true } }], { force: true });
  // one truck, open 8 h to 20 h every day
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  api.suggestBlocks.mockReset().mockResolvedValue([
    { day: tomorrow, block: 'day', drive_min: 12, near: 2, truck: null, left: 300, eta: 900, win_start: 840, win_end: 1080 },
    { day: later, block: 'day', drive_min: 30, near: 0, truck: null, left: 500, eta: 560 }
  ]);
  // every day: two windows still possible, 14 h–18 h and 9 h–13 h
  api.suggestWindows.mockReset().mockImplementation(async (_lat, _lng, _dur, day: string) => [
    { day, block: 'day', drive_min: 12, near: 2, truck: 'T1', left: 300, eta: 900, win_start: 840, win_end: 1080 },
    { day, block: 'day', drive_min: 25, near: 1, truck: 'T1', left: 300, eta: 600, win_start: 540, win_end: 780 }
  ]);
});
afterEach(() => { act(() => render(null, box)); clearAll(); document.querySelectorAll('.bp-hover-map').forEach((x) => x.remove()); });

describe('the picker with « Plages d’arrivée »: the best moments', () => {
  it('offers days with their best window, in words, never a block', async () => {
    draw();
    await wait();
    expect(q('block-picker')?.dataset.mode).toBe('windows');
    expect(q('win-sugg-0')?.textContent).toContain('Demain, entre 14 h et 18 h');
    expect(q('win-sugg-1')?.textContent).toContain('entre 8 h et 12 h');   // from its estimated arrival (9 h 20)
    expect(box.textContent).not.toMatch(/matin|après-midi|soir|bloc/i);
    expect(all('bp-cell-')).toHaveLength(0);                                // no block calendar
  });
  it('a suggestion chosen: its window, marked in the calendar with its band', async () => {
    draw();
    await wait();
    await act(async () => { q('win-sugg-0')!.click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, block: 'day', win_start: 840, win_end: 1080, eta: 900 });
    expect(q('bp-chosen')?.textContent).toContain('Demain, entre 14 h et 18 h');
    expect(unit(900).className).toContain('is-on');
    expect(q(`pick-band-${tomorrow}`)?.dataset.kind).toBe('chosen');
    expect(q('win-day-panel')?.dataset.day).toBe(tomorrow);
  });
  it('« Flexible »: no window; switched off, back to the window chosen before', async () => {
    draw();
    await wait();
    await act(async () => { q('win-sugg-0')!.click(); });
    await act(async () => { q('book-flex')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_flex: true });
    expect(q('bp-chosen')?.textContent).toContain('dans la journée (plage confirmée la veille)');
    expect(q(`pick-band-${tomorrow}`)).toBeNull();
    await act(async () => { q('book-flex')!.click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, win_start: 840 });
  });
});

describe('the time calendar on a computer', () => {
  it('a week of days, 15 minutes per unit; each day shown is asked to the server', async () => {
    draw();
    await wait(800);
    expect(q('pick-grid')?.dataset.cols).toBe('7');
    expect(all(`pick-unit-${tomorrow}-`)).toHaveLength(48);                 // 8 h to 20 h
    expect(api.suggestWindows).toHaveBeenCalledTimes(7);
    expect(api.suggestWindows).toHaveBeenCalledWith(45.5, -73.6, 60, tomorrow, null, false, null);
    // possible: the units whose window the server lists (14 h–18 h: 14 h 30 to 15 h 15; 9 h–13 h: 9 h 30 to 10 h 15)
    const open = all(`pick-unit-${tomorrow}-`).filter((x) => x.dataset.state === 'open').map((x) => Number(x.dataset.m));
    expect(open).toEqual([570, 585, 600, 615, 870, 885, 900, 915]);
    expect(unit(660).dataset.state).toBe('no');
    // the best moment of the day has its star
    expect(unit(900).className).toContain('is-best');
  });
  it('a click on a possible unit chooses that arrival time; its window is the one told to the customer', async () => {
    draw();
    await wait(800);
    await act(async () => { unit(585).click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_start: 540, win_end: 780, eta: 585, truck: 'T1' });
    expect(q('bp-chosen')?.textContent).toContain('Demain, entre 9 h et 13 h');
    expect(q('bp-chosen')?.textContent).toContain('Vers 9 h 45');
    expect(unit(585).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { unit(870, later).click(); });
    expect(picked.at(-1)).toMatchObject({ day: later, win_start: 840, eta: 870 });
    expect(q(`pick-band-${tomorrow}`)).toBeNull();
    expect(q(`pick-band-${later}`)).toBeTruthy();
  });
  it('the mouse on a possible unit: what is told to the customer, and the window down the column', async () => {
    draw();
    await wait(800);
    await act(async () => { unit(585).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(q('pick-label')?.textContent).toBe('Arrivée vers 9 h 45 · dit au client : 9 h à 13 h');
    expect(q(`pick-band-${tomorrow}`)?.dataset.kind).toBe('hover');
    // a refused unit says nothing
    await act(async () => { unit(660).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(q('pick-label')).toBeNull();
    expect(q(`pick-band-${tomorrow}`)).toBeNull();
  });
  it('a unit the server refuses: nothing for a mechanic; the owner may take the day anyway (the app gives the window)', async () => {
    draw();
    await wait(800);
    await act(async () => { unit(660).click(); });
    expect(picked).toEqual([]);
    expect(ui.toast).toHaveBeenCalled();
    auth.owner = true;
    draw({ reload: 1 });
    await wait(800);
    await act(async () => { unit(660).click(); });
    expect(ui.ask).toHaveBeenCalled();
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day' });
    expect(q('bp-chosen')?.textContent).toContain('plage donnée par l’app');
  });
  it('the keyboard: one tab stop, the arrows move between the units, Enter chooses', async () => {
    draw();
    await wait(800);
    const stops = all('pick-unit-').filter((x) => x.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    const key = (k: string) => act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    await act(async () => { unit(585).focus(); });
    await key('ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.testid).toBe(`pick-unit-${tomorrow}-600`);
    await key('ArrowRight');
    expect((document.activeElement as HTMLElement).dataset.testid).toBe(`pick-unit-${addDays(tomorrow, 1)}-600`);
    await key('ArrowLeft');
    await act(async () => { (document.activeElement as HTMLElement).click(); });   // Enter on a button
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, win_start: 540, eta: 600 });
  });
  it('« › » shows the next days (asked in turn), « ‹ » never goes before today', async () => {
    draw();
    await wait(800);
    expect((q('pick-prev') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { q('pick-next')!.click(); });
    await wait(800);
    expect(q(`pick-unit-${addDays(today(), 7)}-600`)).toBeTruthy();
    expect(q(`pick-unit-${tomorrow}-600`)).toBeNull();
    expect(api.suggestWindows).toHaveBeenCalledTimes(14);
    await act(async () => { q('pick-prev')!.click(); });
    await wait(100);
    // the first week again, from what was kept (not asked twice)
    expect(unit(600).dataset.state).toBe('open');
    expect(api.suggestWindows).toHaveBeenCalledTimes(14);
  });
  it('a day with no window: said under the calendar; only the owner or the office may take it anyway', async () => {
    api.suggestWindows.mockResolvedValue([]);
    draw({ openDay: tomorrow });
    await wait(800);
    expect(q('win-day-panel')?.dataset.day).toBe(tomorrow);
    expect(q(`pick-day-${tomorrow}`)?.className).toContain('is-full');
    expect(q('win-none')).toBeTruthy();
    expect(q('win-force')).toBeNull();
    expect(picked).toEqual([]);
    auth.owner = true;
    draw({ openDay: tomorrow, reload: 1 });
    await wait(800);
    await act(async () => { q('win-force')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day' });
    expect(q('bp-chosen')?.textContent).toContain('plage donnée par l’app');
  });
  it('a day that does not answer: said, and the day alone may be taken (the app gives the window)', async () => {
    api.suggestWindows.mockRejectedValue(new Error('boom'));
    draw({ openDay: tomorrow });
    await wait(800);
    expect(q(`pick-day-${tomorrow}`)?.className).toContain('is-failed');
    expect(unit(600).dataset.state).toBe('wait');
    expect(q('pick-retry')).toBeTruthy();
    await act(async () => { q('win-force')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day' });
  });
  it('a window refused by the server (reload): the suggestions and the days are asked again', async () => {
    draw();
    await wait(800);
    const before = [api.suggestBlocks.mock.calls.length, api.suggestWindows.mock.calls.length];
    draw({ reload: 1 });
    await wait(800);
    expect(api.suggestBlocks.mock.calls.length).toBe(before[0] + 1);
    expect(api.suggestWindows.mock.calls.length).toBe(before[1] + 7);
  });
  it('a window chosen elsewhere (the agenda, a paste) that the server no longer lists: taken off, and said', async () => {
    draw({ first: { day: tomorrow, block: 'day', win_start: 660, win_end: 900 } });
    await wait(800);
    expect(picked).toEqual([null]);
    expect(q('win-gone')).toBeTruthy();
    expect(q('bp-chosen')?.textContent).toContain('Aucun moment choisi');
    // one the server lists stays, shown an hour into its window
    act(() => render(null, box));
    picked = [];
    draw({ first: { day: tomorrow, block: 'day', win_start: 840, win_end: 1080 } });
    await wait(800);
    expect(picked).toEqual([]);
    expect(q('win-gone')).toBeNull();
    expect(unit(900).className).toContain('is-on');
  });
  it('the appointments already booked that day are drawn; the one being moved is left out and marked « actuel »', async () => {
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', last_name: 'Haddad' }], { force: true });
    const job = { customer_id: 'C1', day: tomorrow, block: 'day', status: 'booked', truck_id: 'T1', duration_min: 60, number: 1 };
    upsertLocal('jobs', [{ ...job, id: 'J1', eta_min: 600, win_start: 540, win_end: 780 }, { ...job, id: 'J2', eta_min: 780, win_start: 720, win_end: 960, number: 2 }], { force: true });
    draw({ excludeJob: 'J1' });
    await wait(800);
    expect(q('pick-job-J2')?.textContent).toBe('Amira');
    expect(q('pick-job-J1')).toBeNull();
    expect(q('pick-current')?.textContent).toBe('actuel');
    expect(api.suggestWindows).toHaveBeenCalledWith(45.5, -73.6, 60, tomorrow, 'J1', false, null);
  });
  it('no position yet: the calendar is there all the same, and the note says the route is not counted', async () => {
    draw({ lat: null });
    await wait(800);
    expect(box.textContent).toContain('la route n’est pas comptée');
    expect(api.suggestWindows).toHaveBeenCalledWith(null, null, 60, tomorrow, null, false, null);
    await act(async () => { unit(585).click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, win_start: 540 });
  });
});

describe('the time calendar on a phone', () => {
  it('a row of days with how many times are possible, then the times of the day chosen', async () => {
    api.suggestWindows.mockImplementation(async (_a, _b, _c, day: string) => (day === later ? [] : [{ day, block: 'day', drive_min: 12, near: 2, truck: 'T1', left: 300, eta: 900, win_start: 840, win_end: 1080 }]));
    draw({ layout: 'list', openDay: tomorrow });
    await wait(800);
    expect(q('pick-grid')).toBeNull();
    expect(all('pick-daychip-')).toHaveLength(7);
    expect(q(`pick-daychip-${tomorrow}`)?.textContent).toContain('1 plage');
    expect(q(`pick-daychip-${later}`)?.textContent).toContain('Complet');
    expect(all('pick-time-').map((x) => x.dataset.testid)).toEqual(['pick-time-870', 'pick-time-885', 'pick-time-900', 'pick-time-915']);
    await act(async () => { q('pick-time-885')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_start: 840, win_end: 1080, eta: 885, truck: 'T1' });
    expect(q('pick-says')?.textContent).toBe('Arrivée vers 14 h 45 · dit au client : 14 h à 18 h');
    expect(q('book-flex')).toBeTruthy();
    // another day: its own times; a day with none says so
    await act(async () => { q(`pick-daychip-${later}`)!.click(); });
    expect(all('pick-time-')).toHaveLength(0);
    expect(q('win-none')).toBeTruthy();
  });
  it('nothing said by the address: the first day that has a time is opened', async () => {
    draw({ layout: 'list' });
    await wait(800);
    const sel = all('pick-daychip-').find((x) => x.getAttribute('aria-pressed') === 'true');
    expect(sel).toBeTruthy();
    expect(all('pick-time-').length).toBeGreaterThan(0);
  });
});

describe('blocks (the switch off)', () => {
  it('the picker of before', async () => {
    upsertLocal('settings', [{ id: '1', booking: { windows_on: false } }], { force: true });
    api.suggestBlocks.mockResolvedValue([{ day: tomorrow, block: 'pm', drive_min: 12, near: 2, truck: null, left: 200 }]);
    draw();
    await wait();
    expect(q('block-picker')?.dataset.mode).toBeUndefined();
    expect(q('bp-sugg')?.textContent).toContain('Demain après-midi, 12 h à 16 h');
    expect(q(`bp-cell-${tomorrow}-am`)).toBeTruthy();
    expect(q('win-day-panel')).toBeNull();
    expect(q('pick-grid')).toBeNull();
  });
});
