/* « Départ et heure »: the appointments a new start leaves out are asked about first (map-hours-02); the server's answer
   says what happened (x-contract-08); a change kept on the phone does not arm the button again (map-hours-20).
   (The server, the data and the questions are pretended.) */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Job } from '../../data/types';

const DAY = '2099-03-10';
const h = vi.hoisted(() => ({ jobs: [] as unknown[], calls: [] as unknown[][], answer: null as unknown, asked: [] as string[], yes: false, toasts: [] as string[] }));
const jobs = { set value(v: Job[]) { h.jobs = v; } };
const calls = h.calls, asked = h.asked, toasts = h.toasts;
vi.mock('../../data/select', async (orig) => {
  const real = await orig<typeof import('../../data/select')>();
  return {
    ...real,
    truck: (id: string) => (id === 't1' ? { id: 't1', name: 'Camion Complet', active: true } : undefined),
    truckRanges: () => [[480, 1200]],
    allJobs: { get value() { return h.jobs; } },
    customer: () => ({ first_name: 'Julie' }),
    blockOfKey: (k: string) => ({ am: { key: 'am', start: 480, end: 720 }, pm: { key: 'pm', start: 720, end: 960 }, eve: { key: 'eve', start: 960, end: 1200 } } as Record<string, unknown>)[k]
  };
});
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), applyHours: async (...a: unknown[]) => { h.calls.push(a); return h.answer; } }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), flush: async () => undefined, pull: async () => undefined }));
vi.mock('../../shared/places/TruckStartPanel', () => ({ TruckStartPanel: () => null }));
vi.mock('../../ui', async (orig) => ({
  ...(await orig<typeof import('../../ui')>()),
  ask: async (o: { title: string }) => { h.asked.push(o.title); return h.yes; },
  toast: (text: string) => { h.toasts.push(text); return 0; }
}));
import { TruckDaySheet } from './TruckDaySheet';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
async function open() {
  await act(async () => { render(<TruckDaySheet truckId="t1" day={DAY} onClose={() => undefined} />, document.body.appendChild(box)); });
}
async function pick(minute: number) {
  const sel = q('truck-day-time')!.querySelector('select')!;
  await act(async () => { sel.value = String(minute); sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function save() { await act(async () => { q('truck-day-save')!.click(); }); await settle(); }

describe('« Départ et heure »', () => {
  beforeEach(() => { calls.length = 0; asked.length = 0; toasts.length = 0; h.yes = false; h.answer = { queued: false, data: { ok: true, changed: 1 } }; jobs.value = []; });
  afterEach(() => { render(null, box); });

  it('a morning appointment left out by a start at 12 h: asked first; « Annuler » sends nothing', async () => {
    jobs.value = [{ id: 'j1', truck_id: 't1', status: 'booked', day: DAY, block: 'am', stop_order: 1, number: 7, customer_id: 'c1', duration_min: 60 } as Job];
    await open();
    await pick(720);
    await save();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/1/);
    expect(calls).toHaveLength(0);
    h.yes = true;
    await save();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['t1', 'day', { 2: [[720, 1200]] }, DAY]);
  });
  it('nothing left out: saved at once, without a question', async () => {
    jobs.value = [{ id: 'j1', truck_id: 't1', status: 'booked', day: DAY, block: 'pm', stop_order: 1, number: 7, customer_id: 'c1', duration_min: 60 } as Job];
    await open();
    await pick(540);
    await save();
    expect(asked).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });
  it('the server wrote nothing for that day: « Rien n’a changé », not « Départ à … »', async () => {
    h.answer = { queued: false, data: { ok: true, changed: 0 } };
    await open();
    await pick(540);
    await save();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toMatch(/9 h|9 AM|9:00/);
  });
  it('kept on the phone (no signal): the button waits instead of queuing the same change again', async () => {
    h.answer = { queued: true };
    await open();
    await pick(540);
    await save();
    expect((q('truck-day-save') as HTMLButtonElement).disabled).toBe(true);
    await pick(600);
    expect((q('truck-day-save') as HTMLButtonElement).disabled).toBe(false);
  });
});
