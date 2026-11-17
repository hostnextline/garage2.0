/* « Vue d'ensemble » on screen (agenda-15): today's appointments by block from the phone's copy when the server's map
   does not answer, cancelled ones left out, an arrival window said on the row; the map itself is pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), rpcNow: () => Promise.reject(new Error('offline')) }));
vi.mock('../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../shared/map/useRoads', () => ({ useRoads: () => 0, roadOf: () => [] }));

import OverviewScreen from './OverviewScreen';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const TODAY = '2026-11-17';
const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => box.querySelector(`[data-testid="${s}"]`);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function garage(windows: boolean) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: windows, min_block_min: 45, unknown_min: 20 } } as never]);
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, driver_id: null, color: null }] as never);
  replaceLocal('truck_week', [{ id: 'w', truck_id: 't1', dow: 2, ranges: [[480, 1200]] }] as never);
  replaceLocal('truck_days', []);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T09:00:00-05:00')); lang.value = 'fr'; access.value = owner; });
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); clearAll(); access.value = null; });

describe('« Vue d’ensemble » on screen (agenda-15)', () => {
  it('lists today’s appointments by block from the phone when the server’s map does not answer', async () => {
    garage(false);
    replaceLocal('jobs', [
      { id: 'a', number: 1, customer_id: null, truck_id: 't1', day: TODAY, block: 'am', status: 'on_site', stop_order: 1, duration_min: 60, eta_min: 540 },
      { id: 'b', number: 2, customer_id: null, truck_id: 't1', day: TODAY, block: 'pm', status: 'booked', stop_order: 1, duration_min: 60, eta_min: 780 },
      { id: 'c', number: 3, customer_id: null, truck_id: 't1', day: TODAY, block: 'pm', status: 'cancelled', stop_order: null, duration_min: 60, eta_min: null },
      { id: 'd', number: 4, customer_id: null, truck_id: 't1', day: '2026-11-18', block: 'am', status: 'booked', stop_order: 1, duration_min: 60, eta_min: 540 }
    ] as never);
    act(() => render(<OverviewScreen params={{}} query={new URLSearchParams()} />, box));
    await flush();
    expect(q('overview-screen')).not.toBeNull();
    expect(q('overview-map')).not.toBeNull();
    expect(q('overview-am')?.querySelector('[data-testid="overview-job-a"]')).not.toBeNull();
    expect(q('overview-pm')?.querySelector('[data-testid="overview-job-b"]')).not.toBeNull();
    expect(q('overview-job-c')).toBeNull();
    expect(q('overview-job-d')).toBeNull();
    expect(q('overview-eve')).toBeNull();
  });
  it('a day of arrival windows: one list, each row with the window told', async () => {
    garage(true);
    replaceLocal('jobs', [
      { id: 'a', number: 1, customer_id: null, truck_id: 't1', day: TODAY, block: 'day', status: 'booked', stop_order: 1, duration_min: 60, eta_min: 600, win_start: 540, win_end: 780 }
    ] as never);
    act(() => render(<OverviewScreen params={{}} query={new URLSearchParams()} />, box));
    await flush();
    expect(q('overview-day')?.querySelector('[data-testid="overview-job-a"]')).not.toBeNull();
    expect(q('overview-window-a')).not.toBeNull();
    expect(q('overview-am')).toBeNull();
  });
  it('with nothing today: the empty panel', async () => {
    garage(false);
    replaceLocal('jobs', []);
    act(() => render(<OverviewScreen params={{}} query={new URLSearchParams()} />, box));
    await flush();
    expect(q('overview-screen')).not.toBeNull();
    expect(box.querySelector('[data-testid^="overview-job-"]')).toBeNull();
  });
});
