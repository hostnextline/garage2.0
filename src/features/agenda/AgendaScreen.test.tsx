/* The agenda on screen (agenda-15): a day of blocks, a day of arrival windows, the week of a computer, and what a
   mechanic sees. Real store rows, a fixed clock, nothing asked of the server. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const media = vi.hoisted(() => ({ wide: null as unknown as { value: boolean } }));
vi.mock('../../platform/media', async (orig) => {
  const { signal } = await import('@preact/signals');
  media.wide = signal(false);
  return { ...(await orig<typeof import('../../platform/media')>()), wide: media.wide };
});
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), rpcNow: () => Promise.reject(new Error('offline')), suggestBlocks: async () => [] }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), pull: async () => undefined, flush: async () => undefined }));

import AgendaScreen from './AgendaScreen';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const DAY = '2026-11-18';   // a Wednesday; today is Tuesday 2026-11-17
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const saleh = { id: 'saleh', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;
const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];

function garage(windows: boolean) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: windows, blocks: BLOCKS, min_block_min: 45, unknown_min: 20 } } as never]);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, driver_id: null, color: null }, { id: 't2', name: 'Voiture', active: true, sort: 2, driver_id: null, color: null }] as never);
  replaceLocal('truck_week', [2, 3].flatMap((dow) => [{ id: `w1-${dow}`, truck_id: 't1', dow, ranges: [[480, 1200]] }, { id: `w2-${dow}`, truck_id: 't2', dow, ranges: [[480, 1200]] }]) as never);
  replaceLocal('truck_days', []);
  const b = (k: string) => (windows ? 'day' : k);
  const w = (s: number) => (windows ? { win_start: s, win_end: s + 240 } : {});
  replaceLocal('jobs', [
    { id: 'j1', number: 11, customer_id: null, truck_id: 't1', day: DAY, block: b('am'), status: 'booked', stop_order: 1, duration_min: 60, eta_min: 540, ...w(480) },
    { id: 'j2', number: 12, customer_id: null, truck_id: 't2', day: DAY, block: b('pm'), status: 'booked', stop_order: 1, duration_min: 60, eta_min: 780, ...w(720) },
    { id: 'j3', number: 13, customer_id: null, truck_id: 't1', day: DAY, block: b('pm'), status: 'cancelled', stop_order: null, duration_min: 60, eta_min: null }
  ] as never);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => box.querySelector(`[data-testid="${s}"]`);
/** the job's ticket (a link to its sheet) inside that part of the screen */
const has = (part: string, id: string) => !!q(part)?.querySelector(`[data-testid="job-ticket"][href="#/job/${id}"]`);
const show = (query = '') => act(() => render(<AgendaScreen params={{ day: DAY }} query={new URLSearchParams(query)} />, box));

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T09:00:00-05:00')); lang.value = 'fr'; media.wide.value = false; });
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); clearAll(); access.value = null; });

describe('the agenda on screen (agenda-15)', () => {
  it('a day of blocks on a phone: the three blocks, each job in its block, the cancelled one not in the trucks', () => {
    garage(false);
    access.value = owner;
    show();
    expect(q('agenda-screen')).not.toBeNull();
    expect(q('agenda-day')).not.toBeNull();
    for (const k of ['am', 'pm', 'eve']) expect(q(`block-${k}`)).not.toBeNull();
    expect(q('block-day')).toBeNull();
    expect(has('block-am', 'j1')).toBe(true);
    expect(has('block-pm', 'j2')).toBe(true);
    expect(has('block-am', 'j2')).toBe(false);
    expect(has('lane-t1', 'j3')).toBe(false);
  });
  it('a day of arrival windows: one panel for the day, no blocks', () => {
    garage(true);
    access.value = owner;
    show();
    expect(q('block-day')).not.toBeNull();
    for (const k of ['am', 'pm', 'eve']) expect(q(`block-${k}`)).toBeNull();
    expect(has('block-day', 'j1')).toBe(true);
    expect(has('block-day', 'j2')).toBe(true);
  });
  it('a mechanic sees his own truck’s jobs only', () => {
    garage(false);
    access.value = saleh;
    show();
    expect(q('lane-t1')).not.toBeNull();
    expect(q('lane-t2')).toBeNull();
    expect(has('agenda-day', 'j1')).toBe(true);
    expect(has('agenda-day', 'j2')).toBe(false);
  });
  it('a computer opens the week, with a chip for each job, and the day view on demand', () => {
    garage(false);
    access.value = owner;
    media.wide.value = true;
    show();
    expect(q('agenda-week')).not.toBeNull();
    expect(q('chip-j1')).not.toBeNull();
    expect(q('chip-j2')).not.toBeNull();
    expect(q('chip-j3')).toBeNull();
    show('view=day');
    expect(q('agenda-week')).toBeNull();
    expect(q('agenda-day')).not.toBeNull();
  });
});
