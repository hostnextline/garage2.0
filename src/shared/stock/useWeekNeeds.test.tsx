/* The week's needs follow every table they read while the screen stays open: a job line added, an engine sheet
   confirmed (the old memo only followed the jobs and the stock, so the demo's needs screen said « Rien à prévoir »). */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useWeekNeeds, useDefaultWeek } from './useWeekNeeds';
import { replaceLocal } from '../../data/store';
import { addDays, today, weekStart } from '../../lib/dates';
import type { WeekNeeds } from '../../domain/stock/needs';

const box = document.createElement('div');
document.body.appendChild(box);
let seen: WeekNeeds | null = null;
function Probe(p: { from: string }) { seen = useWeekNeeds(p.from); return null; }
afterEach(() => act(() => render(null, box)));

describe('useWeekNeeds', () => {
  it('a job line and an engine sheet arriving while the screen is open change the needs at once', async () => {
    const from = addDays(weekStart(today()), 7);
    replaceLocal('services', [{ id: 's-oil', name_fr: 'Changement d’huile', name_en: null, includes: [], needs: null }]);
    replaceLocal('vehicles', [{ id: 'v', year: 2019, make: 'Honda', model: 'Civic', spec_key: 'k' }]);
    replaceLocal('jobs', [{ id: 'j', number: 1, day: addDays(from, 2), vehicle_id: 'v', status: 'booked' }]);
    replaceLocal('job_items', []);
    replaceLocal('engine_specs', []);
    replaceLocal('inventory_items', []);
    await act(() => render(<Probe from={from} />, box));
    expect(seen!.lines).toEqual([]);
    await act(() => replaceLocal('job_items', [{ id: 'l', job_id: 'j', service_id: 's-oil', item_id: null, kind: 'service', qty: 1, status: 'planned' }]));
    expect(seen!.lines.map((l) => l.kind)).toEqual(['oil', 'oil_filter']);
    await act(() => replaceLocal('engine_specs', [{ id: 'e', key: 'k', data: { oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317' } }]));
    expect(seen!.lines.find((l) => l.kind === 'oil')).toMatchObject({ ref: '0W-20', qty: 4.2, sure: true });
  });
  it('lines of equal quantity come in the job’s order (sort, then created), and the first engine sheet of a key counts', async () => {
    const from = addDays(weekStart(today()), 7);
    replaceLocal('services', []);
    replaceLocal('vehicles', [{ id: 'v', year: 2019, make: 'Honda', model: 'Civic', spec_key: 'k' }]);
    replaceLocal('jobs', [{ id: 'j', number: 1, day: addDays(from, 2), vehicle_id: 'v', status: 'booked' }]);
    replaceLocal('inventory_items', []);
    replaceLocal('job_items', [
      { id: 'l2', job_id: 'j', service_id: null, item_id: 'i-b', kind: 'part', qty: 1, status: 'planned', sort: 2, created_at: '2026-01-01T00:00:00Z' },
      { id: 'l1', job_id: 'j', service_id: null, item_id: 'i-a', kind: 'part', qty: 1, status: 'planned', sort: 1, created_at: '2026-01-02T00:00:00Z' },
      { id: 'l3', job_id: 'j', service_id: null, item_id: 'i-c', kind: 'part', qty: 1, status: 'planned', sort: 1, created_at: '2026-01-03T00:00:00Z' }
    ]);
    replaceLocal('engine_specs', [
      { id: 'e1', key: 'k', data: { oil_l: 4.2, oil_visc: '0W-20', oil_filter: 'PH7317' } },
      { id: 'e2', key: 'k', data: { oil_l: 6, oil_visc: '5W-30', oil_filter: 'X' } }
    ]);
    await act(() => render(<Probe from={from} />, box));
    expect(seen!.lines.map((l) => l.itemId)).toEqual(['i-a', 'i-c', 'i-b']);
    await act(() => replaceLocal('services', [{ id: 's-oil', name_fr: 'Changement d’huile', name_en: null, includes: [], needs: null }]));
    await act(() => replaceLocal('job_items', [{ id: 'l', job_id: 'j', service_id: 's-oil', item_id: null, kind: 'service', qty: 1, status: 'planned', sort: 0 }]));
    expect(seen!.lines.find((l) => l.kind === 'oil')).toMatchObject({ ref: '0W-20', qty: 4.2 });
  });
  it('the week to open re-draws its screen only when the week changes, not at every job saved', async () => {
    replaceLocal('jobs', [{ id: 'a', number: 1, day: '2020-01-01', status: 'done' }]);
    let draws = 0;
    function Week() { useDefaultWeek(); draws++; return null; }
    await act(() => render(<Week />, box));
    const first = draws;
    await act(() => replaceLocal('jobs', [{ id: 'a', number: 1, day: '2020-01-01', status: 'done', notes: 'x' }]));
    await act(() => replaceLocal('jobs', [{ id: 'b', number: 2, day: '2020-01-02', status: 'cancelled' }]));
    expect(draws).toBe(first);
  });
});
