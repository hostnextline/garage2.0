/* The week's needs follow every table they read while the screen stays open: a job line added, an engine sheet
   confirmed (the old memo only followed the jobs and the stock, so the demo's needs screen said « Rien à prévoir »). */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useWeekNeeds } from './useWeekNeeds';
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
});
