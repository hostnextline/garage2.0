/* « Réserver à l'heure choisie » (Part 30, K2): in the booking's time calendar (`exactBook`), a time the server does not
   offer (no room) is pickable by the owner and the office — marked full, on the computer's grid and on the phone's list —
   and stays chosen (never « gone »); « Réserver » then warns who would be late (atTime.ts). A mechanic, and « Déplacer »
   (no `exactBook`), keep the rules of before. The server's answers are pretended (as WindowPicker.test.tsx). */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';

const api = vi.hoisted(() => ({ suggestBlocks: vi.fn(), suggestWindows: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
vi.mock('../../data/api', () => api);
vi.mock('../../data/auth', () => ({ isOwner: () => auth.owner, hasRole: (r: string) => r === 'office' && auth.office }));
vi.mock('./RoutePreview', () => ({ RoutePreview: () => null, RouteHover: () => null, MapHover: () => null }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ask: ui.ask, toast: ui.toast }));
const auth = { owner: false, office: false };

import { upsertLocal, clearAll } from '../../data/store';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import { BlockPicker, type BlockChoice } from './BlockPicker';
import { forgetWindows } from './useDayWindows';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T17:00:00Z'));
afterAll(() => { vi.useRealTimers(); });
const tomorrow = addDays(today(), 1);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const unit = (m: number, day = tomorrow) => q(`pick-unit-${day}-${m}`)!;
const wait = async (ms = 800) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
let picked: (BlockChoice | null)[] = [];
function Host(p: { layout: 'grid' | 'list'; exactBook?: boolean; exactMove?: boolean }) {
  const [v, setV] = useState<BlockChoice | null>(null);
  return <BlockPicker lat={45.5} lng={-73.6} duration={60} value={v} onPick={(c) => { picked.push(c); setV(c); }} onClear={() => { picked.push(null); setV(null); }}
    layout={p.layout} exactBook={p.exactBook} exactMove={p.exactMove} />;
}
const draw = (p: { layout: 'grid' | 'list'; exactBook?: boolean; exactMove?: boolean }) => act(() => render(<Host {...p} />, box));

beforeEach(() => {
  picked = []; auth.owner = false; auth.office = false;
  lang.value = 'fr';
  forgetWindows();
  ui.ask.mockReset().mockResolvedValue(true);
  ui.toast.mockReset();
  upsertLocal('settings', [{ id: '1', booking: { windows_on: true } }], { force: true });
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ id: `w${dow}`, truck_id: 'T1', dow, ranges: [[480, 1200]] })), { force: true });
  api.suggestBlocks.mockReset().mockResolvedValue([]);
  // every day: two windows still possible, 14 h–18 h and 9 h–13 h (11 h is full)
  api.suggestWindows.mockReset().mockImplementation(async (_lat, _lng, _dur, day: string) => [
    { day, block: 'day', drive_min: 12, near: 2, truck: 'T1', left: 300, eta: 900, win_start: 840, win_end: 1080 },
    { day, block: 'day', drive_min: 25, near: 1, truck: 'T1', left: 300, eta: 600, win_start: 540, win_end: 780 }
  ]);
});
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('the computer’s grid, booking (exactBook)', () => {
  it('the owner clicks a full time (11 h): chosen at once, marked full, its window the one of 11 h; no question here (« Réserver » asks the server)', async () => {
    auth.owner = true;
    draw({ layout: 'grid', exactBook: true });
    await wait();
    expect(unit(660).dataset.state).toBe('no');
    expect(unit(660).getAttribute('aria-label')).toContain('complet (tu peux réserver quand même)');
    await act(async () => { unit(660).click(); });
    expect(ui.ask).not.toHaveBeenCalled();
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_start: 600, win_end: 840, eta: 660, truck: null, full: true });
    expect(q('bp-chosen')?.textContent).toContain('Complet à cette heure');
    expect(q('win-gone')).toBeNull();
    await wait(300);
    expect(picked.at(-1)).not.toBeNull();   // never cleared as « gone »
    // a possible time is not full
    await act(async () => { unit(585).click(); });
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day', win_start: 540, win_end: 780, eta: 585, truck: 'T1' });
  });
  it('the office too', async () => {
    auth.office = true;
    draw({ layout: 'grid', exactBook: true });
    await wait();
    await act(async () => { unit(690).click(); });
    expect(picked.at(-1)).toMatchObject({ eta: 690, full: true });
  });
  it('a mechanic: a full time is not taken (said why), as before', async () => {
    draw({ layout: 'grid', exactBook: true });
    await wait();
    await act(async () => { unit(660).click(); });
    expect(picked).toEqual([]);
    expect(ui.toast).toHaveBeenCalled();
  });
  it('« Déplacer » (no exactBook): the owner’s full time still asks « Prendre ce jour quand même » (the day alone), as before', async () => {
    auth.owner = true;
    draw({ layout: 'grid' });
    await wait();
    await act(async () => { unit(660).click(); });
    expect(ui.ask).toHaveBeenCalled();
    expect(picked.at(-1)).toEqual({ day: tomorrow, block: 'day' });
  });
});

describe('the phone’s list, booking (exactBook)', () => {
  it('the owner: the full times are listed too, marked « complet »; a tap chooses one, marked full', async () => {
    auth.owner = true;
    draw({ layout: 'list', exactBook: true });
    await wait();
    await act(async () => { q(`pick-daychip-${tomorrow}`)!.click(); });
    const t660 = q('pick-time-660')!;
    expect(t660).toBeTruthy();
    expect(t660.dataset.state).toBe('no');
    expect(t660.className).toContain('is-no');
    expect(t660.textContent).toContain('complet');
    expect(q('pick-time-600')?.dataset.state).toBe('open');
    await act(async () => { t660.click(); });
    expect(picked.at(-1)).toMatchObject({ day: tomorrow, eta: 660, win_start: 600, full: true });
    expect(q('pick-time-660')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('a mechanic: only the possible times', async () => {
    draw({ layout: 'list', exactBook: true });
    await wait();
    await act(async () => { q(`pick-daychip-${tomorrow}`)!.click(); });
    expect(q('pick-time-600')).toBeTruthy();
    expect(q('pick-time-660')).toBeNull();
  });
  it('« Déplacer » with the owner: only the possible times (the list of before)', async () => {
    auth.owner = true;
    draw({ layout: 'list', exactMove: true });
    await wait();
    await act(async () => { q(`pick-daychip-${tomorrow}`)!.click(); });
    expect(q('pick-time-600')).toBeTruthy();
    expect(q('pick-time-660')).toBeNull();
  });
});
