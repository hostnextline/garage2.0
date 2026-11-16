/* Horaires, « La voiture ferme »: a move refused by the server stops everything before the hours are touched, and the
   sheet stays open (map-hours-01, -07); a move only kept on the phone never counts; all moves confirmed: then the hours.
   « Le … seulement » starts from that date's real hours (map-hours-04). (The server is pretended.) */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const h = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown[] }[], move: (() => Promise.resolve({ queued: false })) as (job: string) => Promise<{ queued: boolean }> }));
vi.mock('../../data/api', async (orig) => ({
  ...(await orig<typeof import('../../data/api')>()),
  applyHours: async (...args: unknown[]) => { h.calls.push({ name: 'applyHours', args }); return { queued: false, data: { ok: true, changed: 1 } }; },
  moveJob: async (...args: unknown[]) => { h.calls.push({ name: 'moveJob', args }); return h.move(String(args[0])); }
}));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), pull: async () => undefined, flush: async () => undefined }));
vi.mock('../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../shared/places/TruckStartPanel', () => ({ TruckStartPanel: () => null, startWords: () => '' }));
vi.mock('../../platform/media', async (orig) => {
  const { signal } = await import('@preact/signals');
  return { ...(await orig<typeof import('../../platform/media')>()), wide: signal(true) };
});
import HoursScreen from './HoursScreen';
import { replaceLocal } from '../../data/store';
import { access } from '../../data/auth';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';
import { addDays, dow, today } from '../../lib/dates';
import type { Access } from '../../data/types';

