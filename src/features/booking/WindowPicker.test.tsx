/* « Plages d'arrivée »: the picker as drawn when the garage books by windows (the server's answers are pretended). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const api = vi.hoisted(() => ({ suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
vi.mock('../../data/api', () => api);
vi.mock('../../data/auth', () => ({ isOwner: () => auth.owner, hasRole: () => false }));
vi.mock('./RoutePreview', () => ({ RoutePreview: () => null }));
const auth = { owner: false };

import { upsertLocal, clearAll } from '../../data/store';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import { BlockPicker, type BlockChoice } from './BlockPicker';

const tomorrow = addDays(today(), 1);
const later = addDays(today(), 3);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (prefix: string) => [...box.querySelectorAll(`[data-testid^="${prefix}"]`)] as HTMLElement[];
const wait = async (ms = 450) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
let picked: (BlockChoice | null)[] = [];
function Host(p: { openDay?: string | null; reload?: number }) {
  const [v, setV] = useState<BlockChoice | null>(null);
  return <BlockPicker lat={45.5} lng={-73.6} duration={60} value={v} onPick={(c) => { picked.push(c); setV(c); }} onClear={() => { picked.push(null); setV(null); }} openDay={p.openDay} reload={p.reload} />;
}
const draw = (p: { openDay?: string | null; reload?: number } = {}) => act(() => render(<Host {...p} />, box));

beforeEach(() => {
  picked = []; auth.owner = false;
  lang.value = 'fr';
  upsertLocal('settings', [{ id: '1', booking: { windows_on: true } }], { force: true });
  // one truck, open 8 h to 20 h every day
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  api.suggestBlocks.mockReset().mockResolvedValue([
    { day: tomorrow, block: 'day', drive_min: 12, near: 2, truck: null, left: 300, eta: 900, win_start: 840, win_end: 1080 },
    { day: later, block: 'day', drive_min: 30, near: 0, truck: null, left: 500, eta: 560 }
  ]);
  api.suggestWindows.mockReset().mockResolvedValue([
    { day: tomorrow, block: 'day', drive_min: 12, near: 2, truck: null, left: 300, eta: 900, win_start: 840, win_end: 1080 },
    { day: tomorrow, block: 'day', drive_min: 25, near: 1, truck: null, left: 300, eta: 600, win_start: 540, win_end: 780 }
  ]);
});
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('the picker with « Plages d’arrivée »', () => {
  it('offers days with their best window, in words, never a block', async () => {
    draw();
    await wait();
    expect(q('block-picker')?.dataset.mode).toBe('windows');
    expect(q('win-sugg-0')?.textContent).toContain('Demain, entre 14 h et 18 h');
    expect(q('win-sugg-1')?.textContent).toContain('entre 8 h et 12 h');   // from its estimated arrival (9 h 20)
    expect(box.textContent).not.toMatch(/matin|après-midi|soir|bloc/i);
    expect(all('bp-cell-')).toHaveLength(0);                                // no block calendar
    expect(q(`win-day-${tomorrow}`)).toBeTruthy();
  });
  it('a suggestion chosen: its window; « Autres heures ce jour-là » lists that day’s windows', async () => {
    draw();
    await wait();
    await act(async () => { q('win-sugg-0')!.click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, block: 'day', win_start: 840, win_end: 1080 });
    expect(q('bp-chosen')?.textContent).toContain('Demain, entre 14 h et 18 h');
    expect(q('win-options')).toBeNull();
    await act(async () => { q('win-others')!.click(); });
    await wait();
    expect(api.suggestWindows).toHaveBeenCalledWith(45.5, -73.6, 60, tomorrow, null, false, null);
    expect(all('win-option-').map((x) => x.dataset.testid)).toEqual(['win-option-840', 'win-option-540']);
    await act(async () => { q('win-option-540')!.click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, block: 'day', win_start: 540, win_end: 780 });
  });
  it('« Flexible »: no window; switched off, back to the window chosen before', async () => {
    draw();
    await wait();
    await act(async () => { q('win-sugg-0')!.click(); });
    await act(async () => { q('book-flex')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_flex: true });
    expect(q('bp-chosen')?.textContent).toContain('dans la journée (plage confirmée la veille)');
    expect(q('win-others')).toBeNull();
    await act(async () => { q('book-flex')!.click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, win_start: 840 });
  });
  it('a day chosen by hand: its windows; a day with none says so, and only the owner or the office may take it anyway', async () => {
    api.suggestWindows.mockResolvedValue([]);
    draw({ openDay: tomorrow });
    await wait();
    expect(q('win-day-panel')?.dataset.day).toBe(tomorrow);
    expect(q('win-none')).toBeTruthy();
    expect(q('win-force')).toBeNull();
    expect(picked).toEqual([]);
    auth.owner = true;
    draw({ openDay: tomorrow, reload: 1 });
    await wait();
    await act(async () => { q('win-force')!.click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day' });
    expect(q('bp-chosen')?.textContent).toContain('plage donnée par l’app');
  });
  it('a window refused by the server (reload): the suggestions and the day’s hours are asked again', async () => {
    draw();
    await wait();
    await act(async () => { q('win-sugg-0')!.click(); });
    const before = api.suggestBlocks.mock.calls.length;
    draw({ reload: 1 });
    await wait();
    expect(api.suggestBlocks.mock.calls.length).toBe(before + 1);
    expect(q('win-options')).toBeTruthy();
    expect(api.suggestWindows).toHaveBeenCalled();
  });
  it('blocks (the switch off): the picker of before', async () => {
    upsertLocal('settings', [{ id: '1', booking: { windows_on: false } }], { force: true });
    api.suggestBlocks.mockResolvedValue([{ day: tomorrow, block: 'pm', drive_min: 12, near: 2, truck: null, left: 200 }]);
    draw();
    await wait();
    expect(q('block-picker')?.dataset.mode).toBeUndefined();
    expect(q('bp-sugg')?.textContent).toContain('Demain après-midi, 12 h à 16 h');
    expect(q(`bp-cell-${tomorrow}-am`)).toBeTruthy();
    expect(q('win-day-panel')).toBeNull();
  });
});
