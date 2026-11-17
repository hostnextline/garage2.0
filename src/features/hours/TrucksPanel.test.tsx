/* Horaires, « Les camions »: taking the tire machine away from a vehicle that still has tire work coming asks first, and
   the question names those appointments (R90). (The server is pretended.) */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const h = vi.hoisted(() => ({ saved: [] as unknown[] }));
vi.mock('../../data/api', async (orig) => ({
  ...(await orig<typeof import('../../data/api')>()),
  saveTruck: async (row: unknown) => { h.saved.push(row); return { queued: false }; }
}));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), pull: async () => undefined, flush: async () => undefined }));
vi.mock('../../shared/places/TruckStartPanel', () => ({ TruckStartPanel: () => null, startWords: () => '' }));
import { TrucksPanel } from './TrucksPanel';
import { AskHost } from '../../ui/ask';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';
import { addDays, today } from '../../lib/dates';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); for (let i = 0; i < 4; i++) await wait(); };

describe('Horaires: a vehicle loses its tire machine', () => {
  beforeEach(() => {
    lang.value = 'fr'; h.saved.length = 0;
    replaceLocal('settings', [{ id: '1', booking: { blocks: [], home: null } } as never]);
    replaceLocal('trucks', [{ id: 'truck', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null, plate: null, tire_machine: true }] as never);
    replaceLocal('staff', []);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Marie', company: null }] as never);
    replaceLocal('jobs', [
      { id: 'j1', number: 7, customer_id: 'c1', truck_id: 'truck', day: addDays(today(), 3), block: 'am', status: 'booked', needs_machine: true },
      { id: 'j2', number: 8, customer_id: null, truck_id: 'truck', day: addDays(today(), 2), block: 'am', status: 'booked', needs_machine: true },
      { id: 'j3', number: 9, customer_id: null, truck_id: 'truck', day: addDays(today(), 2), block: 'pm', status: 'booked', needs_machine: false }
    ] as never);
  });
  afterEach(() => { render(null, box); });

  it('the question names the tire appointments, in day order; « Annuler » saves nothing', async () => {
    await act(async () => { render(<><TrucksPanel /><AskHost /></>, box); });
    await wait();
    await click(q('truck-row-truck'));
    await click(q('truck-machine'));
    await click(q('truck-save'));
    const text = document.body.textContent || '';
    expect(text).toContain('2 rendez-vous à venir sont touchés');
    expect(text).toMatch(/Lesquels : #8 \([^)]+\) et Marie \([^)]+\)\./);
    expect(text).not.toContain('#9');
    expect(h.saved).toHaveLength(0);
  });
});