const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
// a weekday at least two days ahead (never today: the block must not have started)
const DAY = (() => { let d = addDays(today(), 2); while ([0, 6].includes(dow(d))) d = addDays(d, 1); return d; })();
function seed() {
  replaceLocal('settings', [{ id: '1', booking: { blocks: BLOCKS, horizon_days: 120, unknown_min: 20, min_block_min: 45, home: null } } as never]);
  replaceLocal('trucks', [
    { id: 'car', name: 'Voiture', active: true, sort: 1, color: '#2F6FD0', driver_id: null, plate: null, tire_machine: false },
    { id: 'truck', name: 'Camion', active: true, sort: 2, color: '#D3000E', driver_id: null, plate: null, tire_machine: true }
  ] as never);
  replaceLocal('truck_week', [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
    { id: `c${d}`, truck_id: 'car', dow: d, ranges: [[480, 720]] }, { id: `t${d}`, truck_id: 'truck', dow: d, ranges: [[480, 1200]] }
  ]) as never);
  replaceLocal('truck_days', []);
  replaceLocal('jobs', [{ id: 'j1', number: 7, customer_id: null, truck_id: 'car', day: DAY, block: 'am', status: 'booked', stop_order: 1, duration_min: 45, eta_min: 540 }] as never);
  access.value = { id: 'u1', full_name: 'Owner', short_name: 'Owner', email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null, rights: {}, trucks: [] } as unknown as Access;
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); for (let i = 0; i < 4; i++) await wait(); };
const down = (el: Element) => { const e = new Event('pointerdown', { bubbles: true, cancelable: true }); Object.assign(e, { pointerType: 'mouse', button: 0, pointerId: 1 }); el.dispatchEvent(e); };
const params = { truck: 'car' } as Record<string, string>;
async function show() { await act(async () => { render(<HoursScreen params={params} query={new URLSearchParams()}/>, box); }); await wait(); }
/** « Le … seulement » on DAY, then the morning of that day put out pane by pane */
async function closeTheMorning() {
  await click(q('hours-mode')!.querySelectorAll('button')[0]);
  const input = q('hours-apply')!.querySelector('input[type=date]') as HTMLInputElement;
  await act(async () => { input.value = DAY; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait();
  for (let u = 480; u < 720; u += 30) { await act(async () => { down(box.querySelector(`[data-testid="hours-grid"] [data-d="${dow(DAY)}"][data-u="${u}"]`)!); }); }
  await click(q('hours-apply-btn'));
}

describe('Horaires: « La voiture ferme »', () => {
  beforeEach(() => { lang.value = 'fr'; h.calls.length = 0; toasts.value = []; h.move = () => Promise.resolve({ queued: false }); seed(); });
  afterEach(() => { render(null, box); });

  it('« Le … seulement » with nothing drawn: nothing to apply (the window shows that date’s hours)', async () => {
    replaceLocal('truck_days', [{ id: 'x', truck_id: 'car', day: DAY, ranges: [[480, 600]] }] as never);
    await show();
    await click(q('hours-mode')!.querySelectorAll('button')[0]);
    const input = q('hours-apply')!.querySelector('input[type=date]') as HTMLInputElement;
    await act(async () => { input.value = DAY; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait();
    expect((q('hours-apply-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(box.querySelector(`[data-d="${dow(DAY)}"][data-u="630"]`)!.classList.contains('is-on')).toBe(false);   // closed at 10 h that day
  });
  it('the server refuses the move: the sheet stays open, the hours are not touched, no « déplacé »', async () => {
    h.move = () => Promise.reject(Object.assign(new Error('Tu ne peux pas déplacer ce rendez-vous.'), { code: 'not_allowed' }));
    await show();
    await closeTheMorning();
    expect(q('close-day-sheet')).toBeTruthy();
    await click(q('close-day-move'));
    expect(h.calls.map((c) => c.name)).toEqual(['moveJob']);
    expect(q('close-day-sheet')).toBeTruthy();
    expect(toasts.value.some((x) => x.kind === 'ok')).toBe(false);
    expect(toasts.value.some((x) => x.kind === 'bad')).toBe(true);
  });
  it('a move only kept on the phone: never counted as moved, the hours wait', async () => {
    h.move = () => Promise.resolve({ queued: true });
    await show();
    await closeTheMorning();
    await click(q('close-day-move'));
    expect(h.calls.map((c) => c.name)).toEqual(['moveJob']);
    expect(q('close-day-sheet')).toBeTruthy();
  });
  it('every move confirmed: then the hours, and the sheet closes', async () => {
    await show();
    await closeTheMorning();
    await click(q('close-day-move'));
    expect(h.calls.map((c) => c.name)).toEqual(['moveJob', 'applyHours']);
    expect(q('close-day-sheet')).toBeNull();
  });

  /* a second appointment that morning, after the first in the route */
  const two = () => replaceLocal('jobs', [
    { id: 'j1', number: 7, customer_id: null, truck_id: 'car', day: DAY, block: 'am', status: 'booked', stop_order: 1, duration_min: 45, eta_min: 540 },
    { id: 'j2', number: 8, customer_id: null, truck_id: 'car', day: DAY, block: 'am', status: 'booked', stop_order: 2, duration_min: 45, eta_min: 600 }
  ] as never);
  const moved = () => h.calls.filter((c) => c.name === 'moveJob').map((c) => c.args[0]);
  it('a move refused « plein »: the next « Déplacer » moves the others, then the hours (mh-1, mh-2)', async () => {
    two();
    h.move = (id) => (id === 'j1' ? Promise.reject(Object.assign(new Error('Ce camion n’a plus de place dans ce bloc.'), { code: 'P0001', hint: 'truck_full' })) : Promise.resolve({ queued: false }));
    await show();
    await closeTheMorning();
    await click(q('close-day-move'));
    expect(moved()).toEqual(['j1']);
    expect(q('close-day-sheet')).toBeTruthy();
    expect(q('close-day-list')!.textContent).toContain('plein');
    await click(q('close-day-move'));
    expect(moved()).toEqual(['j1', 'j2']);
    expect(h.calls.map((c) => c.name)).toEqual(['moveJob', 'moveJob', 'applyHours']);
    expect(q('close-day-sheet')).toBeNull();
    expect(toasts.value.some((x) => /1 rendez-vous sur 2/.test(x.text))).toBe(true);
  });
  it('a move kept on the phone is not offered again: the next « Déplacer » never queues it twice (mh-5)', async () => {
    two();
    h.move = (id) => Promise.resolve({ queued: id === 'j1' });
    await show();
    await closeTheMorning();
    await click(q('close-day-move'));
    expect(moved()).toEqual(['j1']);
    expect(q('close-day-list')!.textContent).toContain('gardé sur le téléphone');
    await click(q('close-day-move'));
    expect(moved()).toEqual(['j1', 'j2']);
    expect(h.calls.map((c) => c.name)).toEqual(['moveJob', 'moveJob', 'applyHours']);
  });
  it('« Appliquer » tapped after midnight on a screen drawn the day before: the hours go from the new day (mh-4)', async () => {
    replaceLocal('jobs', []);
    await show();
    // « En permanence »: one more half hour in the evening of a weekday
    await act(async () => { down(box.querySelector(`[data-testid="hours-grid"] [data-d="2"][data-u="720"]`)!); });
    await wait();
    const next = addDays(today(), 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 86400000));
    try {
      expect(today()).toBe(next);
      await click(q('hours-apply-btn'));
    } finally { vi.useRealTimers(); }
    const call = h.calls.find((c) => c.name === 'applyHours');
    expect(call?.args[1]).toBe('always');
    expect(call?.args[3]).toBe(next);
  });
});
